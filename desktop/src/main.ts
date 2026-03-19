import { app, BrowserWindow, ipcMain } from 'electron';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import {
  IncomingSignalEvent,
  OutgoingSignalEvent,
  SIGNALING_EVENT_CHANNEL,
  SIGNALING_GET_SERVER_INFO_CHANNEL,
  SIGNALING_PORT,
  SIGNALING_SEND_CHANNEL,
  SignalingServerInfo,
} from './signaling';
import {
  VIRTUALCAM_EVENT_CHANNEL,
  VIRTUALCAM_GET_STATE_CHANNEL,
  VIRTUALCAM_PUSH_FRAME_CHANNEL,
  VIRTUALCAM_SET_CONFIG_CHANNEL,
  VirtualCamEncoding,
  VirtualCamBridgeState,
  VirtualCamConfigInput,
  VirtualCamEvent,
  VirtualCamFramePayload,
} from './virtualcam';
import { MacOSVirtualCamRuntime } from './macosVirtualCam';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let signalingServer: WebSocketServer | null = null;
let connectedClient: WebSocket | null = null;
let virtualCamBridge: VirtualCamBridge | null = null;
let macOSVirtualCamRuntime: MacOSVirtualCamRuntime | null = null;

class VirtualCamBridge {
  private state: VirtualCamBridgeState = {
    droppedFrames: 0,
    enabled: false,
    encoding: 'jpeg',
    host: '127.0.0.1',
    lastError: null,
    phase: 'disabled',
    port: 19777,
    sentFrames: 0,
  };
  private socket: net.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private canWrite = true;
  private lastMetricsEmitAt = 0;

  constructor(private readonly onStateChange: (state: VirtualCamBridgeState) => void) {}

  getState = (): VirtualCamBridgeState => ({ ...this.state });

  setConfig = (config: VirtualCamConfigInput): VirtualCamBridgeState => {
    const host = config.host.trim() || '127.0.0.1';
    const port = Number(config.port);
    const encoding: VirtualCamEncoding =
      config.encoding === 'rgba' ? 'rgba' : 'jpeg';

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Virtual camera bridge port must be between 1 and 65535.');
    }

    const shouldReconnect =
      this.state.host !== host ||
      this.state.port !== port ||
      this.state.encoding !== encoding ||
      !this.state.enabled;

    this.state = {
      ...this.state,
      enabled: config.enabled,
      encoding,
      host,
      lastError: null,
      port,
    };
    this.emitState(true);

    if (!config.enabled) {
      this.disconnect();
      this.setPhase('disabled');
      return this.getState();
    }

    if (shouldReconnect) {
      this.disconnect();
    }

