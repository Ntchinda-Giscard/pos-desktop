const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const fsPromises = require("fs").promises; // For async operations like stat, readdir
const path = require("path"); // This is for handling file paths
const http = require("http");
const net = require("net");
const os = require("os");

// Enhanced development mode detection
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.ELECTRON_IS_DEV === "1" ||
  !app.isPackaged;

// Port configuration - using different ports for dev vs production
const FRONTEND_PORT = isDev ? 3000 : 3002;
const BACKEND_PORT = isDev ? 7626 : 7626;

let backendProcess;
let frontendProcess;
let mainWindow;
let isShuttingDown = false;
let cleanupInProgress = false;

// Enhanced process tracking with cleanup callbacks
const trackedProcesses = new Map(); // pid -> { process, cleanup }

// Enhanced logging system
const logFile = path.join(
  isDev ? __dirname : path.dirname(app.getPath("exe")),
  "debug.log"
);

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

// Enhanced process termination with better cross-platform support
function terminateProcess(process, timeout = 10000) {
  return new Promise((resolve) => {
    if (!process || process.killed) {
      resolve();
      return;
    }

    let resolved = false;
    const resolveOnce = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    // Listen for process exit
    process.once("exit", resolveOnce);
    process.once("close", resolveOnce);

    const isWindows = process.platform === "win32";

    try {
      if (isWindows) {
        // Windows: Use taskkill for more reliable termination
        exec(`taskkill /PID ${process.pid} /T /F`, (error) => {
          if (error) {
            log(
              "warn",
              `Failed to taskkill process ${process.pid}: ${error.message}`
            );
          } else {
            log(
              "info",
              `Successfully terminated process ${process.pid} with taskkill`
            );
          }
          setTimeout(resolveOnce, 1000);
        });
      } else {
        // Unix-like: Try graceful termination first
        process.kill("SIGTERM");

        // Force kill after timeout
        setTimeout(() => {
          if (!process.killed && !resolved) {
            try {
              process.kill("SIGKILL");
              log("info", `Force killed process ${process.pid}`);
            } catch (killError) {
              log(
                "warn",
                `Failed to force kill process ${process.pid}: ${killError.message}`
              );
            }
          }
          setTimeout(resolveOnce, 1000);
        }, timeout / 2);
      }
    } catch (error) {
      log("warn", `Error terminating process ${process.pid}: ${error.message}`);
      setTimeout(resolveOnce, 1000);
    }

    // Final timeout
    setTimeout(resolveOnce, timeout);
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
      cleanupPromises.push(terminateProcess(backendProcess, 8000));
    }

    if (frontendProcess && !frontendProcess.killed) {
      log("info", "Terminating frontend process gracefully");
      cleanupPromises.push(terminateProcess(frontendProcess, 8000));
    }

    // Wait for graceful termination
    await Promise.all(cleanupPromises);

    // Step 2: Kill any remaining processes on our ports
    log("info", "Cleaning up processes on ports");
    await Promise.all([
      killProcessOnPort(FRONTEND_PORT),
      killProcessOnPort(BACKEND_PORT),
    ]);

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
    await Promise.all([
      killProcessOnPort(FRONTEND_PORT),
      killProcessOnPort(BACKEND_PORT),
    ]);

    log("info", "Enhanced process cleanup completed successfully");
  } catch (error) {
    log("error", "Error during process cleanup", error);
  } finally {
    cleanupInProgress = false;
  }
}

// Check if Node.js is installed and get version
function checkNodeJs() {
  return new Promise((resolve) => {
    exec("node --version", (error, stdout) => {
      if (error) {
        log("warn", "Node.js not found in PATH");
        resolve({ installed: false, version: null });
      } else {
        const version = stdout.trim();
        log("info", `Node.js found: ${version}`);
        resolve({ installed: true, version });
      }
    });
  });
}

