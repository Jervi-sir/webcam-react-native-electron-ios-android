#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct FramePacket {
  uint16_t width;
  uint16_t height;
  uint64_t timestampNs;
  std::vector<uint8_t> jpegData;
};

class FrameBridge {
 public:
  virtual ~FrameBridge() = default;
  virtual bool Start() = 0;
  virtual void Stop() = 0;
  virtual bool ReadLatestFrame(FramePacket& outFrame) = 0;
};

// Creates a default frame bridge that connects to Electron over loopback TCP.
std::unique_ptr<FrameBridge> CreateDefaultFrameBridge(
    const std::string& host = "127.0.0.1",
    uint16_t port = 19777);
