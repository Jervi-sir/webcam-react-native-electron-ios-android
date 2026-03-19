import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCPIPView,
  RTCSessionDescription,
  RTCView,
  startIOSPIP,
  stopIOSPIP,
} from 'react-native-webrtc';

type SessionDescriptionPayload = {
  sdp: string;
  type: string | null;
};

type IceCandidatePayload = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type DesktopSignalMessage =
  | {
    type: 'ready';
  }
  | {
    type: 'answer';
    sdp: SessionDescriptionPayload;
  }
  | {
    type: 'candidate';
    candidate: IceCandidatePayload;
  }
  | {
    type: 'error';
    message: string;
  };

type ResolutionPreset = {
  frameRate: number;
  height: number;
  key: string;
  label: string;
  width: number;
};

type CameraFacing = 'environment' | 'user';

type VideoInputDevice = {
  deviceId: string;
  facing: CameraFacing;
  label: string;
};

type EnumeratedMediaDevice = {
  deviceId?: string;
  facing?: string;
  kind?: string;
  label?: string;
};

type PeerWithHandlers = RTCPeerConnection & {
  onconnectionstatechange: null | (() => void);
  onicecandidate: null | ((event: { candidate: RTCIceCandidate | null }) => void);
};

const DEFAULT_SIGNALING_PORT = '3333';
const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { key: '480p', label: '480p (640x480)', width: 640, height: 480, frameRate: 30 },
  { key: '720p', label: '720p (1280x720)', width: 1280, height: 720, frameRate: 30 },
  { key: '1080p', label: '1080p (1920x1080)', width: 1920, height: 1080, frameRate: 30 },
  { key: '2k', label: '2K (2560x1440)', width: 2560, height: 1440, frameRate: 30 },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const normalizeFacing = (facing: string | undefined): CameraFacing =>
  facing === 'user' || facing === 'front' ? 'user' : 'environment';

type NativeWebRTCModule = {
  mediaStreamTrackFocusAtPoint?: (
    trackId: string,
    x: number,
    y: number,
  ) => Promise<void>;
  mediaStreamTrackSetZoom?: (trackId: string, zoom: number) => Promise<void>;
};

