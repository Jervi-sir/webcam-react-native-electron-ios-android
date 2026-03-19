import {
  IncomingSignalEvent,
  OutgoingSignalEvent,
  SignalingServerInfo,
} from './signaling';
import {
  VirtualCamBridgeState,
  VirtualCamConfigInput,
  VirtualCamEvent,
  VirtualCamFramePayload,
} from './virtualcam';

declare global {
  interface Window {
    desktopApi: {
      getServerInfo: () => Promise<SignalingServerInfo>;
      sendSignal: (message: OutgoingSignalEvent) => Promise<void>;
      getVirtualCamState: () => Promise<VirtualCamBridgeState>;
      setVirtualCamConfig: (
        config: VirtualCamConfigInput,
      ) => Promise<VirtualCamBridgeState>;
      pushVirtualCamFrame: (frame: VirtualCamFramePayload) => void;
      copyText: (text: string) => void;
      onSignal: (listener: (event: IncomingSignalEvent) => void) => () => void;
      onVirtualCamEvent: (listener: (event: VirtualCamEvent) => void) => () => void;
    };
  }
}

export {};
