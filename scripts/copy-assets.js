// scripts/copy-assets.js
const fs = require("fs-extra");
const path = require("path");

/**
 * Asset preparation for Electron with Next.js Standalone Build
 *
 * Next.js standalone structure:
 * frontend/.next/standalone/
 * ├── server.js          ← Main server
 * ├── package.json       ← Minimal deps
 * ├── node_modules/      ← Production deps only
 * ├── .next/             ← Build output
 * │   └── ...
 *
 * Note: .next/static and public must be copied separately
 */

async function copyAssets() {
  console.log("🚀 Starting asset preparation for Electron build...");

  const resourcesDir = path.join(__dirname, "../resources");

  try {
    // Clean resources directory
    console.log("🧹 Cleaning resources directory...");
    await fs.remove(resourcesDir);
    await fs.ensureDir(resourcesDir);

    // Validate builds
    console.log("🔍 Validating builds...");
    await validateBuilds();

    // Copy frontend
    console.log("📦 Copying Next.js standalone build...");
    await copyFrontendAssets(resourcesDir);

    // Copy backend
    console.log("🐍 Copying backend...");
    await copyBackendAssets(resourcesDir);

    // Verify
    console.log("🔍 Verifying assets...");
    await verifyAndCreateManifest(resourcesDir);

    console.log("✅ Asset preparation completed!");
    console.log(`📁 Resources ready: ${resourcesDir}`);
  } catch (error) {
    console.error("❌ Asset preparation failed:", error.message);
    console.error("Full error:", error);
    process.exit(1);
  }
}

async function validateBuilds() {
  const standalonePath = path.join(__dirname, "../frontend/.next/standalone");
  const staticPath = path.join(__dirname, "../frontend/.next/static");
  const serverJsPath = path.join(standalonePath, "server.js");

  // Check standalone build exists
  if (!(await fs.pathExists(standalonePath))) {
    throw new Error(
      `❌ Standalone build not found: ${standalonePath}\n\n` +
        "📝 Your next.config.js must have:\n" +
        "   module.exports = {\n" +
        '     output: "standalone",\n' +
        "   }\n\n" +
        "🔨 Then run: cd frontend && npm run build"
    );
  }

  // Check server.js exists
  if (!(await fs.pathExists(serverJsPath))) {
    throw new Error(
      `❌ server.js not found in standalone build\n` +
        "The build may be incomplete. Try:\n" +
        "   cd frontend && rm -rf .next && npm run build"
    );
  }

  // Check static folder exists
  if (!(await fs.pathExists(staticPath))) {
    console.warn("⚠️  .next/static folder not found - this might cause issues");
  }

  // Check backend
  const backendDist = path.join(__dirname, "../backend/dist");
  if (!(await fs.pathExists(backendDist))) {
    throw new Error(
      `❌ Backend dist not found: ${backendDist}\n` +
        "🔨 Build your backend first"
    );
  }

  console.log("✅ Builds validated");
  console.log(`   Standalone: ${standalonePath}`);
  console.log(`   Backend: ${backendDist}`);
}

