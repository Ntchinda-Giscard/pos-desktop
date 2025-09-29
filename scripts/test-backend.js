// scripts/test-backend.js
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

/**
 * This script helps you test your FastAPI backend independently
 * Run it with: node scripts/test-backend.js
 */

const BACKEND_PORT = 8001
// const BACKEND_HOST = '0.0.0.0'
const BACKEND_HOST = '127.0.0.1'

async function testBackend() {
  console.log('🧪 Testing FastAPI backend independently...')
  
  // Find the backend executable
  const backendPath = path.join(__dirname, '../backend/dist/main.exe')
  console.log(`📁 Backend path: ${backendPath}`)
  
  // Start the backend server
  console.log('🚀 Starting FastAPI server...')
  const server = spawn(backendPath, [], {
    env: {
      ...process.env,
      PORT: BACKEND_PORT,
      HOST: BACKEND_HOST,
      PYTHONUNBUFFERED: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // Log all output
  server.stdout.on('data', (data) => {
    console.log('📤 STDOUT:', data.toString().trim())
  })

  server.stderr.on('data', (data) => {
    console.log('📥 STDERR:', data.toString().trim())
  })

  server.on('error', (error) => {
    console.error('❌ Server error:', error)
  })

  server.on('close', (code) => {
    console.log(`🔚 Server closed with code: ${code}`)
  })

  // Wait a bit for the server to start
  console.log('⏳ Waiting for server to start...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Test various endpoints
  const endpoints = ['/', '/health', '/docs', '/openapi.json']
  
  for (const endpoint of endpoints) {
    console.log(`\n🔍 Testing endpoint: ${endpoint}`)
    
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(`http://localhost:${BACKEND_PORT}${endpoint}`, (response) => {
          console.log(`✅ ${endpoint} - Status: ${response.statusCode}`)
          
          let data = ''
          response.on('data', chunk => data += chunk)
          response.on('end', () => {
            if (data.length > 0) {
              console.log(`📄 Response preview: ${data.substring(0, 200)}...`)
            }
            resolve()
          })
        }).on('error', reject)
        
        request.setTimeout(5000)
      })
    } catch (error) {
      console.log(`❌ ${endpoint} - Error: ${error.message}`)
    }
  }
  
  console.log('\n🎯 Test completed! Press Ctrl+C to stop the server.')
  
  // Keep the process running so you can manually test
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping server...')
    server.kill('SIGTERM')
    process.exit(0)
  })
}

testBackend().catch(console.error)