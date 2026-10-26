@echo off
rem Installs, builds and starts the Scholarship Finder web app locally.
rem Output is also saved to run-local.log next to this file.
setlocal
cd /d "%~dp0"
set LOG=%~dp0run-local.log
echo Scholarship Finder local run, %date% %time% > "%LOG%"

where node >nul 2>&1
if errorlevel 1 (
  echo NODE_MISSING: Node.js is not installed. Get the LTS version from https://nodejs.org >> "%LOG%"
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo node %%v >> "%LOG%"
for /f "delims=" %%v in ('npm -v') do echo npm %%v >> "%LOG%"

cd web
echo. >> "%LOG%"
echo === npm install === >> "%LOG%"
echo Installing packages (first time takes a minute or two)...
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 (
  echo INSTALL_FAILED >> "%LOG%"
  echo Install failed. See run-local.log.
  pause
  exit /b 1
)

echo. >> "%LOG%"
echo === npm run build === >> "%LOG%"
echo Building...
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 (
  echo BUILD_FAILED >> "%LOG%"
  echo Build failed. See run-local.log.
  pause
  exit /b 1
)
echo BUILD_OK >> "%LOG%"

echo. >> "%LOG%"
echo === dev server: http://localhost:5173 === >> "%LOG%"
echo.
echo Build succeeded. Starting the app at http://localhost:5173
echo Close this window to stop it.
call npm run dev -- --port 5173 --strictPort
