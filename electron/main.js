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
