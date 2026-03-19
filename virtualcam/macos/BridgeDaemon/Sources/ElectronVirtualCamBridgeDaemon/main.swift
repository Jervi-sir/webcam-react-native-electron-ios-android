import Foundation
import Network
import Darwin

private let packetMagic: [UInt8] = [0x45, 0x56, 0x43, 0x4D] // EVCM
private let packetHeaderSize = 20
private let maxPayloadSize = 20 * 1024 * 1024

private struct FramePacket {
    let width: Int
    let height: Int
    let timestampNs: UInt64
    let jpegData: Data
}

private struct DaemonOptions {
    let port: UInt16
    let outputDirectory: URL

    static func parse(from args: [String]) throws -> DaemonOptions {
        var port: UInt16 = 19777
        var outputDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("electron-virtualcam", isDirectory: true)

        var index = 0
        while index < args.count {
            let arg = args[index]
            if arg == "--help" || arg == "-h" {
                printUsageAndExit()
            }

            if arg == "--port" {
                guard index + 1 < args.count else {
                    throw NSError(domain: "BridgeDaemon", code: 1, userInfo: [
                        NSLocalizedDescriptionKey: "Missing value for --port"
                    ])
                }
                port = try parsePort(args[index + 1])
                index += 2
                continue
            }

            if arg.hasPrefix("--port=") {
                let value = String(arg.dropFirst("--port=".count))
                port = try parsePort(value)
                index += 1
                continue
            }

            if arg == "--output" {
                guard index + 1 < args.count else {
                    throw NSError(domain: "BridgeDaemon", code: 2, userInfo: [
                        NSLocalizedDescriptionKey: "Missing value for --output"
                    ])
                }
                outputDirectory = URL(fileURLWithPath: args[index + 1], isDirectory: true)
                index += 2
                continue
            }

            if arg.hasPrefix("--output=") {
                let value = String(arg.dropFirst("--output=".count))
                outputDirectory = URL(fileURLWithPath: value, isDirectory: true)
                index += 1
                continue
            }

            throw NSError(domain: "BridgeDaemon", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Unknown argument: \(arg)"
            ])
        }

        return DaemonOptions(port: port, outputDirectory: outputDirectory)
    }

    private static func parsePort(_ raw: String) throws -> UInt16 {
        guard let value = UInt16(raw), value > 0 else {
            throw NSError(domain: "BridgeDaemon", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "Invalid port: \(raw)"
            ])
        }
        return value
    }

    private static func printUsageAndExit() -> Never {
        print("""
        ElectronVirtualCamBridgeDaemon
          --port <1-65535>    TCP listen port (default: 19777)
          --output <path>     Output directory for latest_frame.jpg/json

        Example:
          ElectronVirtualCamBridgeDaemon --port 19777 --output /tmp/electron-virtualcam
        """)
        exit(EXIT_SUCCESS)
    }
}

private final class FrameDecoder {
    private var buffer = Data()

    func push(_ chunk: Data) -> [FramePacket] {
        buffer.append(chunk)
        var packets: [FramePacket] = []

        while true {
            if buffer.count < packetHeaderSize {
                break
            }

            if !hasMagicPrefix(buffer) {
                guard let nextMagic = findMagicOffset(in: buffer) else {
                    buffer.removeAll(keepingCapacity: true)
                    break
                }

                if nextMagic > 0 {
                    buffer.removeFirst(nextMagic)
                }

                if buffer.count < packetHeaderSize {
                    break
                }
            }

            let width = Int(readUInt16LE(buffer, at: 4))
            let height = Int(readUInt16LE(buffer, at: 6))
            let timestampNs = readUInt64LE(buffer, at: 8)
            let payloadLength = Int(readUInt32LE(buffer, at: 16))

            if payloadLength < 1 || payloadLength > maxPayloadSize {
                buffer.removeFirst(4)
                continue
            }

            let packetSize = packetHeaderSize + payloadLength
            if buffer.count < packetSize {
                break
            }

            let payloadRange = packetHeaderSize..<packetSize
            let jpegData = buffer.subdata(in: payloadRange)
            buffer.removeFirst(packetSize)

            packets.append(
                FramePacket(
                    width: width,
                    height: height,
                    timestampNs: timestampNs,
                    jpegData: jpegData
                )
            )
        }

        return packets
    }

    private func hasMagicPrefix(_ data: Data) -> Bool {
        data.count >= 4 &&
            byte(data, at: 0) == packetMagic[0] &&
            byte(data, at: 1) == packetMagic[1] &&
            byte(data, at: 2) == packetMagic[2] &&
            byte(data, at: 3) == packetMagic[3]
    }

    private func findMagicOffset(in data: Data) -> Int? {
        if data.count < 4 {
            return nil
        }

        for offset in 0...(data.count - 4) {
            if byte(data, at: offset) == packetMagic[0] &&
                byte(data, at: offset + 1) == packetMagic[1] &&
                byte(data, at: offset + 2) == packetMagic[2] &&
                byte(data, at: offset + 3) == packetMagic[3] {
                return offset
            }
        }

        return nil
    }

