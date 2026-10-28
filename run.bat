@echo off
rem LearnBond: one-click start on Windows. Creates the virtual environment on first run.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment in .venv ...
  python -m venv .venv || (echo Python 3.9+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
if not exist .env copy .env.example .env >nul
echo Opening http://localhost:3000 ...
start "" http://localhost:3000
.venv\Scripts\python.exe server.py
pause
