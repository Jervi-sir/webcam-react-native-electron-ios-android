import Foundation
import CoreMedia
import CoreImage
import CoreMediaIO
import CoreVideo
import ImageIO

enum VirtualCameraConfiguration {
    static let providerName = "Electron Virtual Camera"
    static let manufacturer = "Jervi"
    static let deviceName = "Electron Virtual Camera"
    static let streamName = "Electron Virtual Camera Stream"
    static let deviceID = UUID(uuidString: "7626645E-4425-469E-9D8B-97E0FA59AC75")!
    static let streamID = UUID(uuidString: "A8D7B8AA-65AD-4D21-9C42-66480DBFA8E1")!
    static let fileBridgeDirectory = URL(fileURLWithPath: "/tmp/electron-virtualcam", isDirectory: true)
    static let latestFrameName = "latest_frame.jpg"
    static let latestMetadataName = "latest_frame.json"
    static let defaultWidth = 1280
    static let defaultHeight = 720
    static let defaultFPS: Int32 = 30
    static let deviceModel = "Electron WebRTC Receiver"
    static let supportedFormats: [(width: Int32, height: Int32)] = [
        (1280, 720),
        (1920, 1080)
    ]

    static var defaultFrameDuration: CMTime {
        CMTime(value: 1, timescale: defaultFPS)
    }
}

struct FileBridgeFrame {
    let jpegData: Data
    let width: Int
    let height: Int
    let timestampNs: UInt64
}

final class LatestFrameFileBridge {
    private let imageURL = VirtualCameraConfiguration.fileBridgeDirectory
        .appendingPathComponent(VirtualCameraConfiguration.latestFrameName)
    private let metadataURL = VirtualCameraConfiguration.fileBridgeDirectory
        .appendingPathComponent(VirtualCameraConfiguration.latestMetadataName)
    private let lock = NSLock()
    private var cachedFrame: FileBridgeFrame?
    private var lastImageModificationDate: Date?

    func readLatestFrame() -> FileBridgeFrame? {
        lock.lock()
        defer { lock.unlock() }

        guard let attributes = try? FileManager.default.attributesOfItem(atPath: imageURL.path),
              let modified = attributes[.modificationDate] as? Date else {
            return cachedFrame
        }

        if let lastImageModificationDate, lastImageModificationDate == modified {
            return cachedFrame
        }

        guard let jpegData = try? Data(contentsOf: imageURL), !jpegData.isEmpty else {
            return cachedFrame
        }

        let metadata = readMetadata()
        let frame = FileBridgeFrame(
            jpegData: jpegData,
            width: metadata.width ?? VirtualCameraConfiguration.defaultWidth,
            height: metadata.height ?? VirtualCameraConfiguration.defaultHeight,
            timestampNs: metadata.timestampNs ?? DispatchTime.now().uptimeNanoseconds
        )

        cachedFrame = frame
        lastImageModificationDate = modified
        return frame
    }

    private func readMetadata() -> (width: Int?, height: Int?, timestampNs: UInt64?) {
        guard let data = try? Data(contentsOf: metadataURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return (nil, nil, nil)
        }

        let width = object["width"] as? Int
        let height = object["height"] as? Int

        let timestampNs: UInt64?
        if let value = object["timestampNs"] as? UInt64 {
            timestampNs = value
        } else if let value = object["timestampNs"] as? Int {
            timestampNs = UInt64(value)
        } else if let value = object["timestampNs"] as? String {
            timestampNs = UInt64(value)
        } else {
            timestampNs = nil
        }

        return (width, height, timestampNs)
    }
}

final class SampleBufferFactory {
    private let ciContext = CIContext(options: nil)
    private let width: Int
    private let height: Int
    private let fps: Int32

    init(width: Int, height: Int, fps: Int32) {
        self.width = width
        self.height = height
        self.fps = fps
    }

    func makeSampleBuffer(from frame: FileBridgeFrame, sequenceNumber: UInt64) -> CMSampleBuffer? {
        guard let source = CGImageSourceCreateWithData(frame.jpegData as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let pixelBuffer = makePixelBuffer() else {
            return nil
        }

        let image = makeAspectFillImage(from: cgImage)
        ciContext.render(image, to: pixelBuffer)

        var formatDescription: CMFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescriptionOut: &formatDescription
        ) == noErr,
        let formatDescription else {
            return nil
        }

        let duration = CMTime(value: 1, timescale: fps)
        let presentationTimeStamp = CMTime(value: CMTimeValue(sequenceNumber), timescale: fps)
        var timing = CMSampleTimingInfo(
            duration: duration,
            presentationTimeStamp: presentationTimeStamp,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: formatDescription,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        ) == noErr else {
            return nil
        }

        return sampleBuffer
    }

