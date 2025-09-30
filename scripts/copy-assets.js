// // scripts/copy-assets.js
// const fs = require('fs-extra')
// const path = require('path')

// /**
//  * This script prepares all the assets needed for the Electron build process.
//  * It copies your built frontend and backend files to a resources directory
//  * that Electron Builder will include in the final packaged application.
//  *
//  * The key insight here is understanding the difference between development
//  * and production paths, and ensuring Next.js is properly configured for
//  * standalone deployment.
//  */

// async function copyAssets() {
//   console.log('🚀 Starting asset preparation for Electron build...')

//   const resourcesDir = path.join(__dirname, '../resources')

//   try {
//     // Clean up any existing resources directory
//     console.log('🧹 Cleaning up existing resources directory...')
//     await fs.remove(resourcesDir)
//     await fs.ensureDir(resourcesDir)

//     // Step 1: Validate Next.js build configuration
//     console.log('🔍 Validating Next.js configuration...')
//     await validateNextJsConfig()

//     // Step 2: Copy the built Next.js frontend
//     console.log('📦 Copying Next.js frontend assets...')
//     await copyFrontendAssets(resourcesDir)

//     // Step 3: Copy the backend executable and dependencies
//     console.log('🐍 Copying FastAPI backend assets...')
//     await copyBackendAssets(resourcesDir)

//     // Step 4: Verify the structure and create debugging info
//     console.log('🔍 Verifying copied assets...')
//     await verifyAndCreateManifest(resourcesDir)

//     console.log('🎉 Asset preparation completed successfully!')
//     console.log(`📁 Resources are ready in: ${resourcesDir}`)

//   } catch (error) {
//     console.error('❌ Asset preparation failed:', error.message)
//     console.error('Full error:', error)
//     process.exit(1)
//   }
// }

// async function validateNextJsConfig() {
//   const nextConfigPath = path.join(__dirname, '../frontend/next.config.js')
//   const nextConfigMjsPath = path.join(__dirname, '../frontend/next.config.mjs')

//   // Check if Next.js config exists
//   const configExists = await fs.pathExists(nextConfigPath) || await fs.pathExists(nextConfigMjsPath)

//   if (!configExists) {
//     console.log('⚠️  No next.config.js found. This might be okay, but standalone mode needs to be enabled.')
//     console.log('💡 Consider creating a next.config.js with output: "standalone"')
//   }

//   // Check if the standalone build exists
//   const standalonePath = path.join(__dirname, '../frontend/.next/standalone')
//   if (!await fs.pathExists(standalonePath)) {
//     throw new Error(
//       `Next.js standalone build not found at ${standalonePath}.\n\n` +
//       'Please ensure your next.config.js includes:\n' +
//       'module.exports = {\n' +
//       '  output: "standalone",\n' +
//       '  // other config...\n' +
//       '}\n\n' +
//       'Then run "npm run build" in your frontend directory.'
//     )
//   }

//   console.log('✅ Next.js standalone build found')
// }

// async function copyFrontendAssets(resourcesDir) {
//   const frontendSource = path.join(__dirname, '../frontend/.next/standalone')
//   const frontendDest = path.join(resourcesDir, 'frontend')

//   // First, copy the main standalone build
//   await fs.copy(frontendSource, frontendDest, {
//     filter: (src, dest) => {
//       const relativePath = path.relative(frontendSource, src)

//       // Skip unnecessary files but keep everything else
//       if (relativePath.includes('node_modules/.cache') ||
//           relativePath.includes('.git') ||
//           relativePath.startsWith('.env.local') ||
//           relativePath.includes('.next/cache')) {
//         return false
//       }

//       return true
//     }
//   })

//   // Copy static files if they exist
//   const staticSource = path.join(__dirname, '../frontend/.next/static')
//   const staticDest = path.join(frontendDest, '.next/static')

//   if (await fs.pathExists(staticSource)) {
//     await fs.copy(staticSource, staticDest)
//     console.log('✅ Static assets copied')
//   }

//   // Copy public files if they exist
//   const publicSource = path.join(__dirname, '../frontend/public')
//   const publicDest = path.join(frontendDest, 'public')

//   if (await fs.pathExists(publicSource)) {
//     await fs.copy(publicSource, publicDest)
//     console.log('✅ Public assets copied')
//   }

//   // Ensure server.js exists and is executable
//   const serverJsPath = path.join(frontendDest, 'server.js')
//   if (!await fs.pathExists(serverJsPath)) {
//     throw new Error(
//       `server.js not found in standalone build. This usually means:\n` +
//       '1. Next.js output mode is not set to "standalone"\n' +
//       '2. The build process failed\n' +
//       '3. You need to run "npm run build" in your frontend directory'
//     )
//   }

