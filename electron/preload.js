// electron/preload.js - This is the "security guard" between your web app and desktop
const { contextBridge, ipcRenderer } = require("electron");
// electron/preload.js

// Required for Electron to work properly even if nothing is exposed yet
window.addEventListener("DOMContentLoaded", () => {
  // Safe to leave empty
});

// "!**/node_modules/**/*";

// contextBridge is Electron's secure way to expose functions to your web content
// Think of it as creating a safe API that your Next.js app can use
contextBridge.exposeInMainWorld("electronAPI", {
  // This function will be available in your frontend as window.electronAPI.openFolderPicker()
  openFolderPicker: () => {
    console.log("Preload: Frontend requested folder picker");
    // ipcRenderer.invoke sends a message to the main process and waits for a response
    // It's like making a phone call - you dial (invoke) and wait for an answer
    return ipcRenderer.invoke("open-folder-picker");
  },
  scanSubFolders: (path) => {
    console.log("Preload: Frontend requested folder scan for:", path);
    return ipcRenderer.invoke("scan-subfolders", path);
  },
  openFolder: (path) => {
    console.log("Preload: Frontend requested folder open for:", path);
    return ipcRenderer.invoke("open-folder", path);
  },
});

// Optional: Add a way to check if we're running in Electron
contextBridge.exposeInMainWorld("electronInfo", {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,
});

console.log(
  "Preload: Bridge established - frontend can now access desktop features"
);
