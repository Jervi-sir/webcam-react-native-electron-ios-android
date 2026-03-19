import { app, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const INSTALLER_OPENED_MARKER = 'virtualcam-installer-opened';
const DEFAULT_PORT = 19777;

export class MacOSVirtualCamRuntime {
  private daemonProcess: ChildProcess | null = null;

  start = () => {
    if (process.platform !== 'darwin') {
      return;
    }

    this.startBridgeDaemon();
    void this.openInstallerAppOnce();
  };

  stop = () => {
    if (!this.daemonProcess || this.daemonProcess.killed) {
      this.daemonProcess = null;
      return;
    }

    this.daemonProcess.kill('SIGTERM');
    this.daemonProcess = null;
  };

  private startBridgeDaemon = () => {
    if (this.daemonProcess && !this.daemonProcess.killed) {
      return;
    }

    const daemonPath = this.resolveBridgeDaemonPath();
    if (!daemonPath) {
      return;
    }

    const daemon = spawn(daemonPath, ['--port', String(DEFAULT_PORT)], {
      stdio: 'pipe',
    });

    daemon.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[virtualcam-daemon] ${chunk.toString()}`);
    });

    daemon.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[virtualcam-daemon] ${chunk.toString()}`);
    });

    daemon.on('exit', (code, signal) => {
      process.stdout.write(
        `[virtualcam-daemon] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`,
      );
      if (this.daemonProcess === daemon) {
        this.daemonProcess = null;
      }
    });

    daemon.on('error', (error) => {
      process.stderr.write(`[virtualcam-daemon] failed to start: ${error.message}\n`);
      if (this.daemonProcess === daemon) {
        this.daemonProcess = null;
      }
    });

    this.daemonProcess = daemon;
  };

  private openInstallerAppOnce = async () => {
    const installerPath = this.resolveInstallerAppPath();
    if (!installerPath || !app.isPackaged) {
      return;
    }

    const markerPath = path.join(app.getPath('userData'), INSTALLER_OPENED_MARKER);
    if (existsSync(markerPath)) {
      return;
    }

    const result = await shell.openPath(installerPath);
    if (result) {
      process.stderr.write(`[virtualcam-installer] failed to open: ${result}\n`);
      return;
    }

    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
  };

  private resolveBridgeDaemonPath = (): string | null => {
    const candidates = [
      this.resolvePackagedNativePath('ElectronVirtualCamBridgeDaemon'),
      path.resolve(
        __dirname,
        '../../../desktop/native/macos/ElectronVirtualCamBridgeDaemon',
      ),
      path.resolve(
        __dirname,
        '../../../virtualcam/macos/BridgeDaemon/.build/release/ElectronVirtualCamBridgeDaemon',
      ),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  };

  private resolveInstallerAppPath = (): string | null => {
    const candidates = [
      this.resolvePackagedNativePath('ElectronVirtualCameraHost.app'),
      path.resolve(
        __dirname,
        '../../../desktop/native/macos/ElectronVirtualCameraHost.app',
      ),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  };

  private resolvePackagedNativePath = (...segments: string[]): string =>
    path.join(process.resourcesPath, 'native', 'macos', ...segments);
}
