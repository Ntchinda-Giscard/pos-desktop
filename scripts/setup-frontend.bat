@echo off
echo Setting up frontend environment...

cd /d "%~dp0..\frontend"

echo Installing Node.js dependencies...
npm install

echo Frontend setup complete!
pause
