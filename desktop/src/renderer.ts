import './index.css';
import type { VirtualCamBridgeState, VirtualCamEncoding } from './virtualcam';

type StatusTone = 'error' | 'info' | 'success';

const statusElement = document.querySelector<HTMLParagraphElement>(
  '#connection-status',
);
const wsUrlList = document.querySelector<HTMLUListElement>('#ws-url-list');
const primaryUrlText = document.querySelector<HTMLElement>('#primary-url-text');
const copyPrimaryUrlButton = document.querySelector<HTMLButtonElement>(
  '#copy-primary-url',
);
const refreshUrlsButton = document.querySelector<HTMLButtonElement>('#refresh-urls');
const clientAddressElement = document.querySelector<HTMLElement>('#client-address');
const videoResolutionElement =
  document.querySelector<HTMLElement>('#video-resolution');
const peerStateElement = document.querySelector<HTMLElement>('#peer-state');
const stage = document.querySelector<HTMLElement>('.stage');
const remoteVideo = document.querySelector<HTMLVideoElement>('#remote-video');
const virtualCamEnabledInput = document.querySelector<HTMLInputElement>(
  '#virtualcam-enabled',
);
const virtualCamHostInput = document.querySelector<HTMLInputElement>(
  '#virtualcam-host',
);
const virtualCamPortInput = document.querySelector<HTMLInputElement>(
  '#virtualcam-port',
);
const virtualCamEncodingSelect = document.querySelector<HTMLSelectElement>(
  '#virtualcam-encoding',
);
const virtualCamApplyButton = document.querySelector<HTMLButtonElement>(
  '#virtualcam-apply',
);
const virtualCamStatusElement = document.querySelector<HTMLElement>('#virtualcam-status');
const virtualCamSentElement = document.querySelector<HTMLElement>('#virtualcam-sent');
const virtualCamDroppedElement =
  document.querySelector<HTMLElement>('#virtualcam-dropped');

if (
  !statusElement ||
  !wsUrlList ||
  !primaryUrlText ||
  !copyPrimaryUrlButton ||
  !refreshUrlsButton ||
  !clientAddressElement ||
  !videoResolutionElement ||
  !peerStateElement ||
  !stage ||
  !remoteVideo ||
  !virtualCamEnabledInput ||
  !virtualCamHostInput ||
  !virtualCamPortInput ||
  !virtualCamEncodingSelect ||
  !virtualCamApplyButton ||
  !virtualCamStatusElement ||
  !virtualCamSentElement ||
  !virtualCamDroppedElement
) {
  throw new Error('Renderer UI initialization failed: missing expected elements');
}

const VIRTUAL_CAM_CAPTURE_INTERVAL_MS = 100;
const VIRTUAL_CAM_JPEG_QUALITY = 0.78;

let peerConnection: RTCPeerConnection | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
let primaryUrl = '';
let currentVirtualCamState: VirtualCamBridgeState | null = null;
let captureCanvas: HTMLCanvasElement | null = null;
let captureContext: CanvasRenderingContext2D | null = null;
let isFramePushInFlight = false;

const getSelectedEncoding = (): VirtualCamEncoding =>
  virtualCamEncodingSelect.value === 'rgba' ? 'rgba' : 'jpeg';

const setStatus = (message: string, tone: StatusTone = 'info') => {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
};

const setPeerState = (state: string) => {
  peerStateElement.textContent = state;
};

const setClientAddress = (address: string) => {
  clientAddressElement.textContent = address;
};

const setVideoResolution = (label: string) => {
  videoResolutionElement.textContent = label;
};

const updateVideoResolution = () => {
  const stream = remoteVideo.srcObject as MediaStream | null;
  if (!stream || remoteVideo.videoWidth === 0 || remoteVideo.videoHeight === 0) {
    setVideoResolution('No stream');
    return;
  }

  const track = stream.getVideoTracks()[0];
  const frameRate = track?.getSettings?.().frameRate;
  const frameRateLabel =
    typeof frameRate === 'number' && Number.isFinite(frameRate)
      ? ` @ ${Math.round(frameRate)}fps`
      : '';

  setVideoResolution(
    `${remoteVideo.videoWidth}x${remoteVideo.videoHeight}${frameRateLabel}`,
  );
};

const clearVideo = () => {
  remoteVideo.srcObject = null;
  stage.classList.remove('video-ready');
  setVideoResolution('No stream');
};

const resetPeerConnection = () => {
  if (!peerConnection) {
    pendingCandidates = [];
    return;
  }

  peerConnection.ontrack = null;
  peerConnection.onicecandidate = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
  pendingCandidates = [];
};

