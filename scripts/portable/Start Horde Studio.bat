@echo off
setlocal
cd /d "%~dp0app"
REM Keep a user-created environment at the package root working.
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" horde_mcp_bridge.py --open
    goto :eof
)
call "Start Horde Studio.bat"
