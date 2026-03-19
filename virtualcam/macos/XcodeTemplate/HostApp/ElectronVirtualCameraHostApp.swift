import SwiftUI
import SystemExtensions

struct ElectronVirtualCameraHostApp: App {
    @StateObject private var installer = SystemExtensionInstaller()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(installer)
                .frame(minWidth: 560, minHeight: 320)
        }
    }
}

final class SystemExtensionInstaller: NSObject, ObservableObject {
    @Published var status = "Idle"
    @Published var details = "Set your Apple Team, build the app, then activate the extension."

    private let extensionIdentifier = "com.jervi.ElectronVirtualCameraHost.CameraExtension"

    func activate() {
        status = "Activating"
        details = "Submitting activation request for \(extensionIdentifier)"

        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: extensionIdentifier,
            queue: .main
        )
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func deactivate() {
        status = "Deactivating"
        details = "Submitting deactivation request for \(extensionIdentifier)"

        let request = OSSystemExtensionRequest.deactivationRequest(
            forExtensionWithIdentifier: extensionIdentifier,
            queue: .main
        )
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func refreshState() {
        status = "Check State"
        details = "Use 'systemextensionsctl list' to verify the extension is enabled and approved."
    }
}

extension SystemExtensionInstaller: OSSystemExtensionRequestDelegate {
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        status = "Approval Needed"
        details = "Open System Settings and approve the camera extension when prompted."
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        status = "Completed"

        switch result {
        case .completed:
            details = "Extension request completed. Open FaceTime or Zoom and look for Electron Virtual Camera."
        case .willCompleteAfterReboot:
            details = "Extension will complete after reboot. Restart macOS, then test the camera in FaceTime or Zoom."
        @unknown default:
            details = "Extension request completed with an unknown result."
        }
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        status = "Failed"
        details = error.localizedDescription
    }

    func request(
        _ request: OSSystemExtensionRequest,
        actionForReplacingExtension existing: OSSystemExtensionProperties,
        withExtension ext: OSSystemExtensionProperties
    ) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }
}

private struct ContentView: View {
    @EnvironmentObject private var installer: SystemExtensionInstaller

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Electron Virtual Camera")
                .font(.title)

            Text("Use this app to install and approve the CoreMediaIO Camera Extension. Keep the Electron desktop app and the bridge daemon running while testing.")
                .foregroundStyle(.secondary)

            GroupBox("Status") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(installer.status)
                    Text(installer.details)
                        .foregroundStyle(.secondary)
                        .font(.system(size: 12))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 12) {
                Button("Install / Activate") {
                    installer.activate()
                }

                Button("Deactivate") {
                    installer.deactivate()
                }

                Button("Refresh State") {
                    installer.refreshState()
                }
            }

            Text("Bridge directory: /tmp/electron-virtualcam")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding(20)
        .onAppear {
            installer.refreshState()
        }
    }
}
