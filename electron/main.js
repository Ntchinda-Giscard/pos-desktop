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

// App lifecycle
app.whenReady().then(() => {
  log("info", "Electron app ready");

  // Build backend if needed (typically only in dev or first run)
  if (isDev) {
    buildBackend();
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
