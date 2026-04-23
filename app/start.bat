@echo off
REM ACE-Step UI Startup Script for Windows
setlocal
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..\..") do set "PINOKIO_HOME=%%~fI"
set "PINOKIO_NODE_PATH=%PINOKIO_HOME%\bin\miniconda"
if exist "%PINOKIO_HOME%\bin\miniconda\node.exe" (
    set "PATH=%PINOKIO_NODE_PATH%;%PATH%"
    echo [+] Using Pinokio Node.js from %PINOKIO_NODE_PATH%
)

echo ==================================
echo   ACE-Step UI (Windows)
echo ==================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Error: Dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo Error: Server dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

REM Get local IP for LAN access
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set LOCAL_IP=%%b
    )
)

echo Starting ACE-Step UI...
echo.
echo Make sure ACE-Step Gradio + API is running:
echo   cd path\to\ACE-Step
echo   set MASTER_ADDR=127.0.0.1
echo   set VLLM_HOST_IP=127.0.0.1
echo   set ACESTEP_LM_BACKEND=pt
echo   set ACESTEP_LM_OFFLOAD_TO_CPU=true
echo   env\Scripts\acestep.exe --port 8001 --enable-api --backend pt --server-name 127.0.0.1
echo.
echo ==================================
echo.

REM Start backend in new window
echo Starting backend server...
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo Backend is already running on port 3001. Skipping backend startup.
) else (
    start "ACE-Step UI Backend" cmd /k "set PATH=%PINOKIO_NODE_PATH%;%PATH% && cd /d "%SCRIPT_DIR%server" && where node && node -v && where npm && npm -v && npm run dev"
)

REM Wait for backend to start
echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

REM Start frontend in new window
echo Starting frontend...
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo Frontend is already running on port 3000. Skipping frontend startup.
) else (
    start "ACE-Step UI Frontend" cmd /k "set PATH=%PINOKIO_NODE_PATH%;%PATH% && cd /d "%SCRIPT_DIR%" && where node && node -v && where npm && npm -v && npm run dev"
)

REM Wait a moment
timeout /t 2 /nobreak >nul

echo.
echo ==================================
echo   ACE-Step UI Running!
echo ==================================
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:3001
echo.
if defined LOCAL_IP (
    echo   LAN Access: http://%LOCAL_IP%:3000
    echo.
)
echo   Close the terminal windows to stop.
echo.
echo ==================================
echo.
echo Opening browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000

pause
