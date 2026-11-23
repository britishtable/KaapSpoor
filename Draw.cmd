@echo off
rem Double-click this to draw route lines. It does what `npm run draw` in app/
rem does -- start the editor, open it in your browser, offer to publish when you
rem press Enter -- so that a drawing session needs no terminal of its own.
setlocal
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, or not on PATH.
  echo Install it from https://nodejs.org and double-click this again.
  echo.
  pause
  exit /b 1
)

rem A fresh clone has no node_modules; install once rather than failing at you.
if not exist "node_modules\.package-lock.json" (
  echo First run: installing dependencies. This takes a minute.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

rem Draw on top of what is already published, not on top of a stale checkout.
git pull --ff-only

call npm run draw
if errorlevel 1 goto failed

echo.
echo Done. This window stays open so you can read what happened above.
pause
exit /b 0

:failed
echo.
echo Something went wrong -- the message above says what.
pause
exit /b 1
