@echo off
title Tiyu Daily - Local Preview
cd /d "%~dp0"

echo.
echo Starting local preview server ...
echo.
echo The window will print BOTH addresses:
echo   - this computer : http://127.0.0.1:8000/
echo   - same WiFi     : http://192.168.x.x:8000/   (the line marked with a star)
echo.
echo Phone / another device: use the STAR address, on the SAME WiFi.
echo Keep this window OPEN. Press Ctrl+C to stop (the phone loses access too).
echo.

where node >nul 2>nul
if not errorlevel 1 (
  node serve.mjs
  goto done
)

if exist "C:\Users\XH\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" (
  echo Node not in PATH - using WorkBuddy bundled Node ...
  "C:\Users\XH\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" serve.mjs
  goto done
)

echo.
echo [ERROR] Node.js not found on this computer.
echo Please install Node.js from https://nodejs.org then run this again.
echo.
pause

:done
