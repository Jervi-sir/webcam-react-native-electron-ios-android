#include "FrameBridge.h"

#include <chrono>
#include <thread>

int RunVirtualCameraSource(FrameBridge& bridge) {
  if (!bridge.Start()) {
    return 1;
  }

  // Replace this polling loop with your Media Foundation source stream write path.
  // The bridge already yields JPEG packets from Electron over loopback TCP.
  FramePacket latestFrame;
  for (;;) {
    if (bridge.ReadLatestFrame(latestFrame)) {
    // TODO: decode JPEG and push into IMFMediaBuffer / IMFSample output.
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(16));
  }

  bridge.Stop();
  return 0;
}

int RunVirtualCameraSourceDefault() {
  auto bridge = CreateDefaultFrameBridge("127.0.0.1", 19777);
  return RunVirtualCameraSource(*bridge);
}
