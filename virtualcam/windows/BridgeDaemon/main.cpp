#include <winsock2.h>
#include <ws2tcpip.h>

#include <array>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {
constexpr uint16_t kDefaultPort = 19777;
constexpr size_t kHeaderSize = 20;
constexpr uint32_t kMaxPayloadBytes = 20 * 1024 * 1024;
const std::array<uint8_t, 4> kMagic = {'E', 'V', 'C', 'M'};

struct DaemonOptions {
  uint16_t port = kDefaultPort;
  fs::path outputDir;
};

struct FramePacket {
  uint16_t width = 0;
  uint16_t height = 0;
  uint64_t timestampNs = 0;
  std::vector<uint8_t> jpeg;
};

std::string nowIso8601() {
  auto now = std::chrono::system_clock::now();
  std::time_t seconds = std::chrono::system_clock::to_time_t(now);

  std::tm tmValue {};
  gmtime_s(&tmValue, &seconds);

  std::ostringstream out;
  out << std::put_time(&tmValue, "%Y-%m-%dT%H:%M:%SZ");
  return out.str();
}

uint16_t readUInt16LE(const std::vector<uint8_t>& data, size_t offset) {
  return static_cast<uint16_t>(data[offset]) |
         (static_cast<uint16_t>(data[offset + 1]) << 8);
}

uint32_t readUInt32LE(const std::vector<uint8_t>& data, size_t offset) {
  return static_cast<uint32_t>(data[offset]) |
         (static_cast<uint32_t>(data[offset + 1]) << 8) |
         (static_cast<uint32_t>(data[offset + 2]) << 16) |
         (static_cast<uint32_t>(data[offset + 3]) << 24);
}

uint64_t readUInt64LE(const std::vector<uint8_t>& data, size_t offset) {
  uint64_t value = 0;
  for (size_t i = 0; i < 8; ++i) {
    value |= static_cast<uint64_t>(data[offset + i]) << (i * 8);
  }
  return value;
}

class FrameDecoder {
 public:
  void append(const uint8_t* bytes, size_t length) {
    buffer_.insert(buffer_.end(), bytes, bytes + length);
  }

  std::vector<FramePacket> extractPackets() {
    std::vector<FramePacket> packets;

    while (true) {
      if (buffer_.size() < kHeaderSize) {
        break;
      }

      if (!hasMagicPrefix()) {
        size_t nextMagic = findNextMagic();
        if (nextMagic == std::string::npos) {
          buffer_.clear();
          break;
        }

        if (nextMagic > 0) {
          buffer_.erase(buffer_.begin(), buffer_.begin() + static_cast<long long>(nextMagic));
        }

        if (buffer_.size() < kHeaderSize) {
          break;
        }
      }

      const uint16_t width = readUInt16LE(buffer_, 4);
      const uint16_t height = readUInt16LE(buffer_, 6);
      const uint64_t timestampNs = readUInt64LE(buffer_, 8);
      const uint32_t payloadLength = readUInt32LE(buffer_, 16);

      if (payloadLength == 0 || payloadLength > kMaxPayloadBytes) {
        buffer_.erase(buffer_.begin(), buffer_.begin() + 4);
        continue;
      }

      const size_t fullPacketSize = kHeaderSize + payloadLength;
      if (buffer_.size() < fullPacketSize) {
        break;
      }

      FramePacket packet;
      packet.width = width;
      packet.height = height;
      packet.timestampNs = timestampNs;
      packet.jpeg.assign(
          buffer_.begin() + static_cast<long long>(kHeaderSize),
          buffer_.begin() + static_cast<long long>(fullPacketSize));

      buffer_.erase(buffer_.begin(), buffer_.begin() + static_cast<long long>(fullPacketSize));
      packets.push_back(std::move(packet));
    }

    return packets;
  }

 private:
  bool hasMagicPrefix() const {
    return buffer_[0] == kMagic[0] && buffer_[1] == kMagic[1] &&
           buffer_[2] == kMagic[2] && buffer_[3] == kMagic[3];
  }

  size_t findNextMagic() const {
    if (buffer_.size() < 4) {
      return std::string::npos;
    }

    for (size_t i = 0; i + 3 < buffer_.size(); ++i) {
      if (buffer_[i] == kMagic[0] && buffer_[i + 1] == kMagic[1] &&
          buffer_[i + 2] == kMagic[2] && buffer_[i + 3] == kMagic[3]) {
        return i;
      }
    }

    return std::string::npos;
  }

  std::vector<uint8_t> buffer_;
};

class LatestFrameStore {
 public:
  explicit LatestFrameStore(fs::path outputDir) : outputDir_(std::move(outputDir)) {
    fs::create_directories(outputDir_);
    imagePath_ = outputDir_ / "latest_frame.jpg";
    metadataPath_ = outputDir_ / "latest_frame.json";
  }

  void write(const FramePacket& frame) {
    std::ofstream imageFile(imagePath_, std::ios::binary | std::ios::trunc);
    if (!imageFile) {
      std::cerr << "[bridge] failed to write " << imagePath_ << "\n";
      return;
    }
    imageFile.write(reinterpret_cast<const char*>(frame.jpeg.data()),
                    static_cast<std::streamsize>(frame.jpeg.size()));
    imageFile.close();

    ++frameCounter_;

    std::ofstream metadataFile(metadataPath_, std::ios::binary | std::ios::trunc);
    if (!metadataFile) {
      std::cerr << "[bridge] failed to write " << metadataPath_ << "\n";
      return;
    }

    metadataFile << "{\n"
                 << "  \"width\": " << frame.width << ",\n"
                 << "  \"height\": " << frame.height << ",\n"
                 << "  \"timestampNs\": " << frame.timestampNs << ",\n"
                 << "  \"jpegBytes\": " << frame.jpeg.size() << ",\n"
                 << "  \"frameCounter\": " << frameCounter_ << ",\n"
                 << "  \"updatedAt\": \"" << nowIso8601() << "\"\n"
                 << "}\n";
  }