    private func byte(_ data: Data, at offset: Int) -> UInt8 {
        data[data.index(data.startIndex, offsetBy: offset)]
    }

    private func readUInt16LE(_ data: Data, at offset: Int) -> UInt16 {
        let b0 = UInt16(byte(data, at: offset))
        let b1 = UInt16(byte(data, at: offset + 1)) << 8
        return b0 | b1
    }

    private func readUInt32LE(_ data: Data, at offset: Int) -> UInt32 {
        let b0 = UInt32(byte(data, at: offset))
        let b1 = UInt32(byte(data, at: offset + 1)) << 8
        let b2 = UInt32(byte(data, at: offset + 2)) << 16
        let b3 = UInt32(byte(data, at: offset + 3)) << 24
        return b0 | b1 | b2 | b3
    }

    private func readUInt64LE(_ data: Data, at offset: Int) -> UInt64 {
        var value: UInt64 = 0
        for i in 0..<8 {
            value |= UInt64(byte(data, at: offset + i)) << (UInt64(i) * 8)
        }
        return value
    }
}

private final class LatestFrameStore {
    private let directory: URL
    private let imageURL: URL
    private let metadataURL: URL
    private let queue = DispatchQueue(label: "evcm.store")
    private var frameCounter: UInt64 = 0
    private let dateFormatter = ISO8601DateFormatter()

    init(directory: URL) throws {
        self.directory = directory
        self.imageURL = directory.appendingPathComponent("latest_frame.jpg")
        self.metadataURL = directory.appendingPathComponent("latest_frame.json")

        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
    }

    func write(frame: FramePacket) {
        queue.async {
            do {
                try frame.jpegData.write(to: self.imageURL, options: .atomic)
                self.frameCounter += 1

                let metadata: [String: Any] = [
                    "width": frame.width,
                    "height": frame.height,
                    "timestampNs": frame.timestampNs,
                    "jpegBytes": frame.jpegData.count,
                    "frameCounter": self.frameCounter,
                    "updatedAt": self.dateFormatter.string(from: Date())
                ]

                let json = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted])
                try json.write(to: self.metadataURL, options: .atomic)
            } catch {
                fputs("[bridge] frame write failed: \(error.localizedDescription)\n", stderr)
            }
        }
    }

    var outputPath: String {
        directory.path
    }
}

private final class ClientSession {
    let id = UUID()
    private let connection: NWConnection
    private let decoder = FrameDecoder()
    private let frameStore: LatestFrameStore
    private let queue: DispatchQueue
    private let onStop: (UUID) -> Void

    init(
        connection: NWConnection,
        frameStore: LatestFrameStore,
        queue: DispatchQueue,
        onStop: @escaping (UUID) -> Void
    ) {
        self.connection = connection
        self.frameStore = frameStore
        self.queue = queue
        self.onStop = onStop
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }

            switch state {
            case .ready:
                print("[bridge] client connected")
            case .failed(let error):
                fputs("[bridge] client failed: \(error.localizedDescription)\n", stderr)
                self.stop()
            case .cancelled:
                self.onStop(self.id)
            default:
                break
            }
        }

        connection.start(queue: queue)
        receiveLoop()
    }

    private func receiveLoop() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 128 * 1024) {
            [weak self] data, _, isComplete, error in
            guard let self else {
                return
            }

            if let data, !data.isEmpty {
                let packets = self.decoder.push(data)
                for packet in packets {
                    self.frameStore.write(frame: packet)
                }
            }

            if isComplete || error != nil {
                self.stop()
                return
            }

            self.receiveLoop()
        }
    }

    private func stop() {
        connection.cancel()
    }
}

private final class BridgeDaemon {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "evcm.listener")
    private let frameStore: LatestFrameStore
    private var sessions: [UUID: ClientSession] = [:]

    init(port: UInt16, frameStore: LatestFrameStore) throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "BridgeDaemon", code: 5, userInfo: [
                NSLocalizedDescriptionKey: "Invalid listen port"
            ])
        }

        self.listener = try NWListener(using: .tcp, on: nwPort)
        self.frameStore = frameStore
    }

    func start() {
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("[bridge] listening on 127.0.0.1:\(self.listener.port?.rawValue ?? 0)")
                print("[bridge] output directory: \(self.frameStore.outputPath)")
            case .failed(let error):
                fputs("[bridge] listener failed: \(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            default:
                break
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            guard let self else {
                connection.cancel()
                return
            }

            let session = ClientSession(
                connection: connection,
                frameStore: self.frameStore,
                queue: self.queue,
                onStop: { [weak self] id in
                    self?.sessions.removeValue(forKey: id)
                }
            )
            self.sessions[session.id] = session
            session.start()
        }

        listener.start(queue: queue)
    }
}

private func main() {
    do {
        let options = try DaemonOptions.parse(from: Array(CommandLine.arguments.dropFirst()))
        let store = try LatestFrameStore(directory: options.outputDirectory)
        let daemon = try BridgeDaemon(port: options.port, frameStore: store)
        daemon.start()
        dispatchMain()
    } catch {
        fputs("[bridge] startup failed: \(error.localizedDescription)\n", stderr)
        exit(EXIT_FAILURE)
    }
}

main()