const onRemoteTrack = (event: RTCTrackEvent) => {
  const [stream] = event.streams;
  if (!stream) {
    return;
  }

  remoteVideo.srcObject = stream;
  stage.classList.add('video-ready');
  updateVideoResolution();
  void remoteVideo.play().catch(() => {
    // no-op: autoplay may be blocked depending on platform policies
  });
};

const onLocalIceCandidate = async (event: RTCPeerConnectionIceEvent) => {
  if (!event.candidate) {
    return;
  }

  try {
    await window.desktopApi.sendSignal({
      candidate: event.candidate.toJSON(),
      type: 'candidate',
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to send ICE candidate.';
    setStatus(message, 'error');
  }
};

const createPeerConnection = () => {
  resetPeerConnection();
  clearVideo();
  setPeerState('Negotiating');

  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  peerConnection.ontrack = onRemoteTrack;
  peerConnection.onicecandidate = onLocalIceCandidate;
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState ?? 'unknown';
    setPeerState(state);

    if (state === 'connected') {
      setStatus('Stream connected.', 'success');
      return;
    }

    if (state === 'failed') {
      setStatus(`WebRTC state: ${state}`, 'error');
      return;
    }

    if (state === 'disconnected' || state === 'closed') {
      setStatus(`WebRTC state: ${state}`);
    }
  };
};

const flushPendingCandidates = async () => {
  if (!peerConnection || !peerConnection.remoteDescription) {
    return;
  }

  for (const candidate of pendingCandidates) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
  pendingCandidates = [];
};

const handleOffer = async (sdp: unknown) => {
  if (!sdp || typeof sdp !== 'object') {
    throw new Error('Received malformed offer from mobile client.');
  }

  createPeerConnection();
  if (!peerConnection) {
    throw new Error('Unable to create peer connection.');
  }

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(sdp as RTCSessionDescriptionInit),
  );
  await flushPendingCandidates();

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  if (!peerConnection.localDescription) {
    throw new Error('Failed to create local WebRTC answer.');
  }

  await window.desktopApi.sendSignal({
    sdp: peerConnection.localDescription.toJSON(),
    type: 'answer',
  });
  setStatus('Answer sent. Waiting for remote stream...');
};

const handleRemoteCandidate = async (candidate: unknown) => {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Received malformed ICE candidate from mobile client.');
  }

  const parsedCandidate = candidate as RTCIceCandidateInit;
  if (!peerConnection) {
    createPeerConnection();
  }

  if (!peerConnection) {
    return;
  }

  if (!peerConnection.remoteDescription) {
    pendingCandidates.push(parsedCandidate);
    return;
  }

  await peerConnection.addIceCandidate(new RTCIceCandidate(parsedCandidate));
};

const copyText = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  window.desktopApi.copyText(trimmed);
  return true;
};

const renderServerInfo = async () => {
  const serverInfo = await window.desktopApi.getServerInfo();
  wsUrlList.innerHTML = '';

  primaryUrl = serverInfo.urls[0] ?? '';
  primaryUrlText.textContent = primaryUrl || 'No network URL found';
  copyPrimaryUrlButton.disabled = !primaryUrl;

  for (const url of serverInfo.urls) {
    const item = document.createElement('li');
    item.className = 'url-item';

    const text = document.createElement('code');
    text.className = 'url-code';
    text.textContent = url;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'url-copy-btn';
    button.textContent = 'Copy';
    button.addEventListener('click', () => {
      const copied = copyText(url);
      setStatus(
        copied ? `Copied ${url}` : 'Unable to copy URL.',
        copied ? 'success' : 'error',
      );
    });

    item.append(text, button);
    wsUrlList.appendChild(item);
  }
};

const applyVirtualCamState = (state: VirtualCamBridgeState) => {
  currentVirtualCamState = state;
  virtualCamEnabledInput.checked = state.enabled;
  if (document.activeElement !== virtualCamHostInput) {
    virtualCamHostInput.value = state.host;
  }
  if (document.activeElement !== virtualCamPortInput) {
    virtualCamPortInput.value = String(state.port);
  }
  if (document.activeElement !== virtualCamEncodingSelect) {
    virtualCamEncodingSelect.value = state.encoding;
  }
  virtualCamSentElement.textContent = String(state.sentFrames);
  virtualCamDroppedElement.textContent = String(state.droppedFrames);

  virtualCamStatusElement.textContent = state.lastError
    ? `${state.phase} (${state.lastError})`
    : state.phase;
};