async function copyFrontendAssets(resourcesDir) {
  const standalonePath = path.join(__dirname, "../frontend/.next/standalone");
  const staticPath = path.join(__dirname, "../frontend/.next/static");
  const publicPath = path.join(__dirname, "../frontend/public");

  const standaloneNodeModules = path.join(standalonePath, "node_modules");
  const fullNodeModules = path.join(__dirname, "../frontend/node_modules");

  const frontendDest = path.join(resourcesDir, "frontend");

  // Step 1: Copy standalone build WITHOUT node_modules first
  console.log("   📂 Copying standalone build...");
  await fs.copy(standalonePath, frontendDest, {
    filter: (src) => {
      const relativePath = path.relative(standalonePath, src);
      const skipPatterns = [
        ".cache",
        "cache",
        ".git",
        ".env.local",
        ".DS_Store",
        // "node_modules", // SKIP node_modules during initial copy
      ];
      return !skipPatterns.some((pattern) => relativePath.includes(pattern));
    },
  });
  console.log("      ✅ Standalone files copied");

  // Step 2: Explicitly handle node_modules with better logic
  const destNodeModules = path.join(frontendDest, "node_modules");

  console.log("   📂 Handling node_modules...");

  // Check if standalone node_modules has actual content
  let standaloneHasContent = false;
  if (await fs.pathExists(standaloneNodeModules)) {
    try {
      const standaloneContents = await fs.readdir(standaloneNodeModules);
      standaloneHasContent = standaloneContents.length > 0;
      console.log(
        `      ℹ️  Standalone node_modules has ${standaloneContents.length} items`
      );
    } catch (err) {
      console.log("      ⚠️  Cannot read standalone node_modules");
    }
  }

  // Copy from the best source
  if (standaloneHasContent) {
    console.log("   📂 Copying standalone node_modules...");
    await fs.copy(standaloneNodeModules, destNodeModules);
    console.log("      ✅ Standalone node_modules copied");
  } else if (await fs.pathExists(fullNodeModules)) {
    console.log(
      "   📂 Copying full node_modules (standalone was empty/missing)..."
    );

    // Copy full node_modules but exclude dev dependencies and unnecessary packages
    await fs.copy(fullNodeModules, destNodeModules, {
      filter: (src) => {
        const relativePath = path.relative(fullNodeModules, src);

        // Skip certain heavy/unnecessary packages for production
        const skipPatterns = [
          ".cache",
          ".bin/",
          "eslint",
          "prettier",
          "@types/",
          "typescript",
        ];

        // Allow root and essential packages
        if (relativePath === "") return true;

        return !skipPatterns.some((pattern) => relativePath.includes(pattern));
      },
    });
    console.log("      ✅ Full node_modules copied");
  } else {
    throw new Error(
      "❌ No node_modules found anywhere. Run 'npm install' in frontend folder."
    );
  }

  // Verify node_modules has content after copy
  const finalNodeModulesContents = await fs.readdir(destNodeModules);
  console.log(
    `      ✅ Final node_modules has ${finalNodeModulesContents.length} packages`
  );

  if (finalNodeModulesContents.length === 0) {
    throw new Error("❌ node_modules is empty after copy!");
  }

  // Step 3: Copy .next/static (needed for client assets)
  if (await fs.pathExists(staticPath)) {
    const staticDest = path.join(frontendDest, ".next", "static");
    console.log("   📂 Copying .next/static...");
    await fs.copy(staticPath, staticDest);
    console.log("      ✅ Static assets copied");
  } else {
    console.warn("      ⚠️  .next/static not found - CSS/JS may be missing");
  }

  // Step 4: Copy public folder
  if (await fs.pathExists(publicPath)) {
    const publicDest = path.join(frontendDest, "public");
    console.log("   📂 Copying public folder...");
    await fs.copy(publicPath, publicDest);
    console.log("      ✅ Public folder copied");
  } else {
    console.log("      ℹ️  No public folder found (optional)");
  }

  // Step 5: Verify critical files
  console.log("   🔍 Verifying critical files...");
  const criticalChecks = {
    "server.js": await fs.pathExists(path.join(frontendDest, "server.js")),
    "package.json": await fs.pathExists(
      path.join(frontendDest, "package.json")
    ),
    node_modules: await fs.pathExists(path.join(frontendDest, "node_modules")),
    ".next": await fs.pathExists(path.join(frontendDest, ".next")),
    ".next/static": await fs.pathExists(
      path.join(frontendDest, ".next", "static")
    ),
  };

  for (const [file, exists] of Object.entries(criticalChecks)) {
    if (!exists) {
      throw new Error(
        `❌ Critical file missing: ${file}\nExpected at: ${path.join(
          frontendDest,
          file
        )}`
      );
    }
    console.log(`      ✅ ${file}`);
  }

  console.log("✅ Frontend copied successfully");
}