    this.connect();
    return this.getState();
  };

  stop = () => {
    this.clearReconnectTimer();
    this.disconnect();
    this.setPhase('disabled');
  };

  sendFrame = (frame: VirtualCamFramePayload) => {
    if (
      !frame ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      !frame.payloadData ||
      frame.payloadData.byteLength < 1
    ) {
      return;
    }

    if (!this.state.enabled || !this.socket || this.socket.destroyed) {
      this.state.droppedFrames += 1;
      this.emitMetrics();
      return;
    }

    if (!this.canWrite || this.state.phase !== 'connected') {
      this.state.droppedFrames += 1;
      this.emitMetrics();
      return;
    }

    const encoded = this.encodeFrame(frame);
    const writeOk = this.socket.write(encoded);
    this.canWrite = writeOk;
    this.state.sentFrames += 1;
    this.emitMetrics();
  };

  private connect = () => {
    if (!this.state.enabled) {
      return;
    }

    if (this.socket && !this.socket.destroyed) {
      return;
    }

    this.clearReconnectTimer();
    this.setPhase('connecting');

    const socket = net.createConnection({
      host: this.state.host,
      port: this.state.port,
    });

    this.socket = socket;
    socket.setNoDelay(true);

    socket.on('connect', () => {
      if (socket !== this.socket) {
        return;
      }

      this.canWrite = true;
      this.setPhase('connected');
    });

    socket.on('drain', () => {
      if (socket !== this.socket) {
        return;
      }

      this.canWrite = true;
    });

    socket.on('error', (error) => {
      if (socket !== this.socket) {
        return;
      }

      this.setPhase('error', `Virtual camera bridge error: ${error.message}`);
    });

    socket.on('close', () => {
      if (socket === this.socket) {
        this.socket = null;
      }

      this.canWrite = true;

      if (!this.state.enabled) {
        this.setPhase('disabled');
        return;
      }

      if (this.state.phase !== 'error') {
        this.setPhase('disconnected');
      }

      this.scheduleReconnect();
    });
  };

  private disconnect = () => {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = null;
    this.canWrite = true;
  };

  private scheduleReconnect = () => {
    if (!this.state.enabled || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1200);
  };

  private clearReconnectTimer = () => {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  };

  private setPhase = (
    phase: VirtualCamBridgeState['phase'],
    lastError: string | null = null,
  ) => {
    this.state = {
      ...this.state,
      lastError,
      phase,
    };
    this.emitState(true);
  };

  private emitMetrics = () => {
    const now = Date.now();
    if (now - this.lastMetricsEmitAt < 900) {
      return;
    }

    this.lastMetricsEmitAt = now;
    this.emitState();
  };

  private emitState = (force = false) => {
    if (force) {
      this.lastMetricsEmitAt = Date.now();
    }

    this.onStateChange(this.getState());
  };

  private encodeFrame = (frame: VirtualCamFramePayload): Buffer => {
    const width = Math.max(1, Math.min(65535, Math.round(frame.width)));
    const height = Math.max(1, Math.min(65535, Math.round(frame.height)));
    const frameBuffer = Buffer.from(
      frame.payloadData.buffer,
      frame.payloadData.byteOffset,
      frame.payloadData.byteLength,
    );
    const packet = Buffer.allocUnsafe(20 + frameBuffer.length);
    const magic =
      (frame.encoding === 'rgba' ? 'rgba' : 'jpeg') === 'rgba'
        ? 'EVRG'
        : 'EVCM';

    packet.write(magic, 0, 4, 'ascii');
    packet.writeUInt16LE(width, 4);
    packet.writeUInt16LE(height, 6);
    packet.writeBigUInt64LE(process.hrtime.bigint(), 8);
    packet.writeUInt32LE(frameBuffer.length, 16);
    frameBuffer.copy(packet, 20);

    return packet;
  };
}

const getSignalingUrls = (): string[] => {
  const interfaces = os.networkInterfaces();
  const urls = new Set<string>();

  for (const networkInterface of Object.values(interfaces)) {
    if (!networkInterface) {
      continue;
    }

    for (const details of networkInterface) {
      if (details.family === 'IPv4' && !details.internal) {
        urls.add(`ws://${details.address}:${SIGNALING_PORT}`);
      }
    }
  }

  if (urls.size === 0) {
    urls.add(`ws://127.0.0.1:${SIGNALING_PORT}`);
  }

  return Array.from(urls).sort();
};

const getSignalingServerInfo = (): SignalingServerInfo => ({
  port: SIGNALING_PORT,
  urls: getSignalingUrls(),
});

const sendToRenderer = (event: IncomingSignalEvent) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(SIGNALING_EVENT_CHANNEL, event);
};

const sendVirtualCamState = (state: VirtualCamBridgeState) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const payload: VirtualCamEvent = {
    state,
    type: 'state',
  };
  mainWindow.webContents.send(VIRTUALCAM_EVENT_CHANNEL, payload);
};

const sendToClient = (message: OutgoingSignalEvent) => {
  if (!connectedClient || connectedClient.readyState !== WebSocket.OPEN) {
    throw new Error('No mobile client is connected yet.');
  }

  connectedClient.send(JSON.stringify(message));
};

const parseSocketMessage = (raw: RawData): Record<string, unknown> | null => {
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf-8')
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString('utf-8')
          : raw.toString('utf-8');

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
};

