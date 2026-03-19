import Foundation
import CoreMedia
import CoreVideo
import Network

struct CameraFramePacket {
    let width: Int
    let height: Int
    let timestampNs: UInt64
    let pixelFormat: OSType
    let data: Data
}

protocol CameraFrameBridge {
    func start() throws
    func stop()
    func readLatestFrame() -> CameraFramePacket?
}

final class LoopbackTCPFrameBridge: CameraFrameBridge {
    private let host: String
    private let port: UInt16
    private let queue = DispatchQueue(label: "evcm.camera-bridge")
    private let lock = NSLock()
    private var latestFrame: CameraFramePacket?
    private var connection: NWConnection?
    private let decoder = FrameDecoder()
    private var running = false

    init(host: String = "127.0.0.1", port: UInt16 = 19777) {
        self.host = host
        self.port = port
    }

    func start() throws {
        guard !running else { return }
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(
                domain: "CameraFrameBridge",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid loopback port: \(port)"]
            )
        }

        running = true
        let connection = NWConnection(host: NWEndpoint.Host(host), port: endpointPort, using: .tcp)
        self.connection = connection

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .failed = state {
                self.scheduleReconnect()
            } else if case .cancelled = state {
                self.running = false
            }
        }

        connection.start(queue: queue)
        receiveLoop()
    }

    func stop() {
        running = false
        connection?.cancel()
        connection = nil
    }

    func readLatestFrame() -> CameraFramePacket? {
        lock.lock()
        defer { lock.unlock() }
        return latestFrame
    }

    private func receiveLoop() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 128 * 1024) {
            [weak self] data, _, isComplete, error in
            guard let self else { return }

            if let data, !data.isEmpty {
                let packets = self.decoder.push(data)
                if let newest = packets.last {
                    self.lock.lock()
                    self.latestFrame = newest
                    self.lock.unlock()
                }
            }

            if isComplete || error != nil {
                self.scheduleReconnect()
                return
            }

            self.receiveLoop()
        }
    }

    private func scheduleReconnect() {
        connection?.cancel()
        connection = nil

        guard running else { return }
        queue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self, self.running else { return }
            try? self.start()
        }
    }
}

private final class FrameDecoder {
    private var buffer = Data()
    private let magic: [UInt8] = [0x45, 0x56, 0x43, 0x4D] // EVCM

    func push(_ chunk: Data) -> [CameraFramePacket] {
        buffer.append(chunk)
        var packets: [CameraFramePacket] = []

        while true {
            guard buffer.count >= 20 else { break }
            if !hasMagicPrefix() {
                guard let next = findMagicOffset() else {
                    buffer.removeAll(keepingCapacity: true)
                    break
                }
                if next > 0 {
                    buffer.removeFirst(next)
                }
                guard buffer.count >= 20 else { break }
            }

            let width = Int(readUInt16LE(at: 4))
            let height = Int(readUInt16LE(at: 6))
            let timestampNs = readUInt64LE(at: 8)
            let payloadLength = Int(readUInt32LE(at: 16))

            guard payloadLength > 0, payloadLength <= (20 * 1024 * 1024) else {
                buffer.removeFirst(4)
                continue
            }

            let packetLength = 20 + payloadLength
            guard buffer.count >= packetLength else { break }

            let payload = buffer.subdata(in: 20..<packetLength)
            buffer.removeFirst(packetLength)

            packets.append(
                CameraFramePacket(
                    width: width,
                    height: height,
                    timestampNs: timestampNs,
                    pixelFormat: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                    data: payload
                )
            )
        }

        return packets
    }

    private func hasMagicPrefix() -> Bool {
        buffer.count >= 4 &&
            byte(at: 0) == magic[0] &&
            byte(at: 1) == magic[1] &&
            byte(at: 2) == magic[2] &&
            byte(at: 3) == magic[3]
    }

    private func findMagicOffset() -> Int? {
        guard buffer.count >= 4 else { return nil }

        for offset in 0...(buffer.count - 4) {
            if byte(at: offset) == magic[0] &&
                byte(at: offset + 1) == magic[1] &&
                byte(at: offset + 2) == magic[2] &&
                byte(at: offset + 3) == magic[3] {
                return offset
            }
        }

        return nil
    }

    private func byte(at offset: Int) -> UInt8 {
        buffer[buffer.index(buffer.startIndex, offsetBy: offset)]
    }

    private func readUInt16LE(at offset: Int) -> UInt16 {
        let b0 = UInt16(byte(at: offset))
        let b1 = UInt16(byte(at: offset + 1)) << 8
        return b0 | b1
    }

    private func readUInt32LE(at offset: Int) -> UInt32 {
        let b0 = UInt32(byte(at: offset))
        let b1 = UInt32(byte(at: offset + 1)) << 8
        let b2 = UInt32(byte(at: offset + 2)) << 16
        let b3 = UInt32(byte(at: offset + 3)) << 24
        return b0 | b1 | b2 | b3
    }

    private func readUInt64LE(at offset: Int) -> UInt64 {
        var value: UInt64 = 0
        for index in 0..<8 {
            value |= UInt64(byte(at: offset + index)) << (UInt64(index) * 8)
        }
        return value
    }
}
