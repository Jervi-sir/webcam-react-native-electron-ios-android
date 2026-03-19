// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ElectronVirtualCamBridgeDaemon",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "ElectronVirtualCamBridgeDaemon",
            targets: ["ElectronVirtualCamBridgeDaemon"]
        )
    ],
    targets: [
        .executableTarget(
            name: "ElectronVirtualCamBridgeDaemon",
            path: "Sources/ElectronVirtualCamBridgeDaemon"
        )
    ]
)