// Download and install Node.js
async function installNodeJs() {
  return new Promise((resolve, reject) => {
    const platform = os.platform();
    const arch = os.arch();

    log("info", `Installing Node.js for ${platform} ${arch}`);

    let downloadUrl;
    let filename;

    // Determine download URL based on platform
    const nodeVersion = "v20.11.0"; // LTS version

    switch (platform) {
      case "win32":
        if (arch === "x64") {
          downloadUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-x64.msi`;
          filename = `node-${nodeVersion}-x64.msi`;
        } else {
          downloadUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-x86.msi`;
          filename = `node-${nodeVersion}-x86.msi`;
        }
        break;
      case "darwin":
        downloadUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}.pkg`;
        filename = `node-${nodeVersion}.pkg`;
        break;
      case "linux":
        downloadUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-linux-x64.tar.xz`;
        filename = `node-${nodeVersion}-linux-x64.tar.xz`;
        break;
      default:
        reject(new Error(`Unsupported platform: ${platform}`));
        return;
    }

    const tempDir = os.tmpdir();
    const installerPath = path.join(tempDir, filename);

    log("info", `Downloading Node.js from: ${downloadUrl}`);

    // Download the installer
    const https = require("https");
    const file = fs.createWriteStream(installerPath);

    https
      .get(downloadUrl, (response) => {
        response.pipe(file);

        file.on("finish", () => {
          file.close();
          log("info", `Node.js installer downloaded to: ${installerPath}`);

          // Install Node.js
          let installCommand;

          switch (platform) {
            case "win32":
              installCommand = `msiexec /i "${installerPath}" /quiet /norestart`;
              break;
            case "darwin":
              installCommand = `sudo installer -pkg "${installerPath}" -target /`;
              break;
            case "linux":
              // For Linux, we'll extract to a local directory
              const extractPath = path.join(app.getPath("userData"), "nodejs");
              installCommand = `mkdir -p "${extractPath}" && tar -xf "${installerPath}" -C "${extractPath}" --strip-components=1`;
              break;
          }

          log("info", `Running install command: ${installCommand}`);

          exec(installCommand, (error, stdout, stderr) => {
            if (error) {
              log("error", "Node.js installation failed", error);
              reject(error);
            } else {
              log("info", "Node.js installation completed successfully");

              // Clean up installer
              try {
                fs.unlinkSync(installerPath);
              } catch (cleanupError) {
                log("warn", "Failed to clean up installer", cleanupError);
              }

              resolve();
            }
          });
        });
      })
      .on("error", (error) => {
        log("error", "Failed to download Node.js installer", error);
        reject(error);
      });
  });
}

// Enhanced Node.js check with installation prompt
async function ensureNodeJs() {
  const nodeCheck = await checkNodeJs();

  if (!nodeCheck.installed) {
    const response = await dialog.showMessageBox(null, {
      type: "question",
      buttons: ["Install Node.js", "Continue without Node.js", "Exit"],
      defaultId: 0,
      title: "Node.js Required",
      message: "Node.js is required to run this application.",
      detail:
        "Would you like to install Node.js automatically? This may require administrator privileges.",
    });

    switch (response.response) {
      case 0: // Install Node.js
        try {
          await installNodeJs();

          // Verify installation
          const recheckNode = await checkNodeJs();
          if (!recheckNode.installed) {
            throw new Error("Node.js installation verification failed");
          }

          dialog.showMessageBox(null, {
            type: "info",
            title: "Installation Complete",
            message: "Node.js has been installed successfully!",
            detail: "The application will now continue starting.",
          });
        } catch (error) {
          log("error", "Node.js installation failed", error);

          const retryResponse = await dialog.showMessageBox(null, {
            type: "error",
            buttons: ["Retry", "Continue Anyway", "Exit"],
            defaultId: 1,
            title: "Installation Failed",
            message: "Failed to install Node.js automatically.",
            detail: `Error: ${error.message}\n\nYou can try installing Node.js manually from nodejs.org or continue without it (frontend may not work).`,
          });

          if (retryResponse.response === 0) {
            return ensureNodeJs(); // Retry
          } else if (retryResponse.response === 2) {
            app.quit();
            return false;
          }
        }
        break;

      case 1: // Continue without Node.js
        log("warn", "Continuing without Node.js - frontend may not work");
        break;

      case 2: // Exit
        app.quit();
        return false;
    }
  }

  return true;
}

