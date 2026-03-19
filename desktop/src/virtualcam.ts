export const VIRTUALCAM_EVENT_CHANNEL = 'virtualcam:event';
export const VIRTUALCAM_GET_STATE_CHANNEL = 'virtualcam:get-state';
export const VIRTUALCAM_SET_CONFIG_CHANNEL = 'virtualcam:set-config';
export const VIRTUALCAM_PUSH_FRAME_CHANNEL = 'virtualcam:push-frame';

export type VirtualCamEncoding = 'jpeg' | 'rgba';

export type VirtualCamBridgePhase =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface VirtualCamBridgeState {
  enabled: boolean;
  encoding: VirtualCamEncoding;
  host: string;
  port: number;
  phase: VirtualCamBridgePhase;
  lastError: string | null;
  sentFrames: number;
  droppedFrames: number;
}

export interface VirtualCamConfigInput {
  enabled: boolean;
  encoding: VirtualCamEncoding;
  host: string;
  port: number;
}

export interface VirtualCamFramePayload {
  encoding: VirtualCamEncoding;
  width: number;
  height: number;
  payloadData: Uint8Array;
}

export type VirtualCamEvent = {
  type: 'state';
  state: VirtualCamBridgeState;
};