//   console.log('✅ Frontend assets copied successfully')
// }

// async function copyBackendAssets(resourcesDir) {
//   const backendSource = path.join(__dirname, '../backend/dist')
//   const backendDest = path.join(resourcesDir, 'backend')

//   // Check if the backend directory exists
//   if (!await fs.pathExists(backendSource)) {
//     throw new Error(
//       `Backend dist directory not found at ${backendSource}.\n` +
//       'Please ensure your FastAPI backend is built and the executable exists.'
//     )
//   }

//   // Copy all backend distribution files
//   await fs.copy(backendSource, backendDest)

//   // Verify the main executable exists
//   const backendExe = path.join(backendDest, 'main.exe')
//   if (!await fs.pathExists(backendExe)) {
//     console.warn('⚠️  main.exe not found. This might cause issues in production.')
//     console.log('💡 Make sure your FastAPI app is compiled to main.exe in the dist folder')
//   }

//   console.log('✅ Backend assets copied successfully')
// }

// async function verifyAndCreateManifest(resourcesDir) {
//   const frontendServerJs = path.join(resourcesDir, 'frontend', 'server.js')
//   const frontendNextDir = path.join(resourcesDir, 'frontend', '.next')
//   const backendMainExe = path.join(resourcesDir, 'backend', 'main.exe')

//   // Create detailed verification report
//   const verification = {
//     frontend: {
//       serverJs: {
//         exists: await fs.pathExists(frontendServerJs),
//         path: frontendServerJs
//       },
//       nextBuild: {
//         exists: await fs.pathExists(frontendNextDir),
//         path: frontendNextDir
//       },
//       packageJson: {
//         exists: await fs.pathExists(path.join(resourcesDir, 'frontend', 'package.json')),
//         path: path.join(resourcesDir, 'frontend', 'package.json')
//       }
//     },
//     backend: {
//       executable: {
//         exists: await fs.pathExists(backendMainExe),
//         path: backendMainExe
//       }
//     }
//   }

//   // Log verification results
//   console.log('📋 Asset Verification Report:')
//   console.log(`   Frontend server.js: ${verification.frontend.serverJs.exists ? '✅' : '❌'}`)
//   console.log(`   Frontend .next build: ${verification.frontend.nextBuild.exists ? '✅' : '❌'}`)
//   console.log(`   Frontend package.json: ${verification.frontend.packageJson.exists ? '✅' : '❌'}`)
//   console.log(`   Backend executable: ${verification.backend.executable.exists ? '✅' : '❌'}`)

//   // Create manifest file for runtime debugging
//   const manifest = {
//     timestamp: new Date().toISOString(),
//     buildInfo: {
//       nodeVersion: process.version,
//       platform: process.platform,
//       arch: process.arch
//     },
//     verification,
//     troubleshooting: {
//       commonIssues: [
//         'If frontend server.js is missing, ensure Next.js has output: "standalone" in config',
//         'If backend executable is missing, ensure FastAPI is compiled with PyInstaller or similar',
//         'Check that all paths in main.js match the actual file locations'
//       ]
//     }
//   }

//   await fs.writeJson(path.join(resourcesDir, 'build-manifest.json'), manifest, { spaces: 2 })
//   console.log('📋 Build manifest created for debugging')

//   // Check for potential issues and provide guidance
//   if (!verification.frontend.serverJs.exists) {
//     console.error('❌ Critical: Frontend server.js is missing!')
//     console.log('💡 This will cause a white screen. Ensure Next.js is configured with output: "standalone"')
//   }

//   if (!verification.backend.executable.exists) {
//     console.warn('⚠️  Backend executable is missing. Backend functionality will not work.')
//   }
// }

// // Handle different ways this script might be called
// if (require.main === module) {
//   copyAssets()
// }

// module.exports = copyAssets

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

  // Step 1: Copy standalone build (server.js, package.json, slim .next)
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
      ];
      return !skipPatterns.some((pattern) => relativePath.includes(pattern));
    },
  });
  console.log("      ✅ Standalone files copied");

  // Step 2: Ensure node_modules exists
  const destNodeModules = path.join(frontendDest, "node_modules");
  if (await fs.pathExists(standaloneNodeModules)) {
    console.log("   📂 Copying standalone node_modules...");
    await fs.copy(standaloneNodeModules, destNodeModules);
    console.log("      ✅ Standalone node_modules copied");
  } else if (await fs.pathExists(fullNodeModules)) {
    console.log(
      "   ⚠️  Standalone node_modules not found, falling back to full node_modules..."
    );
    await fs.copy(fullNodeModules, destNodeModules);
    console.log("      ✅ Full node_modules copied");
  } else {
    throw new Error(
      "❌ No node_modules found (neither standalone nor full). App will not run."
    );
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