async function copyBackendAssets(resourcesDir) {
  const backendSource = path.join(__dirname, "../backend/dist");
  const backendDest = path.join(resourcesDir, "backend");

  // Copy backend
  await fs.copy(backendSource, backendDest);

  // Verify executable
  const backendExe = path.join(backendDest, "main.exe");
  if (await fs.pathExists(backendExe)) {
    console.log("   ✅ main.exe found");
  } else {
    console.warn("   ⚠️  main.exe not found - backend will not work!");
  }

  console.log("✅ Backend copied successfully");
}

async function verifyAndCreateManifest(resourcesDir) {
  const checks = {
    frontend: {
      serverJs: await fs.pathExists(
        path.join(resourcesDir, "frontend", "server.js")
      ),
      packageJson: await fs.pathExists(
        path.join(resourcesDir, "frontend", "package.json")
      ),
      nodeModules: await fs.pathExists(
        path.join(resourcesDir, "frontend", "node_modules")
      ),
      nextBuild: await fs.pathExists(
        path.join(resourcesDir, "frontend", ".next")
      ),
      nextStatic: await fs.pathExists(
        path.join(resourcesDir, "frontend", ".next", "static")
      ),
      public: await fs.pathExists(
        path.join(resourcesDir, "frontend", "public")
      ),
    },
    backend: {
      executable: await fs.pathExists(
        path.join(resourcesDir, "backend", "main.exe")
      ),
    },
  };

  // Display report
  console.log("\n📋 Verification Report:");
  console.log("   Frontend:");
  console.log(
    `      server.js:     ${checks.frontend.serverJs ? "✅" : "❌ CRITICAL"}`
  );
  console.log(
    `      package.json:  ${checks.frontend.packageJson ? "✅" : "❌ CRITICAL"}`
  );
  console.log(
    `      node_modules:  ${checks.frontend.nodeModules ? "✅" : "❌ CRITICAL"}`
  );
  console.log(
    `      .next:         ${checks.frontend.nextBuild ? "✅" : "❌ CRITICAL"}`
  );
  console.log(
    `      .next/static:  ${checks.frontend.nextStatic ? "✅" : "⚠️  WARNING"}`
  );
  console.log(
    `      public:        ${checks.frontend.public ? "✅" : "ℹ️  optional"}`
  );
  console.log("   Backend:");
  console.log(
    `      main.exe:      ${checks.backend.executable ? "✅" : "❌ CRITICAL"}`
  );

  // Create manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    buildInfo: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    checks,
    paths: {
      frontend: path.join(resourcesDir, "frontend"),
      backend: path.join(resourcesDir, "backend"),
    },
    instructions: {
      toRun: "node server.js (in frontend folder)",
      note: "Frontend includes minimal node_modules for production",
    },
  };

  await fs.writeJson(path.join(resourcesDir, "build-manifest.json"), manifest, {
    spaces: 2,
  });
  console.log("\n📋 Build manifest created");

  // Critical checks
  const criticalFailed = [
    !checks.frontend.serverJs && "server.js",
    !checks.frontend.packageJson && "package.json",
    !checks.frontend.nodeModules && "node_modules",
    !checks.frontend.nextBuild && ".next build",
  ].filter(Boolean);

  if (criticalFailed.length > 0) {
    throw new Error(
      `❌ CRITICAL FILES MISSING: ${criticalFailed.join(", ")}\n` +
        "The app will not work without these files."
    );
  }

  if (!checks.frontend.nextStatic) {
    console.warn("\n⚠️  WARNING: .next/static missing - CSS/JS may not load");
  }

  if (!checks.backend.executable) {
    console.warn("\n⚠️  WARNING: Backend executable missing");
  }

  console.log("\n✅ All critical checks passed!");
}

// Run if executed directly
if (require.main === module) {
  copyAssets();
}

module.exports = copyAssets;
