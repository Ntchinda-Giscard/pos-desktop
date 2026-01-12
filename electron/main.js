// main.js - Electron Main Process
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn, exec } = require("child_process"); // ADD exec HERE
const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const isWindows = process.platform === "win32";
const backendDir = path.join(__dirname, "..", "backend");

let mainWindow;
let backendProcess = null;
let frontendProcess = null;
let isShuttingDown = false;
let cleanupInProgress = false;
const trackedProcesses = new Map();

// Enhanced logging system
const logFile = path.join(
  isDev ? __dirname : path.dirname(app.getPath("exe")),
  "debug.log"
);

const BACKEND_PORT = isDev ? 7626 : 7626;

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  console.log(logMessage);

  try {
    let fullMessage = logMessage;
    if (data) {
      fullMessage += `\nData: ${
        typeof data === "string" ? data : JSON.stringify(data, null, 2)
      }`;
    }
    fullMessage += "\n";

    fs.appendFileSync(logFile, fullMessage);
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, "..", relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
}

// Terminate process with timeout
function terminateProcess(proc, timeout = 5000) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (err) {
        log("warn", `Failed to force kill process: ${err.message}`);
      }
      resolve();
    }, timeout);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill("SIGTERM");
    } catch (err) {
      log("warn", `Failed to terminate process: ${err.message}`);
      clearTimeout(timer);
      resolve();
    }
  });
}

// Kill processes on specific ports
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    log("info", `Attempting to kill processes on port ${port}`);

    if (isWindows) {
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (error || !stdout) {
          log("debug", `No process found on port ${port}`);
          resolve();
          return;
        }

        const lines = stdout.split("\n");
        const pids = new Set();

        lines.forEach((line) => {
          const match = line.match(/\s+(\d+)\s*$/);
          if (match && match[1] !== "0") {
            pids.add(match[1]);
          }
        });

        if (pids.size === 0) {
          log("debug", `No valid PIDs found for port ${port}`);
          resolve();
          return;
        }

        log(
          "info",
          `Killing processes on port ${port}: ${Array.from(pids).join(", ")}`
        );

        const killPromises = Array.from(pids).map((pid) => {
          return new Promise((pidResolve) => {
            exec(`taskkill /PID ${pid} /T /F`, (killError) => {
              if (killError) {
                log(
                  "warn",
                  `Failed to kill process ${pid}: ${killError.message}`
                );
              } else {
                log("info", `Successfully killed process tree for PID ${pid}`);
              }
              pidResolve();
            });
          });
        });

        Promise.all(killPromises).then(() => {
          setTimeout(resolve, 2000);
        });
      });
    } else {
      exec(`lsof -ti:${port}`, (error, stdout) => {
        if (error || !stdout) {
          log("debug", `No process found on port ${port}`);
          resolve();
          return;
        }

        const pids = stdout
          .trim()
          .split("\n")
          .filter((pid) => pid && pid !== "0");

        if (pids.length === 0) {
          resolve();
          return;
        }

        log("info", `Killing processes on port ${port}: ${pids.join(", ")}`);

        exec(`kill -TERM ${pids.join(" ")}`, (termError) => {
          if (termError) {
            log("warn", `SIGTERM failed, trying SIGKILL: ${termError.message}`);
          }

          setTimeout(() => {
            exec(`kill -9 ${pids.join(" ")} 2>/dev/null`, (killError) => {
              if (killError) {
                log("debug", `SIGKILL completed`);
              } else {
                log("info", `Force killed remaining processes on port ${port}`);
              }
              setTimeout(resolve, 2000);
            });
          }, 3000);
        });
      });
    }
  });
}