    private func makePixelBuffer() -> CVPixelBuffer? {
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:],
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true
        ]

        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        ) == kCVReturnSuccess else {
            return nil
        }

        return pixelBuffer
    }

    private func makeAspectFillImage(from cgImage: CGImage) -> CIImage {
        let source = CIImage(cgImage: cgImage)
        let sourceExtent = source.extent
        let targetRect = CGRect(x: 0, y: 0, width: width, height: height)
        let scale = max(targetRect.width / sourceExtent.width, targetRect.height / sourceExtent.height)
        let scaledWidth = sourceExtent.width * scale
        let scaledHeight = sourceExtent.height * scale
        let translateX = (targetRect.width - scaledWidth) / 2.0
        let translateY = (targetRect.height - scaledHeight) / 2.0

        return source
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: translateX, y: translateY))
            .cropped(to: targetRect)
    }
}

enum CameraExtensionService {
    static func start() throws {
        let source = ElectronVirtualCameraProviderSource()
        let provider = try source.makeProvider()
        CMIOExtensionProvider.startService(provider: provider)
    }
}

final class ElectronVirtualCameraProviderSource: NSObject, CMIOExtensionProviderSource {
    private let clientQueue = DispatchQueue(label: "evcm.cmio.provider")
    private lazy var deviceSource = ElectronVirtualCameraDeviceSource(clientQueue: clientQueue)
    private(set) var provider: CMIOExtensionProvider?

    var availableProperties: Set<CMIOExtensionProperty> {
        [
            .providerName,
            .providerManufacturer
        ]
    }

    func makeProvider() throws -> CMIOExtensionProvider {
        let provider = CMIOExtensionProvider(source: self, clientQueue: clientQueue)
        self.provider = provider
        try deviceSource.attach(to: provider)
        return provider
    }

    func connect(to client: CMIOExtensionClient) throws {
    }

    func disconnect(from client: CMIOExtensionClient) {
    }

    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let states: [CMIOExtensionProperty: CMIOExtensionPropertyState] = [
            .providerName: CMIOExtensionPropertyState(
                value: VirtualCameraConfiguration.providerName as NSString,
                attributes: .readOnlyPropertyAttribute
            ),
            .providerManufacturer: CMIOExtensionPropertyState(
                value: VirtualCameraConfiguration.manufacturer as NSString,
                attributes: .readOnlyPropertyAttribute
            )
        ]

        return CMIOExtensionProviderProperties(dictionary: states)
    }

    func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {
    }
}

final class ElectronVirtualCameraDeviceSource: NSObject, CMIOExtensionDeviceSource {
    private let clientQueue: DispatchQueue
    private let streamSource = ElectronVirtualCameraStreamSource()
    private(set) var device: CMIOExtensionDevice?

    init(clientQueue: DispatchQueue) {
        self.clientQueue = clientQueue
        super.init()
    }

    func attach(to provider: CMIOExtensionProvider) throws {
        let device = CMIOExtensionDevice(
            localizedName: VirtualCameraConfiguration.deviceName,
            deviceID: VirtualCameraConfiguration.deviceID,
            legacyDeviceID: VirtualCameraConfiguration.deviceID.uuidString,
            source: self
        )

        let stream = CMIOExtensionStream(
            localizedName: VirtualCameraConfiguration.streamName,
            streamID: VirtualCameraConfiguration.streamID,
            direction: .source,
            clockType: .hostTime,
            source: streamSource
        )

        try device.addStream(stream)
        try provider.addDevice(device)

        streamSource.attach(stream: stream)
        self.device = device
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        [
            .deviceModel,
            .deviceCanBeDefaultInputDevice,
            .deviceCanBeDefaultOutputDevice
        ]
    }

    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let properties = CMIOExtensionDeviceProperties(dictionary: [:])
        properties.model = VirtualCameraConfiguration.deviceModel
        properties.setPropertyState(
            CMIOExtensionPropertyState(value: NSNumber(value: 1), attributes: .readOnlyPropertyAttribute),
            forProperty: .deviceCanBeDefaultInputDevice
        )
        properties.setPropertyState(
            CMIOExtensionPropertyState(value: NSNumber(value: 0), attributes: .readOnlyPropertyAttribute),
            forProperty: .deviceCanBeDefaultOutputDevice
        )
        return properties
    }

    func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {
    }
}