const setupSignalingServer = () => {
  if (signalingServer) {
    return;
  }

  signalingServer = new WebSocketServer({
    host: '0.0.0.0',
    port: SIGNALING_PORT,
  });

  signalingServer.on('connection', (socket, request) => {
    if (connectedClient && connectedClient.readyState === WebSocket.OPEN) {
      connectedClient.close(1012, 'Replaced by a newer client connection');
    }

    connectedClient = socket;
    sendToRenderer({
      address: request.socket.remoteAddress ?? null,
      type: 'client-connected',
    });

    socket.send(JSON.stringify({ type: 'ready' }));

    socket.on('message', (raw: RawData) => {
      const payload = parseSocketMessage(raw);
      if (!payload) {
        socket.send(
          JSON.stringify({
            message: 'Invalid JSON payload.',
            type: 'error',
          }),
        );
        return;
      }

      const type = payload.type;
      if (typeof type !== 'string') {
        return;
      }

      if (type === 'offer' && payload.sdp) {
        sendToRenderer({
          sdp: payload.sdp,
          type: 'offer',
        });
        return;
      }

      if (type === 'candidate' && payload.candidate) {
        sendToRenderer({
          candidate: payload.candidate,
          type: 'candidate',
        });
      }
    });

    socket.on('close', () => {
      if (connectedClient === socket) {
        connectedClient = null;
      }

      sendToRenderer({
        type: 'client-disconnected',
      });
    });

    socket.on('error', (error) => {
      sendToRenderer({
        message: `Client socket error: ${error.message}`,
        type: 'error',
      });
    });
  });

  signalingServer.on('error', (error) => {
    sendToRenderer({
      message: `Signaling server error: ${error.message}`,
      type: 'error',
    });
  });
};

const setupIpc = () => {
  ipcMain.handle(
    SIGNALING_GET_SERVER_INFO_CHANNEL,
    (): SignalingServerInfo => getSignalingServerInfo(),
  );

  ipcMain.handle(
    SIGNALING_SEND_CHANNEL,
    (_, message: OutgoingSignalEvent): void => {
      sendToClient(message);
    },
  );

  ipcMain.handle(
    VIRTUALCAM_GET_STATE_CHANNEL,
    (): VirtualCamBridgeState => virtualCamBridge?.getState() ?? {
      droppedFrames: 0,
      enabled: false,
      encoding: 'jpeg',
      host: '127.0.0.1',
      lastError: null,
      phase: 'disabled',
      port: 19777,
      sentFrames: 0,
    },
  );

  ipcMain.handle(
    VIRTUALCAM_SET_CONFIG_CHANNEL,
    (_, config: VirtualCamConfigInput): VirtualCamBridgeState => {
      if (!virtualCamBridge) {
        throw new Error('Virtual camera bridge is not ready yet.');
      }

      return virtualCamBridge.setConfig(config);
    },
  );

  ipcMain.on(VIRTUALCAM_PUSH_FRAME_CHANNEL, (_, frame: VirtualCamFramePayload) => {
    virtualCamBridge?.sendFrame(frame);
  });
};

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#050b14',
    height: 860,
    minHeight: 640,
    minWidth: 980,
    show: false,
    width: 1360,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  macOSVirtualCamRuntime = new MacOSVirtualCamRuntime();
  macOSVirtualCamRuntime.start();
  virtualCamBridge = new VirtualCamBridge((state) => {
    sendVirtualCamState(state);
  });
  setupIpc();
  setupSignalingServer();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (connectedClient && connectedClient.readyState === WebSocket.OPEN) {
    connectedClient.close(1001, 'App is shutting down');
  }

  connectedClient = null;

  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }

  if (virtualCamBridge) {
    virtualCamBridge.stop();
    virtualCamBridge = null;
  }

  if (macOSVirtualCamRuntime) {
    macOSVirtualCamRuntime.stop();
    macOSVirtualCamRuntime = null;
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