// Enhanced process cleanup
async function cleanupProcesses() {
  if (cleanupInProgress) {
    log("debug", "Cleanup already in progress, skipping");
    return;
  }

  cleanupInProgress = true;
  isShuttingDown = true;

  log("info", "Starting enhanced process cleanup");

  try {
    const cleanupPromises = [];

    if (backendProcess && !backendProcess.killed) {
      log("info", "Terminating backend process gracefully");
      cleanupPromises.push(terminateProcess(backendProcess, 5000));
    }

    if (frontendProcess && !frontendProcess.killed) {
      log("info", "Terminating frontend process gracefully");
      cleanupPromises.push(terminateProcess(frontendProcess, 5000));
    }

    await Promise.all(cleanupPromises);

    log("info", "Cleaning up processes on ports");
    await killProcessOnPort(BACKEND_PORT);

    if (trackedProcesses.size > 0) {
      log("info", `Cleaning up ${trackedProcesses.size} tracked processes`);
      const trackedCleanup = Array.from(trackedProcesses.entries()).map(
        ([pid, data]) => {
          return new Promise((resolve) => {
            try {
              if (data.cleanup) {
                data.cleanup();
              }

              if (data.process && !data.process.killed) {
                terminateProcess(data.process, 5000).then(resolve);
              } else {
                resolve();
              }
            } catch (error) {
              log(
                "warn",
                `Error cleaning up tracked process ${pid}: ${error.message}`
              );
              resolve();
            }
          });
        }
      );

      await Promise.all(trackedCleanup);
      trackedProcesses.clear();
    }

    log("info", "Final port cleanup verification");
    await killProcessOnPort(BACKEND_PORT);

    log("info", "Enhanced process cleanup completed successfully");
  } catch (error) {
    log("error", "Error during process cleanup", error);
  } finally {
    cleanupInProgress = false;
  }
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000").catch((err) => {
      log("error", "Failed to load dev URL", err);
      console.error(
        "❌ Failed to load dev URL. Is your Next.js dev server running?"
      );
      console.error("Run: npm run dev:next");
    });
    mainWindow.webContents.openDevTools();
  } else {
    const possiblePaths = [
      path.join(__dirname, "frontend", "out", "index.html"),
      path.join(__dirname, "..", "frontend", "out", "index.html"),
      path.join(process.resourcesPath, "frontend", "out", "index.html"),
      path.join(process.resourcesPath, "app", "frontend", "out", "index.html"),
    ];

    let indexPath = null;
    for (const p of possiblePaths) {
      log("info", "Checking path: " + p);
      if (fs.existsSync(p)) {
        indexPath = p;
        log("info", "Found index.html at: " + indexPath);
        break;
      }
    }

    if (indexPath) {
      mainWindow.loadFile(indexPath).catch((err) => {
        log("error", "Failed to load file", err);
      });
    } else {
      log("error", "index.html not found in any expected location");
      mainWindow.loadURL(`data:text/html,
        <html>
          <body style="font-family: Arial; padding: 40px; background: #1a1a1a; color: #fff;">
            <h1>❌ Error: Frontend not found</h1>
            <p>index.html not found in expected locations</p>
            <p>Make sure you built the Next.js app with: <code>npm run build:next</code></p>
            <h3>Checked paths:</h3>
            <ul>${possiblePaths
              .map((p) => `<li><code>${p}</code></li>`)
              .join("")}</ul>
          </body>
        </html>
      `);
    }
  }

  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      log("error", `Page failed to load: ${errorCode} - ${errorDescription}`);
    }
  );
}

function startBackend() {
  return new Promise((resolve, reject) => {
    log("info", "Starting backend server");

    if (isDev) {
      log(
        "info",
        "Development mode: start backend manually with 'cd backend && venv\\Scripts\\activate && python api.py'"
      );
      resolve();
      return;
    }

    const exePath = getResourcePath(path.join("backend", "api.exe"));
    log("info", `Backend executable path: ${exePath}`);

    if (!fs.existsSync(exePath)) {
      const error = `Backend executable not found at: ${exePath}`;
      log("error", error);
      reject(new Error(error));
      return;
    }

    log("info", "Starting backend process");

    backendProcess = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: BACKEND_PORT.toString(),
        HOST: "127.0.0.1",
      },
    });

    trackedProcesses.set(backendProcess.pid, {
      process: backendProcess,
      cleanup: () => {
        log("info", "Cleaning up backend process");
      },
    });

    backendProcess.stdout.on("data", (data) => {
      log("backend", data.toString().trim());
    });

    backendProcess.stderr.on("data", (data) => {
      log("backend-err", data.toString().trim());
    });

    backendProcess.on("error", (err) => {
      log("error", "Backend process error", err);
      trackedProcesses.delete(backendProcess.pid);
      reject(err);
    });

    backendProcess.on("exit", (code, signal) => {
      log(
        "warn",
        `Backend process exited with code ${code}, signal: ${signal}`
      );
      trackedProcesses.delete(backendProcess.pid);
    });

    setTimeout(() => {
      log("info", "Backend startup timeout reached, assuming ready");
      resolve();
    }, 5000);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  log("info", "Electron app ready");

  try {
    await killProcessOnPort(BACKEND_PORT);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (!isDev) {
      await startBackend();
    }
  } catch (error) {
    log("error", "Application startup failed", error);
    dialog.showErrorBox(
      "Startup Failed",
      `Application failed to start:\n\n${error.message}\n\nPlease check ${logFile} for detailed logs.`
    );
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  log("info", "All windows closed, cleaning up");
  await cleanupProcesses();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!isShuttingDown && !cleanupInProgress) {
    log("info", "Application shutting down");
    event.preventDefault();

    try {
      await cleanupProcesses();
      app.exit(0);
    } catch (error) {
      log("error", "Error during shutdown cleanup", error);
      app.exit(1);
    }
  }
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("open-folder-picker", async () => {
  try {
    // showOpenDialog opens the native file/folder picker
    // Think of this as calling the operating system's built-in folder selector
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"], // Only allow folder selection, not files
      title: "Sélectionnez un dossier",
      buttonLabel: "Choisir ce dossier",
    });

    // The dialog returns an object with information about what the user selected
    if (result.canceled) {
      // User clicked "Cancel" or pressed Escape
      return {
        success: false,
        path: null,
        message: "User canceled folder selection",
      };
    }

    // User selected a folder - filePaths[0] contains the absolute path
    const selectedPath = result.filePaths[0];
    console.log("Main process: User selected folder:", selectedPath);
    log("info", `User selected folder: ${selectedPath}`);

    return {
      success: true,
      path: selectedPath,
      message: "Folder selected successfully",
    };
  } catch (error) {
    // Handle any errors that might occur
    console.error("Main process: Error opening folder picker:", error);
    log("error", "Error opening folder picker", error);
    return {
      success: false,
      path: null,
      error: error.message,
    };
  }
});

