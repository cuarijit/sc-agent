// Type declarations for the Electron preload API exposed via contextBridge.
// Only present when running inside the Electron shell; undefined in a browser.

interface ElectronAPI {
  onNavigate(callback: (path: string) => void): void;
  onOpenCommandPalette(callback: () => void): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
