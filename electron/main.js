// main.js - Electron Main Process
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const isDev = require("electron-is-dev");
const isWindows = process.platform === "win32";
const backendDir = path.join(__dirname, "..", "backend"); // Go up one level from electron folder

let mainWindow;

// Enhanced logging system
const logFile = path.join(
  isDev ? __dirname : path.dirname(app.getPath("exe")),
  "debug.log"
);

const BACKEND_PORT = isDev ? 8001 : 8001;

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

function buildBackend() {
  log("info", "Starting backend build process");
  log("info", "Backend directory: " + backendDir);
  log("info", "Directory exists: " + fs.existsSync(backendDir));

  // Check multiple possible Python paths
  const possiblePaths = isWindows
    ? [
        path.join(backendDir, "venv", "Scripts", "python.exe"),
        path.join(backendDir, ".venv", "Scripts", "python.exe"),
        "python", // Fallback to system Python
      ]
    : [
        path.join(backendDir, "venv", "bin", "python"),
        path.join(backendDir, ".venv", "bin", "python"),
        "python3",
      ];

  let pythonPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p) || p === "python" || p === "python3") {
      pythonPath = p;
      log("info", "Found Python at: " + pythonPath);
      break;
    }
  }

  if (!pythonPath) {
    log("error", "Virtual environment not found!");
    console.error("❌ Virtual environment not found!");
    console.error("Please create it first:");
    console.error("  cd backend");
    console.error("  python -m venv venv");
    console.error(
      isWindows ? "  venv\\Scripts\\activate.bat" : "  source venv/bin/activate"
    );
    console.error("  pip install -r requirements.txt");
    console.error("  pip install pyinstaller");
    process.exit(1);
  }

  // Check if api.spec exists
  const specPath = path.join(backendDir, "api.spec");
  if (!fs.existsSync(specPath)) {
    log("error", "api.spec not found at: " + specPath);
    console.error("❌ api.spec not found at:", specPath);
    process.exit(1);
  }

  log("info", "Building Python backend...");
  log("info", "Spec file: " + specPath);

  // Run PyInstaller
  const pyinstaller = spawn(
    pythonPath,
    ["-m", "PyInstaller", "api.spec", "--clean", "--noconfirm"],
    {
      cwd: backendDir,
      stdio: "inherit",
      shell: true, // Important for Windows
    }
  );

  pyinstaller.on("error", (err) => {
    log("error", "Failed to start PyInstaller", err);
    console.error("❌ Failed to start PyInstaller:", err);
    process.exit(1);
  });

  pyinstaller.on("close", (code) => {
    if (code === 0) {
      log("info", "Python backend built successfully!");
      console.log("✅ Python backend built successfully!");
      const exePath = path.join(
        backendDir,
        "dist",
        isWindows ? "api.exe" : "api"
      );
      log("info", "Executable created at: " + exePath);
      console.log("Executable created at:", exePath);
    } else {
      log("error", "PyInstaller failed with code: " + code);
      console.error("❌ PyInstaller failed with code:", code);
      process.exit(code);
    }
  });
}

// Kill processes on specific ports with improved reliability
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";

    log("info", `Attempting to kill processes on port ${port}`);

    if (isWindows) {
      // Windows: Use netstat and taskkill with tree kill
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

        // Use taskkill with /T flag to kill process tree
        const killPromises = Array.from(pids).map((pid) => {
          return new Promise((pidResolve) => {
            exec(`taskkill /PID ${pid} /T /F`, (killError, stdout, stderr) => {
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
          // Wait a bit for processes to actually terminate
          setTimeout(resolve, 2000);
        });
      });
    } else {
      // Unix/Linux/Mac: Use lsof and kill with process group
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

        // Try graceful termination first
        exec(`kill -TERM ${pids.join(" ")}`, (termError) => {
          if (termError) {
            log("warn", `SIGTERM failed, trying SIGKILL: ${termError.message}`);
          }

          // Wait a bit, then force kill if needed
          setTimeout(() => {
            exec(`kill -9 ${pids.join(" ")} 2>/dev/null`, (killError) => {
              if (killError) {
                log(
                  "debug",
                  `SIGKILL completed (some processes may have already exited)`
                );
              } else {
                log("info", `Force killed remaining processes on port ${port}`);
              }
              // Wait for processes to actually terminate
              setTimeout(resolve, 2000);
            });
          }, 3000);
        });
      });
    }
  });
}

