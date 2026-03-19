import { clipboard, contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  IncomingSignalEvent,
  OutgoingSignalEvent,
  SIGNALING_EVENT_CHANNEL,
  SIGNALING_GET_SERVER_INFO_CHANNEL,
  SIGNALING_SEND_CHANNEL,
  SignalingServerInfo,
} from './signaling';
import {
  VIRTUALCAM_EVENT_CHANNEL,
  VIRTUALCAM_GET_STATE_CHANNEL,
  VIRTUALCAM_PUSH_FRAME_CHANNEL,
  VIRTUALCAM_SET_CONFIG_CHANNEL,
  VirtualCamBridgeState,
  VirtualCamConfigInput,
  VirtualCamEvent,
  VirtualCamFramePayload,
} from './virtualcam';

const desktopApi = {
  getServerInfo: (): Promise<SignalingServerInfo> =>
    ipcRenderer.invoke(SIGNALING_GET_SERVER_INFO_CHANNEL),
  sendSignal: (message: OutgoingSignalEvent): Promise<void> =>
    ipcRenderer.invoke(SIGNALING_SEND_CHANNEL, message),
  getVirtualCamState: (): Promise<VirtualCamBridgeState> =>
    ipcRenderer.invoke(VIRTUALCAM_GET_STATE_CHANNEL),
  setVirtualCamConfig: (
    config: VirtualCamConfigInput,
  ): Promise<VirtualCamBridgeState> =>
    ipcRenderer.invoke(VIRTUALCAM_SET_CONFIG_CHANNEL, config),
  pushVirtualCamFrame: (frame: VirtualCamFramePayload): void => {
    ipcRenderer.send(VIRTUALCAM_PUSH_FRAME_CHANNEL, frame);
  },
  copyText: (text: string): void => {
    clipboard.writeText(text);
  },
  onSignal: (listener: (event: IncomingSignalEvent) => void): (() => void) => {
    const wrappedListener = (
      _: IpcRendererEvent,
      payload: IncomingSignalEvent,
    ) => {
      listener(payload);
    };

    ipcRenderer.on(SIGNALING_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(SIGNALING_EVENT_CHANNEL, wrappedListener);
    };
  },
  onVirtualCamEvent: (listener: (event: VirtualCamEvent) => void): (() => void) => {
    const wrappedListener = (_: IpcRendererEvent, payload: VirtualCamEvent) => {
      listener(payload);
    };

    ipcRenderer.on(VIRTUALCAM_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(VIRTUALCAM_EVENT_CHANNEL, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
