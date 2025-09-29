// electron/main.js - Enhanced version with subfolder scanning
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs").promises; // We'll use the promise-based version for cleaner async code

let mainWindow;

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

  mainWindow.loadURL("http://localhost:3000");
  // mainWindow.webContents.openDevTools();
}

// Your existing folder picker - this remains unchanged
ipcMain.handle("open-folder-picker", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select a Folder",
      buttonLabel: "Choose This Folder",
    });

    if (result.canceled) {
      return {
        success: false,
        path: null,
        message: "User canceled folder selection",
      };
    }

    const selectedPath = result.filePaths[0];
    console.log("Main process: User selected folder:", selectedPath);

    return {
      success: true,
      path: selectedPath,
      message: "Folder selected successfully",
    };
  } catch (error) {
    console.error("Main process: Error opening folder picker:", error);
    return {
      success: false,
      path: null,
      error: error.message,
    };
  }
});

// NEW: This function scans a directory and finds all its subfolders
// Think of this as creating a map of all the rooms in a house
ipcMain.handle("scan-subfolders", async (event, rootPath) => {
  try {
    console.log("Main process: Scanning subfolders in:", rootPath);

    // First, let's verify the root path exists and is accessible
    const rootStats = await fs.stat(rootPath);
    if (!rootStats.isDirectory()) {
      throw new Error("Provided path is not a directory");
    }

    // This array will hold all the subfolders we find
    const subfolders = [];

    // Read all items in the root directory
    const items = await fs.readdir(rootPath);

    // Check each item to see if it's a directory
    // We use Promise.all to check all items concurrently for better performance
    const itemChecks = items.map(async (item) => {
      const itemPath = path.join(rootPath, item);

      try {
        // Get information about this item (file or folder?)
        const itemStats = await fs.stat(itemPath);

        // If it's a directory, add it to our subfolder list
        if (itemStats.isDirectory()) {
          return {
            name: item, // Just the folder name (e.g., "documents")
            path: itemPath, // Full absolute path
            relativePath: item, // Path relative to root (same as name for direct children)
          };
        }
        return null; // Not a directory, so we ignore it
      } catch (error) {
        // Some folders might not be accessible due to permissions
        // We'll log this but continue with other folders
        console.warn(
          `Main process: Could not access ${itemPath}:`,
          error.message
        );
        return null;
      }
    });

    // Wait for all the checks to complete and filter out null values
    const results = await Promise.all(itemChecks);
    const validSubfolders = results.filter((item) => item !== null);

    console.log(`Main process: Found ${validSubfolders.length} subfolders`);

    return {
      success: true,
      subfolders: validSubfolders,
      count: validSubfolders.length,
      rootPath: rootPath,
    };
  } catch (error) {
    console.error("Main process: Error scanning subfolders:", error);
    return {
      success: false,
      error: error.message,
      subfolders: [],
      count: 0,
    };
  }
});

// OPTIONAL: Enhanced version that can scan nested subfolders recursively
// This is like mapping not just the main rooms, but also all the closets and sub-rooms
ipcMain.handle(
  "scan-subfolders-recursive",
  async (event, rootPath, maxDepth = 3) => {
    try {
      console.log("Main process: Recursive scanning subfolders in:", rootPath);

      const subfolders = [];

      // This inner function does the actual recursive work
      async function scanDirectory(currentPath, depth = 0, relativePath = "") {
        // Stop if we've gone too deep (prevents infinite loops and performance issues)
        if (depth > maxDepth) {
          return;
        }

        try {
          const items = await fs.readdir(currentPath);

          const itemChecks = items.map(async (item) => {
            const itemPath = path.join(currentPath, item);
            const itemRelativePath = relativePath
              ? path.join(relativePath, item)
              : item;

            try {
              const itemStats = await fs.stat(itemPath);

              if (itemStats.isDirectory()) {
                // Add this folder to our list
                subfolders.push({
                  name: item,
                  path: itemPath,
                  relativePath: itemRelativePath,
                  depth: depth + 1,
                });

                // Recursively scan this subfolder
                await scanDirectory(itemPath, depth + 1, itemRelativePath);
              }
            } catch (error) {
              console.warn(
                `Main process: Could not access ${itemPath}:`,
                error.message
              );
            }
          });

          await Promise.all(itemChecks);
        } catch (error) {
          console.warn(
            `Main process: Could not read directory ${currentPath}:`,
            error.message
          );
        }
      }

      // Start the recursive scan
      await scanDirectory(rootPath);

      console.log(
        `Main process: Found ${subfolders.length} subfolders (recursive)`
      );

      return {
        success: true,
        subfolders: subfolders,
        count: subfolders.length,
        rootPath: rootPath,
        maxDepth: maxDepth,
      };
    } catch (error) {
      console.error("Main process: Error in recursive subfolder scan:", error);
      return {
        success: false,
        error: error.message,
        subfolders: [],
        count: 0,
      };
    }
  }
);

// Standard Electron app lifecycle management
app.whenReady().then(() => {
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