// Enhanced process cleanup with better error handling and sequencing
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

    // Step 1: Terminate our spawned processes gracefully
    if (backendProcess && !backendProcess.killed) {
      log("info", "Terminating backend process gracefully");
      cleanupPromises.push(terminateProcess(backendProcess, BACKEND_PORT));
    }

    if (frontendProcess && !frontendProcess.killed) {
      log("info", "Terminating frontend process gracefully");
      cleanupPromises.push(terminateProcess(frontendProcess, BACKEND_PORT));
    }

    // Wait for graceful termination
    await Promise.all(cleanupPromises);

    // Step 2: Kill any remaining processes on our ports
    log("info", "Cleaning up processes on ports");
    await Promise.all([killProcessOnPort(BACKEND_PORT)]);

    // Step 3: Clean up any tracked processes
    if (trackedProcesses.size > 0) {
      log("info", `Cleaning up ${trackedProcesses.size} tracked processes`);
      const trackedCleanup = Array.from(trackedProcesses.entries()).map(
        ([pid, data]) => {
          return new Promise((resolve) => {
            try {
              if (data.cleanup) {
                data.cleanup();
              }

              // Try to kill the process if it still exists
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

    // Step 4: Final port cleanup to ensure everything is clear
    log("info", "Final port cleanup verification");
    await Promise.all([killProcessOnPort(BACKEND_PORT)]);

    log("info", "Enhanced process cleanup completed successfully");
  } catch (error) {
    log("error", "Error during process cleanup", error);
  } finally {
    cleanupInProgress = false;
  }
}

// Create main window

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"), // Uncomment if you have a preload script
    },
  });

  // Load your app
  if (isDev) {
    // Development mode - load from Next.js dev server
    mainWindow.loadURL("http://localhost:3000").catch((err) => {
      log("error", "Failed to load dev URL", err);
      console.error(
        "❌ Failed to load dev URL. Is your Next.js dev server running?"
      );
      console.error("Run: npm run dev:next");
    });
  } else {
    // Production mode - Next.js outputs to frontend/out
    const possiblePaths = [
      path.join(__dirname, "frontend", "out", "index.html"), // From project root
      path.join(__dirname, "..", "frontend", "out", "index.html"), // From electron folder
      path.join(process.resourcesPath, "frontend", "out", "index.html"), // From resources
      path.join(process.resourcesPath, "app", "frontend", "out", "index.html"), // From app.asar
    ];

    let indexPath = null;
    for (const p of possiblePaths) {
      log("info", "Checking path: " + p);
      console.log("Checking:", p);
      if (fs.existsSync(p)) {
        indexPath = p;
        log("info", "Found index.html at: " + indexPath);
        console.log("✅ Found index.html at:", indexPath);
        break;
      }
    }

    if (indexPath) {
      mainWindow.loadFile(indexPath).catch((err) => {
        log("error", "Failed to load file", err);
        console.error("❌ Failed to load:", indexPath, err);
      });
    } else {
      log("error", "index.html not found in any expected location");
      console.error("❌ index.html not found!");
      console.error("Checked paths:", possiblePaths);
      console.error("\nMake sure you ran: npm run build:next");

      // Show error in window
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

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Log any loading errors
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
      log("info", "Development mode: assuming backend is running separately");
      resolve();
      return;
    }

    const exePath = getResourcePath(path.join("backend", "main.exe"));
    log("info", `Backend executable path: ${exePath}`);

    if (!fs.existsSync(exePath)) {
      const error = `Backend executable not found at: ${exePath}`;
      log("error", error);
      reject(new Error(error));
      return;
    }

    log("info", "Starting backend process");

    // Enhanced spawn options for better process management
    backendProcess = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      stdio: ["pipe", "pipe", "pipe"],
      detached: false, // Keep attached for better cleanup
      windowsHide: true, // Hide console window on Windows
      env: {
        ...process.env,
        PORT: BACKEND_PORT.toString(),
        HOST: "127.0.0.1",
      },
    });

    // Enhanced process tracking
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

    // Improved startup detection
    setTimeout(() => {
      log("info", "Backend startup timeout reached, assuming ready");
      resolve();
    }, 5000);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  log("info", "Electron app ready");

  // Build backend if needed (typically only in dev or first run)
  if (isDev) {
    buildBackend();
  }
  try {
    await killProcessOnPort(BACKEND_PORT);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await startBackend();
  } catch (error) {
    log("error", "Application startup failed", error);

    dialog.showErrorBox(
      "Startup Failed",
      `Application failed to start:\n\n${error.message}\n\nPlease check ${logFile} for detailed logs.\n\nThe application will continue to try starting in the background.`
    );

    log("info", "Attempting to create window despite health check failure");
    createWindow();
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
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
