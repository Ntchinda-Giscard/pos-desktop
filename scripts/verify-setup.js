const fs = require("fs")
const path = require("path")

function checkSetup() {
  console.log("🔍 Verifying Electron application setup...\n")

  const projectRoot = path.resolve(__dirname, "..")
  const electronDir = path.join(projectRoot, "electron")
  const backendDir = path.join(projectRoot, "backend")
  const frontendDir = path.join(projectRoot, "frontend")

  let allGood = true

  // Check Electron
  console.log("⚡ Electron checks:")
  const mainJs = path.join(electronDir, "main.js")
  const preloadJs = path.join(electronDir, "preload.js")

  console.log(`   main.js: ${fs.existsSync(mainJs) ? "✅" : "❌"}`)
  console.log(`   preload.js: ${fs.existsSync(preloadJs) ? "✅" : "❌"}`)

  if (!fs.existsSync(mainJs)) allGood = false

  // Check Backend
  console.log("\n🐍 Backend checks:")
  console.log(`   Directory: ${fs.existsSync(backendDir) ? "✅" : "❌"}`)

  const pythonExe = path.join(backendDir, ".venv", "Scripts", "python.exe")
  const mainPy = path.join(backendDir, "main.py")
  const requirementsTxt = path.join(backendDir, "requirements.txt")

  console.log(`   Virtual env: ${fs.existsSync(pythonExe) ? "✅" : "❌"}`)
  console.log(`   main.py: ${fs.existsSync(mainPy) ? "✅" : "❌"}`)
  console.log(`   requirements.txt: ${fs.existsSync(requirementsTxt) ? "✅" : "❌"}`)

  if (!fs.existsSync(backendDir) || !fs.existsSync(pythonExe) || !fs.existsSync(mainPy)) {
    allGood = false
  }

  // Check Frontend
  console.log("\n⚛️ Frontend checks:")
  console.log(`   Directory: ${fs.existsSync(frontendDir) ? "✅" : "❌"}`)

  const packageJson = path.join(frontendDir, "package.json")
  const nodeModules = path.join(frontendDir, "node_modules")
  const nextConfig = path.join(frontendDir, "next.config.js")

  console.log(`   package.json: ${fs.existsSync(packageJson) ? "✅" : "❌"}`)
  console.log(`   node_modules: ${fs.existsSync(nodeModules) ? "✅" : "❌"}`)
  console.log(`   next.config.js: ${fs.existsSync(nextConfig) ? "✅" : "❌"}`)

  if (!fs.existsSync(frontendDir) || !fs.existsSync(packageJson) || !fs.existsSync(nodeModules)) {
    allGood = false
  }

  // Show setup instructions if needed
  if (!allGood) {
    console.log("\n🛠️ Setup Instructions:")

    if (!fs.existsSync(pythonExe)) {
      console.log("\n📋 Backend Setup:")
      console.log("   cd backend")
      console.log("   python -m venv .venv")
      console.log("   .venv\\Scripts\\activate")
      console.log("   pip install fastapi uvicorn")
    }

    if (!fs.existsSync(nodeModules)) {
      console.log("\n📋 Frontend Setup:")
      console.log("   cd frontend")
      console.log("   npm install")
    }

    console.log("\n📋 Electron Setup:")
    console.log("   npm install electron --save-dev")
  } else {
    console.log("\n🎉 All checks passed! Your setup looks good.")
  }

  return allGood
}

if (require.main === module) {
  checkSetup()
}

module.exports = { checkSetup }
