@echo off
echo Starting Electron Development Environment...

cd /d "%~dp0.."

echo Checking setup...
node scripts\verify-setup.js

echo Starting Electron application...
npm run electron:dev

pause