export default function App() {
  const [desktopIp, setDesktopIp] = useState('192.168.1.105');
  const [desktopPort, setDesktopPort] = useState(DEFAULT_SIGNALING_PORT);
  const [status, setStatus] = useState('Idle');
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);
  const [selectedResolutionKey, setSelectedResolutionKey] = useState('720p');
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('environment');
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isPreviewMirrored, setIsPreviewMirrored] = useState(false);
  const [isPipEnabled, setIsPipEnabled] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [isInfoPanelVisible, setIsInfoPanelVisible] = useState(false);
  const [videoInputDevices, setVideoInputDevices] = useState<VideoInputDevice[]>([]);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [previewSize, setPreviewSize] = useState({ height: 1, width: 1 });
  const [focusIndicator, setFocusIndicator] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<IceCandidatePayload[]>([]);
  const offerInFlightRef = useRef(false);
  const focusHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoCardProgress = useRef(new Animated.Value(0)).current;
  const pipViewRef = useRef(null);

  const selectedResolution = useMemo(() => {
    return (
      RESOLUTION_PRESETS.find((preset) => preset.key === selectedResolutionKey) ??
      RESOLUTION_PRESETS[1]
    );
  }, [selectedResolutionKey]);

  const camerasForCurrentFacing = useMemo(
    () => videoInputDevices.filter((device) => device.facing === cameraFacing),
    [videoInputDevices, cameraFacing],
  );

  const selectedCameraLabel = useMemo(() => {
    const selected = camerasForCurrentFacing.find(
      (device) => device.deviceId === selectedCameraDeviceId,
    );
    return selected?.label ?? 'Auto';
  }, [camerasForCurrentFacing, selectedCameraDeviceId]);

  const signalingUrl = useMemo(() => {
    const ip = desktopIp.trim();
    if (!ip) {
      return '';
    }

    if (ip.startsWith('ws://') || ip.startsWith('wss://')) {
      return ip;
    }

    const port = desktopPort.trim() || DEFAULT_SIGNALING_PORT;
    return `ws://${ip}:${port}`;
  }, [desktopIp, desktopPort]);

  const cameraFacingLabel = cameraFacing === 'user' ? 'Front' : 'Back';

  const setStatusSafe = (message: string) => {
    setStatus(message);
  };

  const getNativeWebRTCModule = (): NativeWebRTCModule =>
    NativeModules.WebRTCModule as NativeWebRTCModule;

  const getActiveVideoTrack = () => localStreamRef.current?.getVideoTracks()[0];
  const getActiveAudioTrack = () => localStreamRef.current?.getAudioTracks()[0];

  const stopPictureInPicture = () => {
    if (Platform.OS !== 'ios' || !pipViewRef.current) {
      return;
    }

    try {
      stopIOSPIP(pipViewRef);
    } catch {
      // no-op: avoid blocking regular teardown
    } finally {
      setIsPipActive(false);
    }
  };

  const refreshVideoInputs = async () => {
    try {
      const devices = (await mediaDevices.enumerateDevices()) as EnumeratedMediaDevice[];
      const videoDevices = devices
        .filter((device) => device.kind === 'videoinput' && typeof device.deviceId === 'string')
        .map((device, index) => ({
          deviceId: device.deviceId as string,
          facing: normalizeFacing(device.facing),
          label:
            device.label && device.label.trim().length > 0
              ? device.label
              : `Camera ${index + 1}`,
        }));

      setVideoInputDevices(videoDevices);
      setSelectedCameraDeviceId((current) => {
        if (current && videoDevices.some((device) => device.deviceId === current)) {
          return current;
        }

        const sameFacing = videoDevices.find((device) => device.facing === cameraFacing);
        return sameFacing?.deviceId ?? videoDevices[0]?.deviceId ?? null;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to enumerate camera devices.';
      setStatusSafe(message);
    }
  };

  const applyZoomToTrack = async (
    trackId: string,
    requestedZoom: number,
    shouldUpdateStatus = false,
  ) => {
    if (Platform.OS !== 'ios') {
      if (shouldUpdateStatus) {
        setStatusSafe('Camera zoom is currently supported on iOS only.');
      }
      return;
    }

    const nativeWebRTCModule = getNativeWebRTCModule();
    if (!nativeWebRTCModule.mediaStreamTrackSetZoom) {
      if (shouldUpdateStatus) {
        setStatusSafe('Camera zoom is unavailable in this build.');
      }
      return;
    }

    const clamped = clampZoom(requestedZoom);
    try {
      await nativeWebRTCModule.mediaStreamTrackSetZoom(trackId, clamped);
      if (shouldUpdateStatus) {
        setStatusSafe(`Zoom ${clamped.toFixed(1)}x`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to apply zoom.';
      setStatusSafe(message);
    }
  };

  const clearLocalStream = () => {
    setIsPipEnabled(false);
    stopPictureInPicture();

    if (!localStreamRef.current) {
      return;
    }

    for (const track of localStreamRef.current.getTracks()) {
      track.stop();
    }

    localStreamRef.current = null;
    setLocalStreamUrl(null);
  };

  const closePeerConnection = () => {
    if (!peerConnectionRef.current) {
      return;
    }

    const peerConnectionWithHandlers = peerConnectionRef.current as unknown as PeerWithHandlers;
    peerConnectionWithHandlers.onicecandidate = null;
    peerConnectionWithHandlers.onconnectionstatechange = null;
    peerConnectionRef.current.close();
    peerConnectionRef.current = null;
    pendingIceCandidatesRef.current = [];
  };

  const closeWebSocket = () => {
    if (!wsRef.current) {
      return;
    }

    wsRef.current.onopen = null;
    wsRef.current.onmessage = null;
    wsRef.current.onerror = null;
    wsRef.current.onclose = null;
    wsRef.current.close();
    wsRef.current = null;
  };

  const resetWebRtcSession = () => {
    closePeerConnection();
    clearLocalStream();
    offerInFlightRef.current = false;
  };

  const cleanupAll = () => {
    closeWebSocket();
    resetWebRtcSession();
    setIsStreaming(false);
  };

  const sendToDesktop = (payload: object) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Desktop signaling socket is not connected.');
    }

    wsRef.current.send(JSON.stringify(payload));
  };

  const flushPendingIceCandidates = async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection || !peerConnection.remoteDescription) {
      return;
    }

    for (const candidate of pendingIceCandidatesRef.current) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    pendingIceCandidatesRef.current = [];
  };

  const createPeerConnection = async () => {
    closePeerConnection();
    clearLocalStream();

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const peerConnectionWithHandlers = peerConnection as unknown as PeerWithHandlers;

    peerConnectionWithHandlers.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      try {
        sendToDesktop({
          candidate: event.candidate.toJSON(),
          type: 'candidate',
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to send candidate.';
        setStatusSafe(message);
      }
    };

    peerConnectionWithHandlers.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        setStatusSafe(`Streaming ${selectedResolution.label} to desktop.`);
        return;
      }

      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setStatusSafe(`Peer state: ${state}`);
      }
    };

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        deviceId: selectedCameraDeviceId || undefined,
        facingMode: cameraFacing,
        frameRate: { ideal: selectedResolution.frameRate, max: selectedResolution.frameRate },
        height: { ideal: selectedResolution.height },
        width: { ideal: selectedResolution.width },
      },
    });

    localStreamRef.current = stream;
    setLocalStreamUrl(stream.toURL());

    for (const track of stream.getTracks()) {
      peerConnection.addTrack(track, stream);
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMicEnabled;
    }

    const activeTrack = stream.getVideoTracks()[0];
    if (activeTrack) {
      await applyZoomToTrack(activeTrack.id, zoomLevel, false);
    }

    peerConnectionRef.current = peerConnection;
  };

  const sendOffer = async () => {
    if (offerInFlightRef.current) {
      return;
    }

    offerInFlightRef.current = true;
    try {
      await createPeerConnection();
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        throw new Error('Peer connection was not created.');
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      if (!peerConnection.localDescription) {
        throw new Error('Unable to create local offer.');
      }

      sendToDesktop({
        sdp: peerConnection.localDescription.toJSON(),
        type: 'offer',
      });
      setStatusSafe(`Offer sent (${selectedResolution.label}). Waiting for desktop answer...`);
    } finally {
      offerInFlightRef.current = false;
    }
  };

  const handleDesktopMessage = async (rawData: string) => {
    let message: DesktopSignalMessage;

    try {
      message = JSON.parse(rawData) as DesktopSignalMessage;
    } catch {
      setStatusSafe('Received malformed signaling message.');
      return;
    }

    if (message.type === 'ready') {
      setStatusSafe('Desktop is ready. Creating offer...');
      await sendOffer();
      return;
    }

    if (message.type === 'answer') {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        return;
      }

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(message.sdp),
      );
      await flushPendingIceCandidates();
      setStatusSafe(`Desktop answer received (${selectedResolution.label}).`);
      return;
    }

    if (message.type === 'candidate') {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        return;
      }

      if (!peerConnection.remoteDescription) {
        pendingIceCandidatesRef.current.push(message.candidate);
        return;
      }

      await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
      return;
    }

    if (message.type === 'error') {
      setStatusSafe(`Desktop error: ${message.message}`);
    }
  };

  const startStreaming = () => {
    if (!signalingUrl) {
      setStatusSafe('Set desktop IP in Settings first.');
      return;
    }

    cleanupAll();
    setIsStreaming(true);
    setStatusSafe(`Connecting to ${signalingUrl}...`);

    const ws = new WebSocket(signalingUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatusSafe('Connected to signaling server. Waiting for desktop ready...');
    };

    ws.onmessage = async (event) => {
      try {
        if (typeof event.data !== 'string') {
          return;
        }

        await handleDesktopMessage(event.data);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed during signaling.';
        setStatusSafe(message);
      }
    };

    ws.onerror = () => {
      const connectionState = peerConnectionRef.current?.connectionState;
      const hasLiveMediaSession =
        connectionState === 'connecting' || connectionState === 'connected';

      if (hasLiveMediaSession) {
        setStatusSafe('Signaling disconnected. Media session is still running.');
        return;
      }

      setStatusSafe('Signaling connection failed before media session was established.');
      cleanupAll();
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      const connectionState = peerConnectionRef.current?.connectionState;
      const hasLiveMediaSession =
        connectionState === 'connecting' || connectionState === 'connected';

      if (hasLiveMediaSession) {
        setStatusSafe('Signaling closed. Media session is still running.');
        return;
      }

      resetWebRtcSession();
      setIsStreaming(false);
      setStatusSafe('Signaling disconnected.');
    };
  };

  const stopStreaming = () => {
    setStatusSafe('Streaming stopped.');
    cleanupAll();
  };

  const switchCamera = () => {
    const nextFacing: CameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(nextFacing);
    const nextFacingDevices = videoInputDevices.filter((device) => device.facing === nextFacing);
    setSelectedCameraDeviceId(nextFacingDevices[0]?.deviceId ?? null);
    setStatusSafe(`Switching to ${nextFacing === 'user' ? 'front' : 'back'} camera...`);
  };

  const cycleLens = () => {
    const currentFacingDevices = videoInputDevices.filter(
      (device) => device.facing === cameraFacing,
    );

    if (currentFacingDevices.length <= 1) {
      setStatusSafe('No extra lens available for this side.');
      return;
    }

    const currentIndex = currentFacingDevices.findIndex(
      (device) => device.deviceId === selectedCameraDeviceId,
    );
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % currentFacingDevices.length : 0;
    const nextDevice = currentFacingDevices[nextIndex];
    setSelectedCameraDeviceId(nextDevice.deviceId);
    setStatusSafe(`Lens: ${nextDevice.label}`);
  };

  const cycleResolution = () => {
    const currentIndex = RESOLUTION_PRESETS.findIndex(
      (preset) => preset.key === selectedResolutionKey,
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % RESOLUTION_PRESETS.length : 0;
    const nextPreset = RESOLUTION_PRESETS[nextIndex];
    setSelectedResolutionKey(nextPreset.key);
    setStatusSafe(`Resolution set to ${nextPreset.label}`);
  };

  const toggleMic = () => {
    setIsMicEnabled((current) => {
      const next = !current;
      const audioTrack = getActiveAudioTrack();
      if (audioTrack) {
        audioTrack.enabled = next;
      }
      setStatusSafe(next ? 'Microphone enabled.' : 'Microphone muted.');
      return next;
    });
  };

  const togglePreviewMirror = () => {
    setIsPreviewMirrored((current) => {
      const next = !current;
      setStatusSafe(next ? 'Horizontal preview flip enabled.' : 'Horizontal preview flip disabled.');
      return next;
    });
  };

  const togglePictureInPicture = () => {
    if (Platform.OS !== 'ios') {
      setStatusSafe('Picture in Picture is currently supported on iOS only.');
      return;
    }

    if (!localStreamRef.current || !localStreamUrl) {
      setStatusSafe('Start the camera stream first, then enter Picture in Picture.');
      return;
    }

    if (!pipViewRef.current) {
      setStatusSafe('Picture in Picture view is not ready yet.');
      return;
    }

    if (isPipEnabled) {
      setIsPipEnabled(false);
      stopPictureInPicture();
      setStatusSafe('Picture in Picture disabled.');
      return;
    }

    try {
      setIsPipEnabled(true);
      startIOSPIP(pipViewRef);
      setIsPipActive(true);
      setStatusSafe('Picture in Picture enabled.');
    } catch (error) {
      setIsPipEnabled(false);
      setIsPipActive(false);
      const message =
        error instanceof Error ? error.message : 'Unable to toggle Picture in Picture.';
      setStatusSafe(message);
    }
  };

  const handleZoomSliderChange = (value: number) => {
    const clamped = clampZoom(value);
    setZoomLevel(clamped);

    const activeTrack = getActiveVideoTrack();
    if (!activeTrack) {
      return;
    }

    applyZoomToTrack(activeTrack.id, clamped, false).catch(() => {
      // status is already handled when needed
    });
  };

  const handleZoomSliderComplete = (value: number) => {
    const clamped = clampZoom(value);
    setStatusSafe(`Zoom ${clamped.toFixed(1)}x`);
  };

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setPreviewSize({
      height: Math.max(height, 1),
      width: Math.max(width, 1),
    });
  };

  const focusOnTappedPoint = async (event: GestureResponderEvent) => {
    const stream = localStreamRef.current;
    const videoTrack = stream?.getVideoTracks()[0];

    if (!videoTrack) {
      return;
    }

    if (Platform.OS !== 'ios') {
      setStatusSafe('Tap-to-focus is currently supported on iOS only.');
      return;
    }

    const { locationX, locationY } = event.nativeEvent;
    setFocusIndicator({
      visible: true,
      x: locationX,
      y: locationY,
    });

    if (focusHideTimeoutRef.current) {
      clearTimeout(focusHideTimeoutRef.current);
    }

    focusHideTimeoutRef.current = setTimeout(() => {
      setFocusIndicator((current) => ({ ...current, visible: false }));
    }, 700);

    const nativeWebRTCModule = getNativeWebRTCModule();

    if (!nativeWebRTCModule.mediaStreamTrackFocusAtPoint) {
      setStatusSafe('Tap-to-focus is unavailable in this build.');
      return;
    }

    try {
      const normalizedX = clamp01(locationX / previewSize.width);
      const focusX = isPreviewMirrored ? 1 - normalizedX : normalizedX;
      await nativeWebRTCModule.mediaStreamTrackFocusAtPoint(
        videoTrack.id,
        focusX,
        clamp01(locationY / previewSize.height),
      );
      setStatusSafe('Focused.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to focus at tapped point.';
      setStatusSafe(message);
    }
  };

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setStatusSafe(`Applying camera changes...`);
    sendOffer().catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to apply camera changes.';
      setStatusSafe(message);
    });
  }, [selectedResolution, cameraFacing, selectedCameraDeviceId, isStreaming]);

  useEffect(() => {
    refreshVideoInputs().catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to load camera devices.';
      setStatusSafe(message);
    });
  }, []);

  useEffect(() => {
    const firstDeviceForFacing = videoInputDevices.find(
      (device) => device.facing === cameraFacing,
    );
    if (!firstDeviceForFacing) {
      return;
    }

    const selectedMatchesFacing = videoInputDevices.some(
      (device) =>
        device.deviceId === selectedCameraDeviceId && device.facing === cameraFacing,
    );

    if (!selectedMatchesFacing) {
      setSelectedCameraDeviceId(firstDeviceForFacing.deviceId);
    }
  }, [cameraFacing, selectedCameraDeviceId, videoInputDevices]);

  useEffect(() => {
    if (isSettingsVisible) {
      refreshVideoInputs().catch(() => {
        // ignore, camera may be unavailable until permissions are granted
      });
    }
  }, [isSettingsVisible]);

  useEffect(() => {
    Animated.timing(infoCardProgress, {
      duration: 170,
      toValue: isInfoPanelVisible ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [infoCardProgress, isInfoPanelVisible]);

  useEffect(() => {
    return () => {
      if (focusHideTimeoutRef.current) {
        clearTimeout(focusHideTimeoutRef.current);
      }
      cleanupAll();
    };
  }, []);

  return (
    <SafeAreaView style={{ backgroundColor: '#050b14', flex: 1 }}>
      <StatusBar style="light" />

      <View
        onLayout={onPreviewLayout}
        style={{ backgroundColor: '#050b14', flex: 1 }}
      >
        {localStreamUrl ? (
          Platform.OS === 'ios' ? (
            <RTCPIPView
              ref={pipViewRef}
              iosPIP={{
                enabled: isPipEnabled,
                preferredSize: { height: 360, width: 640 },
                startAutomatically: isPipEnabled,
                stopAutomatically: true,
              }}
              mirror={isPreviewMirrored}
              objectFit="cover"
              streamURL={localStreamUrl}
              style={{ ...StyleSheet.absoluteFillObject }}
            />
          ) : (
            <RTCView
              mirror={isPreviewMirrored}
              objectFit="cover"
              streamURL={localStreamUrl}
              style={{ ...StyleSheet.absoluteFillObject }}
            />
          )
        ) : (
          <View
            style={{
              ...StyleSheet.absoluteFillObject,
              alignItems: 'center',
              backgroundColor: '#050b14',
              justifyContent: 'center',
              paddingHorizontal: 24,
            }}
          >
            <Text
              style={{
                color: '#edf5ff',
                fontSize: 28,
                fontWeight: '800',
                marginBottom: 8,
              }}
            >
              Camera Preview
            </Text>
            <Text style={{ color: '#a8b7cc', fontSize: 14 }}>
              Tap Start to stream to desktop
            </Text>
          </View>
        )}
        <Pressable
          onPress={focusOnTappedPoint}
          style={{ ...StyleSheet.absoluteFillObject }}
        />

        {focusIndicator.visible ? (
          <View
            pointerEvents="none"
            style={[
              {
                borderColor: '#f7fcff',
                borderRadius: 999,
                borderWidth: 2,
                height: 52,
                position: 'absolute',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.32,
                shadowRadius: 6,
                width: 52,
              },
              {
                left: focusIndicator.x - 26,
                top: focusIndicator.y - 26,
              },
            ]}
          />
        ) : null}

        <View
          style={{
            alignItems: 'flex-end',
            paddingHorizontal: 14,
            paddingTop: 12,
            gap: 8
          }}
        >
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={switchCamera} style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>Flip</Text>
              </Pressable>
              <Pressable onPress={cycleLens} style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>Lens</Text>
              </Pressable>
              <Pressable onPress={cycleResolution} style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>Res</Text>
              </Pressable>
              {Platform.OS === 'ios' ? (
                <Pressable
                  onPress={togglePictureInPicture}
                  style={[
                    styles.settingsButton,
                    isPipEnabled && {
                      backgroundColor: 'rgba(16, 169, 225, 0.3)',
                      borderColor: 'rgba(89, 197, 234, 0.9)',
                    },
                  ]}
                >
                  <Text style={styles.settingsButtonText}>
                    {isPipEnabled ? 'PiP On' : 'PiP Off'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setIsSettingsVisible(true)} style={styles.settingsButton}>
                <Text style={styles.settingsButtonText}>Settings</Text>
              </Pressable>
            </View>
            <View style={{ 
                  paddingHorizontal: 10,
                  backgroundColor: 'rgba(3, 10, 20, 0.75)',
                  borderColor: 'rgba(113, 140, 178, 0.45)',
                  borderRadius: 10,
                  borderWidth: 1,
                  paddingVertical: 6,
             }}>
              <Text
                style={{
                  color: '#ebf3ff',
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {status}
              </Text>
            </View>
        </View>

        <View
          style={{
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
          }}
        >
          <View
            style={{
              alignItems: 'flex-start',
              flexDirection: 'row',
              marginBottom: 8,
            }}
          >
            <Pressable
              onPress={() => setIsInfoPanelVisible((current) => !current)}
              style={{
                alignItems: 'center',
                alignSelf: 'flex-start',
                backgroundColor: 'rgba(6, 17, 31, 0.9)',
                borderColor: 'rgba(113, 140, 178, 0.55)',
                borderRadius: 8,
                borderWidth: 1,
                justifyContent: 'center',
                minHeight: 28,
                minWidth: 28,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: '#c4d4ea',
                  fontSize: 16,
                  fontWeight: '800',
                  lineHeight: 18,
                }}
              >
                {isInfoPanelVisible ? '‹' : '›'}
              </Text>
            </Pressable>

            {isInfoPanelVisible ? (
              <Animated.View
                style={{
                  backgroundColor: 'rgba(6, 17, 31, 0.9)',
                  borderColor: 'rgba(113, 140, 178, 0.45)',
                  borderRadius: 10,
                  borderWidth: 1,
                  marginLeft: 8,
                  maxWidth: '88%',
                  opacity: infoCardProgress,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  transform: [
                    {
                      translateX: infoCardProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-16, 0],
                      }),
                    },
                  ],
                }}
              >
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  {signalingUrl ? signalingUrl : 'No desktop URL configured'}
                </Text>
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  Resolution: {selectedResolution.label}
                </Text>
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  Camera: {cameraFacingLabel}
                </Text>
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  Lens: {selectedCameraLabel}
                </Text>
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  Mic: {isMicEnabled ? 'On' : 'Muted'}
                </Text>
                <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                  Flip: {isPreviewMirrored ? 'Horizontal On' : 'Off'}
                </Text>
                {Platform.OS === 'ios' ? (
                  <Text style={{ color: '#c4d4ea', fontSize: 12, marginBottom: 4, writingDirection: 'ltr' }}>
                    PiP: {isPipEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                ) : null}
                <Text style={{ color: '#c4d4ea', fontSize: 12, writingDirection: 'ltr' }}>
                  Zoom: {zoomLevel.toFixed(1)}x
                </Text>
              </Animated.View>
            ) : null}
          </View>

<View style={{
            backgroundColor: 'rgba(3, 10, 20, 0.74)',
            borderTopColor: 'rgba(113, 140, 178, 0.4)',
            borderTopWidth: 1,
            paddingBottom: 18,
            paddingHorizontal: 16,
            paddingTop: 12,

}}>

          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              gap: 8,
              marginBottom: 2,
              marginTop: 4,
            }}
          >
            <Text style={styles.zoomEdgeLabel}>1x</Text>
            <Slider
              maximumTrackTintColor="rgba(180, 203, 233, 0.6)"
              minimumTrackTintColor="#59c5ea"
              minimumValue={MIN_ZOOM}
              maximumValue={MAX_ZOOM}
              onSlidingComplete={handleZoomSliderComplete}
              onValueChange={handleZoomSliderChange}
              step={0.1}
              style={{ flex: 1, height: 34 }}
              thumbTintColor="#f5f9ff"
              value={zoomLevel}
            />
            <Text style={styles.zoomEdgeLabel}>6x</Text>
          </View>

          <Pressable
            onPress={isStreaming ? stopStreaming : startStreaming}
            style={[
              {
                alignItems: 'center',
                borderRadius: 12,
                marginTop: 8,
                paddingVertical: 14,
              },
              {
                backgroundColor: isStreaming ? '#db5a68' : '#10a9e1',
              },
            ]}
          >
            <Text
              style={{
                color: '#f5f9ff',
                fontSize: 16,
                fontWeight: '800',
                letterSpacing: 0.2,
              }}
            >
              {isStreaming ? 'Stop Stream' : 'Start Stream'}
            </Text>
          </Pressable>
</View>
        </View>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsSettingsVisible(false)}
        transparent
        visible={isSettingsVisible}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setIsSettingsVisible(false)}
            style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: 'rgba(0, 0, 0, 0.56)',
            }}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ justifyContent: 'flex-end' }}
          >
            <View
              style={{
                backgroundColor: '#f5f8fc',
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                maxHeight: '88%',
                paddingBottom: 22,
                paddingHorizontal: 16,
                paddingTop: 10,
              }}
            >
              <View
                style={{
                  alignSelf: 'center',
                  backgroundColor: '#c6d2e3',
                  borderRadius: 999,
                  height: 4,
                  marginBottom: 10,
                  width: 48,
                }}
              />
              <ScrollView
                contentContainerStyle={{ paddingBottom: 6 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ marginTop: 2 }}
              >
                <Text
                  style={{
                    color: '#0f1f34',
                    fontSize: 18,
                    fontWeight: '800',
                    marginBottom: 14,
                  }}
                >
                  Connection & Quality
                </Text>

                <Text style={styles.sheetLabel}>Desktop IP or ws:// URL</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setDesktopIp}
                  placeholder="192.168.1.20 or ws://192.168.1.20:3333"
                  placeholderTextColor="#6f809d"
                  style={styles.sheetInput}
                  value={desktopIp}
                />

                <Text style={styles.sheetLabel}>Port</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={setDesktopPort}
                  placeholder={DEFAULT_SIGNALING_PORT}
                  placeholderTextColor="#6f809d"
                  style={styles.sheetInput}
                  value={desktopPort}
                />

                <Text
                  style={{
                    color: '#556d8d',
                    fontSize: 12,
                    marginTop: 8,
                  }}
                >
                  Current URL: {signalingUrl || 'Not set'}
                </Text>

                <Text style={styles.sheetLabel}>Audio</Text>
                <View style={styles.resolutionList}>
                  <Pressable
                    onPress={toggleMic}
                    style={[
                      styles.resolutionItem,
                      isMicEnabled && styles.resolutionItemSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.resolutionText,
                        isMicEnabled && styles.resolutionTextSelected,
                      ]}
                    >
                      {isMicEnabled ? 'Microphone: On' : 'Microphone: Muted'}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.sheetLabel}>Resolution</Text>
                <View style={styles.resolutionList}>
                  {RESOLUTION_PRESETS.map((preset) => {
                    const selected = preset.key === selectedResolutionKey;
                    return (
                      <Pressable
                        key={preset.key}
                        onPress={() => setSelectedResolutionKey(preset.key)}
                        style={[
                          styles.resolutionItem,
                          selected && styles.resolutionItemSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.resolutionText,
                            selected && styles.resolutionTextSelected,
                          ]}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.sheetHint}>
                  Resolution changes while streaming are applied immediately.
                </Text>

                <Text style={styles.sheetLabel}>Preview</Text>
                <View style={styles.resolutionList}>
                  <Pressable
                    onPress={togglePreviewMirror}
                    style={[
                      styles.resolutionItem,
                      isPreviewMirrored && styles.resolutionItemSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.resolutionText,
                        isPreviewMirrored && styles.resolutionTextSelected,
                      ]}
                    >
                      {isPreviewMirrored ? 'Horizontal Flip: On' : 'Horizontal Flip: Off'}
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.sheetLabel}>Camera Side</Text>
                <View style={styles.resolutionList}>
                  <Pressable
                    onPress={() => setCameraFacing('environment')}
                    style={[
                      styles.resolutionItem,
                      cameraFacing === 'environment' && styles.resolutionItemSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.resolutionText,
                        cameraFacing === 'environment' && styles.resolutionTextSelected,
                      ]}
                    >
                      Back Camera
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCameraFacing('user')}
                    style={[
                      styles.resolutionItem,
                      cameraFacing === 'user' && styles.resolutionItemSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.resolutionText,
                        cameraFacing === 'user' && styles.resolutionTextSelected,
                      ]}
                    >
                      Front Camera
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.sheetLabel}>Lens</Text>
                <View style={styles.resolutionList}>
                  {camerasForCurrentFacing.length > 0 ? (
                    camerasForCurrentFacing.map((device) => {
                      const selected = device.deviceId === selectedCameraDeviceId;
                      return (
                        <Pressable
                          key={device.deviceId}
                          onPress={() => setSelectedCameraDeviceId(device.deviceId)}
                          style={[
                            styles.resolutionItem,
                            selected && styles.resolutionItemSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.resolutionText,
                              selected && styles.resolutionTextSelected,
                            ]}
                          >
                            {device.label}
                          </Text>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={styles.sheetHint}>No lenses detected yet.</Text>
                  )}
                </View>

                <Pressable
                  onPress={() => void refreshVideoInputs()}
                  style={{
                    alignItems: 'center',
                    borderColor: '#7da4c9',
                    borderRadius: 10,
                    borderWidth: 1,
                    marginTop: 10,
                    paddingVertical: 10,
                  }}
                >
                  <Text
                    style={{
                      color: '#335a83',
                      fontSize: 13,
                      fontWeight: '700',
                    }}
                  >
                    Refresh Lenses
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setIsSettingsVisible(false)}
                  style={{
                    alignItems: 'center',
                    backgroundColor: '#0f9ecf',
                    borderRadius: 10,
                    marginTop: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Text
                    style={{
                      color: '#f5f9ff',
                      fontSize: 15,
                      fontWeight: '800',
                    }}
                  >
                    Done
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  settingsButton: {
    backgroundColor: 'rgba(8, 19, 34, 0.8)',
    borderColor: 'rgba(113, 140, 178, 0.5)',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  settingsButtonText: {
    color: '#dce8f8',
    fontSize: 12,
    fontWeight: '700',
  },
  zoomEdgeLabel: {
    color: '#d4e3f8',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetLabel: {
    color: '#1f3654',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 8,
  },
  sheetInput: {
    backgroundColor: '#ffffff',
    borderColor: '#c7d5e7',
    borderRadius: 10,
    borderWidth: 1,
    color: '#13263f',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resolutionList: {
    gap: 8,
    marginTop: 2,
  },
  resolutionItem: {
    backgroundColor: '#ffffff',
    borderColor: '#c7d5e7',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  resolutionItemSelected: {
    backgroundColor: '#def4ff',
    borderColor: '#5db5dd',
  },
  resolutionText: {
    color: '#1f3654',
    fontSize: 14,
    fontWeight: '600',
  },
  resolutionTextSelected: {
    color: '#054e72',
  },
  sheetHint: {
    color: '#556d8d',
    fontSize: 12,
    marginTop: 12,
  },
});
