@echo off
REM VsingerStudio Complete Startup Script for Windows
REM Starts ACE-Step API + Backend + Frontend
setlocal
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..\..") do set "PINOKIO_HOME=%%~fI"
set "PINOKIO_NODE_PATH=%PINOKIO_HOME%\bin\miniconda"
set "NPM_CACHE_DIR=%SCRIPT_DIR%\.npm-cache"
set "SERVER_NPM_CACHE_DIR=%SCRIPT_DIR%\server\.npm-cache"
if exist "%PINOKIO_HOME%\bin\miniconda\node.exe" (
    set "PATH=%PINOKIO_NODE_PATH%;%PATH%"
    echo [+] Using bundled Node.js from %PINOKIO_NODE_PATH%
)
if not exist "%NPM_CACHE_DIR%" mkdir "%NPM_CACHE_DIR%" >nul 2>&1
if not exist "%SERVER_NPM_CACHE_DIR%" mkdir "%SERVER_NPM_CACHE_DIR%" >nul 2>&1

echo ==================================
echo   VsingerStudio Complete Startup
echo ==================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Error: UI dependencies not installed!
    echo Please run npm install in the project root first.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo Error: Server dependencies not installed!
    echo Please run npm install in the server directory first.
    pause
    exit /b 1
)

REM Get ACE-Step path from environment or use default
if "%ACESTEP_PATH%"=="" (
    set "ACESTEP_PATH=%SCRIPT_DIR%\ACE-Step-1.5"
)

REM Check if ACE-Step exists
if not exist "%ACESTEP_PATH%" (
    echo.
    echo Warning: ACE-Step not found at %ACESTEP_PATH%
    echo.
    echo Please set ACESTEP_PATH or place ACE-Step-1.5 next to VsingerStudio
    echo Example: set ACESTEP_PATH=C:\ACE-Step-1.5
    echo.
    pause
    exit /b 1
)

REM Detect ACE-Step installation type
set API_COMMAND=
if exist "%ACESTEP_PATH%\python_embeded\python.exe" (
    echo [+] Detected Windows Portable Package
    set "API_COMMAND=python_embeded\python acestep\acestep_v15_pipeline.py --port 8001 --enable-api --backend pt --server-name 127.0.0.1"
) else if exist "%ACESTEP_PATH%\env\Scripts\python.exe" (
    echo [+] Detected Pinokio virtual environment
    set "API_COMMAND=env\Scripts\python.exe -m acestep.acestep_v15_pipeline --port 8001 --enable-api --backend pt --server-name 127.0.0.1"
) else if exist "%ACESTEP_PATH%\.venv\Scripts\python.exe" (
    echo [+] Detected local .venv environment
    set "API_COMMAND=.venv\Scripts\python.exe -m acestep.acestep_v15_pipeline --port 8001 --enable-api --backend pt --server-name 127.0.0.1"
) else if exist "%ACESTEP_PATH%\venv\Scripts\python.exe" (
    echo [+] Detected local venv environment
    set "API_COMMAND=venv\Scripts\python.exe -m acestep.acestep_v15_pipeline --port 8001 --enable-api --backend pt --server-name 127.0.0.1"
) else if exist "%ACESTEP_PATH%\env\Scripts\acestep-api.exe" (
    echo [+] Detected legacy API-only executable
    set "API_COMMAND=env\Scripts\acestep-api.exe --host 127.0.0.1 --port 8001"
) else (
    echo [+] Detected Standard Installation requiring uv
    set "API_COMMAND=uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1"
)

REM Get local IP for LAN access
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set LOCAL_IP=%%b
    )
)

echo.
echo ==================================
echo   Starting All Services...
echo ==================================
echo.

REM Start ACE-Step API in new window
echo [1/3] Starting ACE-Step API server...
netstat -ano | findstr /r /c:":8001 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo [1/3] ACE-Step API is already running on port 8001. Skipping.
) else (
    start "ACE-Step API Server" cmd /k "set PATH=%PINOKIO_NODE_PATH%;%PATH% && set MASTER_ADDR=127.0.0.1 && set VLLM_HOST_IP=127.0.0.1 && set ACESTEP_LM_BACKEND=pt && set ACESTEP_LM_OFFLOAD_TO_CPU=true && cd /d %ACESTEP_PATH% && %API_COMMAND%"
)

REM Wait for API to start
echo Waiting for API to initialize...
timeout /t 5 /nobreak >nul

echo Verifying backend native dependencies...
pushd "%SCRIPT_DIR%\server"
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close();" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [2/3] better-sqlite3 binding missing. Rebuilding with local npm cache...
    call npm rebuild better-sqlite3 --cache "%SERVER_NPM_CACHE_DIR%"
    if %ERRORLEVEL% NEQ 0 (
        echo Error: Failed to rebuild better-sqlite3.
        echo Hint: if the prebuilt download keeps failing, run npm install again in the server directory. If npm falls back to source compilation, install Visual Studio with the "Desktop development with C++" workload.
        popd
        pause
        exit /b 1
    )
    node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close();" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo Error: better-sqlite3 is still unavailable after rebuild.
        popd
        pause
        exit /b 1
    )
)
popd

REM Start backend in new window
echo [2/3] Starting backend server...
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo [2/3] Backend is already running on port 3001. Skipping.
) else (
    start "VsingerStudio Backend" cmd /k "set PATH=%PINOKIO_NODE_PATH%;%PATH% && set npm_config_cache=%SERVER_NPM_CACHE_DIR% && cd /d %SCRIPT_DIR%\server && where node && node -v && where npm && npm -v && npm run dev"
)

REM Wait for backend to start
echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

REM Start frontend in new window
echo [3/3] Starting frontend...
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo [3/3] Frontend is already running on port 3000. Skipping.
) else (
    start "VsingerStudio Frontend" cmd /k "set PATH=%PINOKIO_NODE_PATH%;%PATH% && set npm_config_cache=%NPM_CACHE_DIR% && cd /d %SCRIPT_DIR% && where node && node -v && where npm && npm -v && npm run dev"
)

REM Wait a moment
timeout /t 2 /nobreak >nul

echo.
echo ==================================
echo   All Services Running!
echo ==================================
echo.
echo   ACE-Step API: http://localhost:8001
echo   Backend:      http://localhost:3001
echo   Frontend:     http://localhost:3000
echo.
if defined LOCAL_IP (
    echo   LAN Access:   http://%LOCAL_IP%:3000
    echo.
)
echo   Close the terminal windows to stop all services.
echo.
echo ==================================
echo.
echo Opening browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo Press any key to close this window (services will keep running)
pause >nul