  [[nodiscard]] const fs::path& outputDir() const { return outputDir_; }

 private:
  fs::path outputDir_;
  fs::path imagePath_;
  fs::path metadataPath_;
  uint64_t frameCounter_ = 0;
};

bool parsePort(const std::string& raw, uint16_t& outPort) {
  try {
    const int parsed = std::stoi(raw);
    if (parsed < 1 || parsed > 65535) {
      return false;
    }
    outPort = static_cast<uint16_t>(parsed);
    return true;
  } catch (...) {
    return false;
  }
}

void printUsage() {
  std::cout << "ElectronVirtualCamBridgeDaemon\n"
            << "  --port <1-65535>   TCP listen port (default: 19777)\n"
            << "  --output <path>    Output directory for latest_frame.jpg/json\n"
            << "\n"
            << "Example:\n"
            << "  ElectronVirtualCamBridgeDaemon --port 19777 --output C:\\\\Temp\\\\electron-virtualcam\n";
}

DaemonOptions parseArgs(int argc, char** argv) {
  DaemonOptions options;
  const char* tempEnv = std::getenv("TEMP");
  if (tempEnv && std::string(tempEnv).size() > 0) {
    options.outputDir = fs::path(tempEnv) / "electron-virtualcam";
  } else {
    options.outputDir = fs::temp_directory_path() / "electron-virtualcam";
  }

  for (int i = 1; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--help" || arg == "-h") {
      printUsage();
      std::exit(0);
    }

    if (arg == "--port") {
      if (i + 1 >= argc || !parsePort(argv[i + 1], options.port)) {
        throw std::runtime_error("Invalid or missing value for --port");
      }
      ++i;
      continue;
    }

    if (arg.rfind("--port=", 0) == 0) {
      if (!parsePort(arg.substr(7), options.port)) {
        throw std::runtime_error("Invalid value for --port");
      }
      continue;
    }

    if (arg == "--output") {
      if (i + 1 >= argc) {
        throw std::runtime_error("Missing value for --output");
      }
      options.outputDir = fs::path(argv[i + 1]);
      ++i;
      continue;
    }

    if (arg.rfind("--output=", 0) == 0) {
      options.outputDir = fs::path(arg.substr(9));
      continue;
    }

    throw std::runtime_error("Unknown argument: " + arg);
  }

  return options;
}

int runClientLoop(SOCKET clientSocket, LatestFrameStore& store) {
  FrameDecoder decoder;
  std::array<uint8_t, 128 * 1024> recvBuffer {};

  while (true) {
    const int received = recv(clientSocket, reinterpret_cast<char*>(recvBuffer.data()),
                              static_cast<int>(recvBuffer.size()), 0);

    if (received == 0) {
      std::cout << "[bridge] client disconnected\n";
      return 0;
    }

    if (received < 0) {
      const int errorCode = WSAGetLastError();
      std::cerr << "[bridge] recv failed, error=" << errorCode << "\n";
      return 1;
    }

    decoder.append(recvBuffer.data(), static_cast<size_t>(received));
    auto packets = decoder.extractPackets();
    for (const auto& packet : packets) {
      store.write(packet);
    }
  }
}

int runServer(const DaemonOptions& options) {
  WSADATA wsaData;
  if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
    std::cerr << "[bridge] WSAStartup failed\n";
    return 1;
  }

  SOCKET listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (listenSocket == INVALID_SOCKET) {
    std::cerr << "[bridge] socket() failed, error=" << WSAGetLastError() << "\n";
    WSACleanup();
    return 1;
  }

  sockaddr_in address {};
  address.sin_family = AF_INET;
  address.sin_port = htons(options.port);
  inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);

  if (bind(listenSocket, reinterpret_cast<sockaddr*>(&address), sizeof(address)) ==
      SOCKET_ERROR) {
    std::cerr << "[bridge] bind() failed, error=" << WSAGetLastError() << "\n";
    closesocket(listenSocket);
    WSACleanup();
    return 1;
  }

  if (listen(listenSocket, SOMAXCONN) == SOCKET_ERROR) {
    std::cerr << "[bridge] listen() failed, error=" << WSAGetLastError() << "\n";
    closesocket(listenSocket);
    WSACleanup();
    return 1;
  }

  LatestFrameStore store(options.outputDir);
  std::cout << "[bridge] listening on 127.0.0.1:" << options.port << "\n";
  std::cout << "[bridge] output directory: " << store.outputDir().string() << "\n";

  while (true) {
    sockaddr_in clientAddr {};
    int clientAddrLen = sizeof(clientAddr);
    SOCKET clientSocket = accept(listenSocket, reinterpret_cast<sockaddr*>(&clientAddr),
                                 &clientAddrLen);

    if (clientSocket == INVALID_SOCKET) {
      std::cerr << "[bridge] accept() failed, error=" << WSAGetLastError() << "\n";
      continue;
    }

    std::cout << "[bridge] client connected\n";
    (void)runClientLoop(clientSocket, store);
    closesocket(clientSocket);
  }

  closesocket(listenSocket);
  WSACleanup();
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const DaemonOptions options = parseArgs(argc, argv);
    return runServer(options);
  } catch (const std::exception& error) {
    std::cerr << "[bridge] startup failed: " << error.what() << "\n";
    return 1;
  }
}
