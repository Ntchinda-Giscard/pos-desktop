@echo off
echo Setting up backend environment...

cd /d "%~dp0..\backend"

echo Creating virtual environment...
python -m venv .venv

echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo Installing dependencies...
pip install fastapi uvicorn python-multipart

echo Backend setup complete!
pause
