@echo off
title Tiyu Daily - Local Preview
cd /d "%~dp0"

echo.
echo Starting local preview server ...
echo.
echo Open in your browser:
echo.
echo   http://127.0.0.1:8000/index.html
echo.
echo Then click the nav links to browse pages.
echo Keep this window OPEN. Press Ctrl+C to stop.
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
