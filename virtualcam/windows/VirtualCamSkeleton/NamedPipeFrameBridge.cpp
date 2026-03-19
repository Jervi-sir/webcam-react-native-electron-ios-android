#include "FrameBridge.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr std::array<uint8_t, 4> kMagic = {'E', 'V', 'C', 'M'};
constexpr size_t kHeaderSize = 20;
constexpr uint32_t kMaxPayloadBytes = 20 * 1024 * 1024;

uint16_t ReadUInt16LE(const std::vector<uint8_t>& data, size_t offset) {
  return static_cast<uint16_t>(data[offset]) |
         (static_cast<uint16_t>(data[offset + 1]) << 8);
}

uint32_t ReadUInt32LE(const std::vector<uint8_t>& data, size_t offset) {
  return static_cast<uint32_t>(data[offset]) |
         (static_cast<uint32_t>(data[offset + 1]) << 8) |
         (static_cast<uint32_t>(data[offset + 2]) << 16) |
         (static_cast<uint32_t>(data[offset + 3]) << 24);
}

uint64_t ReadUInt64LE(const std::vector<uint8_t>& data, size_t offset) {
  uint64_t value = 0;
  for (size_t i = 0; i < 8; ++i) {
    value |= static_cast<uint64_t>(data[offset + i]) << (i * 8);
  }
  return value;
}

class TcpFrameBridge : public FrameBridge {
 public:
  TcpFrameBridge(std::string host, uint16_t port)
      : host_(std::move(host)), port_(port) {}

  ~TcpFrameBridge() override { Stop(); }

  bool Start() override {
    if (running_.exchange(true)) {
      return true;
    }

    if (WSAStartup(MAKEWORD(2, 2), &wsaData_) != 0) {
      running_ = false;
      return false;
    }

    worker_ = std::thread([this] { WorkerLoop(); });
    return true;
  }

  void Stop() override {
    if (!running_.exchange(false)) {
      return;
    }

    if (socket_ != INVALID_SOCKET) {
      shutdown(socket_, SD_BOTH);
      closesocket(socket_);
      socket_ = INVALID_SOCKET;
    }

    if (worker_.joinable()) {
      worker_.join();
    }

    WSACleanup();
  }

  bool ReadLatestFrame(FramePacket& outFrame) override {
    std::lock_guard<std::mutex> guard(frameMutex_);
    if (!hasFrame_) {
      return false;
    }

    outFrame = latestFrame_;
    return true;
  }

 private:
  void WorkerLoop() {
    while (running_) {
      if (!Connect()) {
        Sleep(1000);
        continue;
      }

      ReceiveLoop();

      if (socket_ != INVALID_SOCKET) {
        closesocket(socket_);
        socket_ = INVALID_SOCKET;
      }

      if (running_) {
        Sleep(1000);
      }
    }
  }

  bool Connect() {
    socket_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket_ == INVALID_SOCKET) {
      return false;
    }

    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_port = htons(port_);

    if (inet_pton(AF_INET, host_.c_str(), &address.sin_addr) != 1) {
      closesocket(socket_);
      socket_ = INVALID_SOCKET;
      return false;
    }

    if (connect(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) ==
        SOCKET_ERROR) {
      closesocket(socket_);
      socket_ = INVALID_SOCKET;
      return false;
    }

    return true;
  }

  void ReceiveLoop() {
    std::array<uint8_t, 64 * 1024> recvBuffer {};
    std::vector<uint8_t> streamBuffer;

    while (running_) {
      int received = recv(socket_, reinterpret_cast<char*>(recvBuffer.data()),
                          static_cast<int>(recvBuffer.size()), 0);
      if (received <= 0) {
        return;
      }

      streamBuffer.insert(streamBuffer.end(), recvBuffer.begin(),
                          recvBuffer.begin() + received);
      ParseFrames(streamBuffer);
    }
  }

  void ParseFrames(std::vector<uint8_t>& streamBuffer) {
    while (streamBuffer.size() >= kHeaderSize) {
      if (!HasMagicPrefix(streamBuffer)) {
        const size_t next = FindMagicOffset(streamBuffer);
        if (next == static_cast<size_t>(-1)) {
          streamBuffer.clear();
          return;
        }

        if (next > 0) {
          streamBuffer.erase(streamBuffer.begin(),
                             streamBuffer.begin() + static_cast<long long>(next));
        }

        if (streamBuffer.size() < kHeaderSize) {
          return;
        }
      }

      const uint32_t payloadLength = ReadUInt32LE(streamBuffer, 16);
      if (payloadLength == 0 || payloadLength > kMaxPayloadBytes) {
        streamBuffer.erase(streamBuffer.begin(), streamBuffer.begin() + 4);
        continue;
      }

      const size_t frameBytes = kHeaderSize + payloadLength;
      if (streamBuffer.size() < frameBytes) {
        return;
      }

      FramePacket packet;
      packet.width = ReadUInt16LE(streamBuffer, 4);
      packet.height = ReadUInt16LE(streamBuffer, 6);
      packet.timestampNs = ReadUInt64LE(streamBuffer, 8);
      packet.jpegData.assign(
          streamBuffer.begin() + static_cast<long long>(kHeaderSize),
          streamBuffer.begin() + static_cast<long long>(frameBytes));

      {
        std::lock_guard<std::mutex> guard(frameMutex_);
        latestFrame_ = std::move(packet);
        hasFrame_ = true;
      }

      streamBuffer.erase(streamBuffer.begin(),
                         streamBuffer.begin() + static_cast<long long>(frameBytes));
    }
  }

  bool HasMagicPrefix(const std::vector<uint8_t>& streamBuffer) const {
    return streamBuffer[0] == kMagic[0] && streamBuffer[1] == kMagic[1] &&
           streamBuffer[2] == kMagic[2] && streamBuffer[3] == kMagic[3];
  }

  size_t FindMagicOffset(const std::vector<uint8_t>& streamBuffer) const {
    if (streamBuffer.size() < 4) {
      return static_cast<size_t>(-1);
    }

    for (size_t offset = 0; offset + 3 < streamBuffer.size(); ++offset) {
      if (streamBuffer[offset] == kMagic[0] &&
          streamBuffer[offset + 1] == kMagic[1] &&
          streamBuffer[offset + 2] == kMagic[2] &&
          streamBuffer[offset + 3] == kMagic[3]) {
        return offset;
      }
    }

    return static_cast<size_t>(-1);
  }

  std::string host_;
  uint16_t port_;
  std::atomic<bool> running_ {false};
  SOCKET socket_ = INVALID_SOCKET;
  WSADATA wsaData_ {};
  std::thread worker_;
  std::mutex frameMutex_;
  FramePacket latestFrame_;
  bool hasFrame_ = false;
};

}  // namespace

std::unique_ptr<FrameBridge> CreateDefaultFrameBridge(
    const std::string& host,
    uint16_t port) {
  return std::make_unique<TcpFrameBridge>(host, port);
}