// Add this to your electron/main.js file
// This function returns a simple array of folder names like ["base1", "base2"]
// Your subfolder scanning function (now with proper fs module access)
ipcMain.handle("scan-subfolders", async (event, rootPath) => {
  try {
    console.log("Main process: Scanning subfolders in:", rootPath);

    // First, do a quick synchronous check to see if the path even exists
    // This prevents unnecessary async operations on non-existent paths
    if (!fs.existsSync(rootPath)) {
      throw new Error(`Path does not exist: ${rootPath}`);
    }

    // Now verify it's actually a directory using the async version
    const pathStats = await fsPromises.stat(rootPath);
    if (!pathStats.isDirectory()) {
      throw new Error("The provided path is not a directory");
    }

    // Read all items in the directory
    const allItems = await fsPromises.readdir(rootPath);
    const folderNames = [];

    // Check each item to see if it's a folder
    for (const item of allItems) {
      const fullPath = path.join(rootPath, item);

      try {
        const itemStats = await fsPromises.stat(fullPath);
        if (itemStats.isDirectory()) {
          folderNames.push(item);
        }
      } catch (error) {
        // Log warnings for items we can't access (permissions, broken symlinks, etc.)
        console.warn(`Could not access item: ${fullPath}`, error.message);
      }
    }

    // Sort alphabetically for better user experience
    folderNames.sort();

    console.log(
      `Main process: Found ${folderNames.length} subfolders:`,
      folderNames
    );
    return folderNames;
  } catch (error) {
    console.error("Main process: Error scanning subfolders:", error);
    return []; // Return empty array on error
  }
});

// IPC handler to open a folder with custom path
ipcMain.handle("open-folder", async (event, folderPath) => {
  try {
    // Validate that folderPath is provided
    if (!folderPath) {
      throw new Error("Folder path is required");
    }

    // Resolve the path (can be relative or absolute)
    const resolvedPath = path.resolve(folderPath);

    // Check if directory exists
    if (!fs.existsSync(resolvedPath)) {
      // Create the directory if it doesn't exist
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    // Open the folder in the system's default file manager
    await shell.openPath(resolvedPath);

    return { success: true, path: resolvedPath };
  } catch (error) {
    console.error("Error opening folder:", error);
    return { success: false, error: error.message };
  }
});

process.on("SIGINT", async () => {
  log("info", "Received SIGINT, cleaning up...");
  await cleanupProcesses();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("info", "Received SIGTERM, cleaning up...");
  await cleanupProcesses();
  process.exit(0);
});

process.on("uncaughtException", async (error) => {
  log("error", "Uncaught exception", error);
  await cleanupProcesses();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  log("error", "Unhandled promise rejection", { reason, promise });
  await cleanupProcesses();
  process.exit(1);
});