const updateVirtualCamConfig = async () => {
  const port = Number(virtualCamPortInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setStatus('Virtual camera bridge port must be between 1 and 65535.', 'error');
    return;
  }

  virtualCamApplyButton.disabled = true;
  try {
    const state = await window.desktopApi.setVirtualCamConfig({
      enabled: virtualCamEnabledInput.checked,
      encoding: getSelectedEncoding(),
      host: virtualCamHostInput.value,
      port,
    });

    applyVirtualCamState(state);
    setStatus(
      state.enabled
        ? 'Virtual camera bridge settings applied.'
        : 'Virtual camera bridge disabled.',
      'success',
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to update virtual camera bridge.';
    setStatus(message, 'error');
  } finally {
    virtualCamApplyButton.disabled = false;
  }
};

const ensureCaptureContext = (width: number, height: number) => {
  if (!captureCanvas) {
    captureCanvas = document.createElement('canvas');
  }

  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width;
    captureCanvas.height = height;
    captureContext = null;
  }

  if (!captureContext) {
    captureContext = captureCanvas.getContext('2d', {
      alpha: false,
    });
  }

  return captureContext;
};

const pushVirtualCamFrame = async () => {
  if (isFramePushInFlight || !currentVirtualCamState?.enabled) {
    return;
  }

  if (currentVirtualCamState.phase !== 'connected') {
    return;
  }

  if (remoteVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  const width = remoteVideo.videoWidth;
  const height = remoteVideo.videoHeight;

  if (width < 1 || height < 1) {
    return;
  }

  const context = ensureCaptureContext(width, height);
  if (!context || !captureCanvas) {
    return;
  }

  isFramePushInFlight = true;
  try {
    context.drawImage(remoteVideo, 0, 0, width, height);
    const encoding = currentVirtualCamState.encoding;

    if (encoding === 'rgba') {
      const imageData = context.getImageData(0, 0, width, height);
      const rgbaData = new Uint8Array(imageData.data);
      window.desktopApi.pushVirtualCamFrame({
        encoding,
        height,
        payloadData: rgbaData,
        width,
      });
      return;
    }

    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      captureCanvas?.toBlob(resolve, 'image/jpeg', VIRTUAL_CAM_JPEG_QUALITY);
    });
    if (!jpegBlob) {
      return;
    }

    const jpegData = new Uint8Array(await jpegBlob.arrayBuffer());
    window.desktopApi.pushVirtualCamFrame({
      encoding,
      height,
      payloadData: jpegData,
      width,
    });
  } finally {
    isFramePushInFlight = false;
  }
};

const startVirtualCamCaptureLoop = () => {
  window.setInterval(() => {
    void pushVirtualCamFrame();
  }, VIRTUAL_CAM_CAPTURE_INTERVAL_MS);
};

const initialize = async () => {
  setStatus('Waiting for mobile client to connect...');
  setPeerState('Idle');
  setClientAddress('No client');
  setVideoResolution('No stream');

  await renderServerInfo();

  const initialVirtualCamState = await window.desktopApi.getVirtualCamState();
  applyVirtualCamState(initialVirtualCamState);
  startVirtualCamCaptureLoop();

  copyPrimaryUrlButton.addEventListener('click', () => {
    const copied = copyText(primaryUrl);
    setStatus(
      copied ? 'Primary URL copied.' : 'No URL available to copy.',
      copied ? 'success' : 'error',
    );
  });

  refreshUrlsButton.addEventListener('click', () => {
    renderServerInfo()
      .then(() => {
        setStatus('Signaling URLs refreshed.', 'success');
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unable to refresh URLs.';
        setStatus(message, 'error');
      });
  });

  virtualCamApplyButton.addEventListener('click', () => {
    void updateVirtualCamConfig();
  });

  virtualCamEnabledInput.addEventListener('change', () => {
    void updateVirtualCamConfig();
  });
  virtualCamEncodingSelect.addEventListener('change', () => {
    void updateVirtualCamConfig();
  });

  remoteVideo.addEventListener('loadedmetadata', updateVideoResolution);
  remoteVideo.addEventListener('resize', updateVideoResolution);

  window.desktopApi.onVirtualCamEvent((event) => {
    if (event.type !== 'state') {
      return;
    }

    applyVirtualCamState(event.state);
  });

  window.desktopApi.onSignal(async (event) => {
    try {
      if (event.type === 'client-connected') {
        const address = event.address ?? 'Unknown address';
        setClientAddress(address);
        setStatus(`Mobile client connected (${address}). Waiting for offer...`);
        return;
      }

      if (event.type === 'client-disconnected') {
        setStatus('Mobile client disconnected. Waiting for reconnection...');
        setClientAddress('No client');
        resetPeerConnection();
        setPeerState('Idle');
        clearVideo();
        return;
      }

      if (event.type === 'offer') {
        await handleOffer(event.sdp);
        return;
      }

      if (event.type === 'candidate') {
        await handleRemoteCandidate(event.candidate);
        return;
      }

      if (event.type === 'error') {
        setStatus(event.message, 'error');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unexpected WebRTC error.';
      setStatus(message, 'error');
    }
  });
};

initialize().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'Failed to initialize renderer.';
  setStatus(message, 'error');
});
