@echo off
rem Type-checks and builds the web app without starting it (works while
rem run-local.bat is running). Output goes to check-build.log in the project folder.
setlocal
cd /d "%~dp0..\web"
set LOG=%~dp0..\check-build.log
echo Build check, %date% %time% > "%LOG%"
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 (
  echo BUILD_FAILED >> "%LOG%"
  echo Build failed. See check-build.log.
) else (
  echo BUILD_OK >> "%LOG%"
  echo Build succeeded.
)
timeout /t 5 >nul
