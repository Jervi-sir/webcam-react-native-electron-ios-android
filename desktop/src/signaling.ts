export const SIGNALING_PORT = 3333;

export const SIGNALING_EVENT_CHANNEL = 'signaling:event';
export const SIGNALING_GET_SERVER_INFO_CHANNEL = 'signaling:get-server-info';
export const SIGNALING_SEND_CHANNEL = 'signaling:send';

export interface SignalingServerInfo {
  port: number;
  urls: string[];
}

export type IncomingSignalEvent =
  | {
      address: string | null;
      type: 'client-connected';
    }
  | {
      type: 'client-disconnected';
    }
  | {
      sdp: unknown;
      type: 'offer';
    }
  | {
      candidate: unknown;
      type: 'candidate';
    }
  | {
      message: string;
      type: 'error';
    };

export type OutgoingSignalEvent =
  | {
      sdp: unknown;
      type: 'answer';
    }
  | {
      candidate: unknown;
      type: 'candidate';
    };