final class ElectronVirtualCameraStreamSource: NSObject, CMIOExtensionStreamSource {
    private let queue = DispatchQueue(label: "evcm.cmio.stream")
    private let frameBridge = LatestFrameFileBridge()
    private var timer: DispatchSourceTimer?
    private weak var stream: CMIOExtensionStream?
    private var sequenceNumber: UInt64 = 0
    private var activeFormatIndex = 0
    private var frameDuration = VirtualCameraConfiguration.defaultFrameDuration

    private lazy var supportedFormats: [CMIOExtensionStreamFormat] = {
        VirtualCameraConfiguration.supportedFormats.compactMap { format -> CMIOExtensionStreamFormat? in
            var formatDescription: CMFormatDescription?
            let status = CMVideoFormatDescriptionCreate(
                allocator: kCFAllocatorDefault,
                codecType: kCVPixelFormatType_32BGRA,
                width: format.width,
                height: format.height,
                extensions: [:] as CFDictionary,
                formatDescriptionOut: &formatDescription
            )

            guard status == noErr, let formatDescription else {
                return nil
            }

            return CMIOExtensionStreamFormat(
                formatDescription: formatDescription,
                maxFrameDuration: CMTime(value: 1, timescale: 15),
                minFrameDuration: CMTime(value: 1, timescale: 60),
                validFrameDurations: [
                    CMTime(value: 1, timescale: 15),
                    CMTime(value: 1, timescale: 24),
                    CMTime(value: 1, timescale: 30),
                    CMTime(value: 1, timescale: 60)
                ]
            )
        }
    }()

    func attach(stream: CMIOExtensionStream) {
        self.stream = stream
    }

    var formats: [CMIOExtensionStreamFormat] {
        supportedFormats
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        [
            .streamActiveFormatIndex,
            .streamFrameDuration,
            .streamMaxFrameDuration
        ]
    }

    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let states: [CMIOExtensionProperty: CMIOExtensionPropertyState<AnyObject>] = [
            .streamActiveFormatIndex: CMIOExtensionPropertyState(
                value: NSNumber(value: activeFormatIndex),
                attributes: CMIOExtensionPropertyAttributes(
                    minValue: NSNumber(value: 0),
                    maxValue: NSNumber(value: max(0, supportedFormats.count - 1)),
                    validValues: Array(0..<supportedFormats.count).map { NSNumber(value: $0) },
                    readOnly: false
                )
            ),
            .streamFrameDuration: CMIOExtensionPropertyState(value: CMTimeCopyAsDictionary(frameDuration, allocator: kCFAllocatorDefault)! as NSDictionary),
            .streamMaxFrameDuration: CMIOExtensionPropertyState(value: CMTimeCopyAsDictionary(CMTime(value: 1, timescale: 15), allocator: kCFAllocatorDefault)! as NSDictionary)
        ]

        return CMIOExtensionStreamProperties(dictionary: states)
    }

    func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        if let value = streamProperties.activeFormatIndex {
            activeFormatIndex = max(0, min(value, supportedFormats.count - 1))
        }

        if let duration = streamProperties.frameDuration {
            frameDuration = duration
        }

        restartTimerIfNeeded()
    }

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        true
    }

    func startStream() throws {
        guard timer == nil else { return }
        sequenceNumber = 0

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: frameDuration.seconds > 0 ? frameDuration.seconds : (1.0 / 30.0))
        timer.setEventHandler { [weak self] in
            self?.emitFrame()
        }
        self.timer = timer
        timer.resume()
    }

    func stopStream() throws {
        timer?.cancel()
        timer = nil
    }

    private func restartTimerIfNeeded() {
        guard timer != nil else { return }
        try? stopStream()
        try? startStream()
    }

    private func emitFrame() {
        guard let stream,
              let frame = frameBridge.readLatestFrame() else {
            return
        }

        let selected = VirtualCameraConfiguration.supportedFormats[min(activeFormatIndex, VirtualCameraConfiguration.supportedFormats.count - 1)]
        let fps = max(Int32(1), Int32(round(1.0 / max(frameDuration.seconds, 0.001))))
        let factory = SampleBufferFactory(width: Int(selected.width), height: Int(selected.height), fps: fps)

        guard let sampleBuffer = factory.makeSampleBuffer(from: frame, sequenceNumber: sequenceNumber) else {
            return
        }

        let hostTimeNs = DispatchTime.now().uptimeNanoseconds
        stream.send(sampleBuffer, discontinuity: [], hostTimeInNanoseconds: hostTimeNs)
        sequenceNumber += 1
    }
}