function createWindow() {
  log("info", "Creating main window");

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "icons", "icon.png"),
    backgroundColor: "#ffffff",
    show: false,
  });

  // Enhanced error handling for window loading
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      log("error", "Window failed to load", {
        errorCode,
        errorDescription,
        validatedURL,
        isDev,
        frontendPort: FRONTEND_PORT,
      });

      dialog.showErrorBox(
        "Loading Error",
        `Failed to load application:\n\nError: ${errorDescription}\nURL: ${validatedURL}\n\nCheck ${logFile} for more details.`
      );
    }
  );

  mainWindow.webContents.once("did-finish-load", () => {
    log("info", "Window loaded successfully");
    mainWindow.show();

    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      log("renderer", `Console [${level}]: ${message} (${sourceId}:${line})`);
    }
  );

  // Handle window close with improved cleanup
  mainWindow.on("close", async (event) => {
    if (!isShuttingDown && !cleanupInProgress) {
      log("info", "Window close requested, starting cleanup");
      event.preventDefault();

      try {
        await cleanupProcesses();
        mainWindow.destroy();
      } catch (error) {
        log("error", "Error during cleanup", error);
        mainWindow.destroy();
      }
    }
  });

  const appURL = `http://127.0.0.1:${FRONTEND_PORT}`;
  log("info", `Loading application from: ${appURL}`);

  mainWindow.loadURL(appURL);
}

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

function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, relativePath);
  } else {
    return path.join(process.resourcesPath, relativePath);
  }
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

function startFrontend() {
  return new Promise((resolve, reject) => {
    log("info", "Starting frontend server");

    if (isDev) {
      log("info", "Development mode: assuming frontend dev server is running");
      resolve();
      return;
    }

    const serverJsPath = getResourcePath(path.join("frontend", "server.js"));
    log("info", `Frontend server.js path: ${serverJsPath}`);

    if (!fs.existsSync(serverJsPath)) {
      const error = `Frontend server.js not found at: ${serverJsPath}`;
      log("error", error);
      reject(new Error(error));
      return;
    }

    log("info", "Starting frontend process");

    let resolved = false;

    // Enhanced spawn options for better process management
    frontendProcess = spawn("node", [serverJsPath], {
      cwd: path.dirname(serverJsPath),
      stdio: ["pipe", "pipe", "pipe"],
      detached: false, // Keep attached for better cleanup
      windowsHide: true, // Hide console window on Windows
      env: {
        ...process.env,
        PORT: FRONTEND_PORT.toString(),
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
      },
    });

    // Enhanced process tracking
    trackedProcesses.set(frontendProcess.pid, {
      process: frontendProcess,
      cleanup: () => {
        log("info", "Cleaning up frontend process");
      },
    });

    frontendProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      log("frontend", output);

      if (
        !resolved &&
        (output.includes("Ready in") ||
          output.includes("started server") ||
          output.includes("listening on") ||
          output.includes("Local:") ||
          (output.includes("✓") && output.includes("Ready")))
      ) {
        log("info", "Frontend server detected as ready from output");
        resolved = true;
        setTimeout(() => resolve(), 1000);
      }
    });

    frontendProcess.stderr.on("data", (data) => {
      const output = data.toString().trim();
      log("frontend-err", output);

      if (
        !resolved &&
        (output.includes("Ready in") ||
          output.includes("started server") ||
          output.includes("listening on"))
      ) {
        log("info", "Frontend server detected as ready from stderr");
        resolved = true;
        setTimeout(() => resolve(), 1000);
      }
    });

    frontendProcess.on("error", (err) => {
      log("error", "Frontend process error", err);
      trackedProcesses.delete(frontendProcess.pid);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    frontendProcess.on("exit", (code, signal) => {
      log(
        "warn",
        `Frontend process exited with code ${code}, signal: ${signal}`
      );
      trackedProcesses.delete(frontendProcess.pid);
      if (!resolved) {
        resolved = true;
        reject(
          new Error(`Frontend process exited unexpectedly with code ${code}`)
        );
      }
    });

    setTimeout(() => {
      if (!resolved) {
        log(
          "info",
          "Frontend startup timeout reached, proceeding with connection test"
        );
        resolved = true;
        resolve();
      }
    }, 15000);
  });
}

function waitForServer(port, maxAttempts = 60, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function checkServer() {
      attempts++;
      log("debug", `Health check attempt ${attempts} for port ${port}`);

      const socket = new net.Socket();

      const timeout = setTimeout(() => {
        socket.destroy();
        log("debug", `Health check timeout for port ${port}`);

        if (attempts < maxAttempts) {
          setTimeout(checkServer, intervalMs);
        } else {
          log(
            "error",
            `Server health check failed after ${maxAttempts} attempts`
          );
          reject(
            new Error(
              `Server not responding on port ${port} after ${maxAttempts} attempts`
            )
          );
        }
      }, 3000);

      socket.connect(port, "127.0.0.1", () => {
        clearTimeout(timeout);
        socket.destroy();
        log("info", `Server health check successful for port ${port}`);
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        socket.destroy();
        log("debug", `Health check failed for port ${port}: ${err.message}`);

        if (attempts < maxAttempts) {
          setTimeout(checkServer, intervalMs);
        } else {
          log(
            "error",
            `Server health check failed after ${maxAttempts} attempts`
          );
          reject(
            new Error(
              `Server not responding on port ${port} after ${maxAttempts} attempts: ${err.message}`
            )
          );
        }
      });
    }

    checkServer();
  });
}

function waitForHttpServer(port, maxAttempts = 30, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function checkServer() {
      attempts++;
      log("debug", `HTTP health check attempt ${attempts} for port ${port}`);

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: port,
          path: "/",
          method: "GET",
          timeout: 3000,
        },
        (res) => {
          log(
            "info",
            `HTTP health check successful for port ${port} (status: ${res.statusCode})`
          );
          resolve();
        }
      );

      req.on("error", (err) => {
        log(
          "debug",
          `HTTP health check failed for port ${port}: ${err.message}`
        );

        if (attempts < maxAttempts) {
          setTimeout(checkServer, intervalMs);
        } else {
          log(
            "error",
            `HTTP server health check failed after ${maxAttempts} attempts`
          );
          reject(
            new Error(
              `HTTP server not responding on port ${port} after ${maxAttempts} attempts`
            )
          );
        }
      });

      req.on("timeout", () => {
        log("debug", `HTTP health check timeout for port ${port}`);
        req.destroy();
      });

      req.end();
    }

    checkServer();
  });
}

// Main application startup sequence
app.whenReady().then(async () => {
  log("info", "Electron app ready, starting initialization", {
    isDev,
    frontendPort: FRONTEND_PORT,
    backendPort: BACKEND_PORT,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });

  try {
    // Clean up any existing processes on our ports
    log("info", "Step 0: Cleaning up existing processes");
    await killProcessOnPort(FRONTEND_PORT);
    await killProcessOnPort(BACKEND_PORT);

    // Wait a bit for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Ensure Node.js is available
    log("info", "Step 1: Checking Node.js installation");
    const nodeOk = await ensureNodeJs();
    if (!nodeOk) return;

    // Start servers in sequence
    log("info", "Step 2: Starting backend server");
    await startBackend();

    log("info", "Step 3: Starting frontend server");
    await startFrontend();

    // Wait for servers to be ready
    log("info", "Step 4: Waiting for servers to be ready");

    if (isDev) {
      await Promise.all([
        waitForServer(FRONTEND_PORT, 30, 2000).catch(async () => {
          log("warn", "Socket health check failed, trying HTTP check...");
          return waitForHttpServer(FRONTEND_PORT, 15, 2000);
        }),
        waitForServer(BACKEND_PORT, 15, 1000).catch(() => {
          log("warn", "Backend health check failed, but continuing...");
        }),
      ]);
    } else {
      try {
        await waitForServer(FRONTEND_PORT, 60, 1000);
      } catch (error) {
        log("warn", "Socket health check failed, trying HTTP method...");
        await waitForHttpServer(FRONTEND_PORT, 30, 1000);
      }
    }

    log("info", "Step 5: Creating main window");
    createWindow();
  } catch (error) {
    log("error", "Application startup failed", error);

    dialog.showErrorBox(
      "Startup Failed",
      `Application failed to start:\n\n${error.message}\n\nPlease check ${logFile} for detailed logs.\n\nThe application will continue to try starting in the background.`
    );

    log("info", "Attempting to create window despite health check failure");
    createWindow();
  }
});

// Enhanced app event handlers with better process cleanup
app.on("window-all-closed", async () => {
  log("info", "All windows closed, cleaning up");
  await cleanupProcesses();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
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

// Enhanced signal handlers with proper cleanup
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

// Handle uncaught exceptions with cleanup
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

// Additional Windows-specific cleanup
if (process.platform === "win32") {
  process.on("SIGHUP", async () => {
    log("info", "Received SIGHUP, cleaning up...");
    await cleanupProcesses();
    process.exit(0);
  });
}
