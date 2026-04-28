@echo off
REM ACE-Step UI Setup Script for Windows
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..\..") do set "PINOKIO_HOME=%%~fI"
if exist "%PINOKIO_HOME%\bin\miniconda\node.exe" (
    set "PATH=%PINOKIO_HOME%\bin\miniconda;%PATH%"
    echo [+] Using Pinokio Node.js from %PINOKIO_HOME%\bin\miniconda
)

echo ==================================
echo   ACE-Step UI Setup (Windows)
echo ==================================
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Node.js not found!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

REM Show Node version
for /f "tokens=*" %%i in ('node --version') do echo Node.js version: %%i

set "NPM_CACHE_DIR=%SCRIPT_DIR%\.npm-cache"
set "SERVER_NPM_CACHE_DIR=%SCRIPT_DIR%\server\.npm-cache"
if not exist "%NPM_CACHE_DIR%" mkdir "%NPM_CACHE_DIR%" >nul 2>&1
if not exist "%SERVER_NPM_CACHE_DIR%" mkdir "%SERVER_NPM_CACHE_DIR%" >nul 2>&1

REM Install frontend dependencies
echo.
echo Installing frontend dependencies...
echo Using npm cache: %NPM_CACHE_DIR%
call npm install --cache "%NPM_CACHE_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo Error: Failed to install frontend dependencies
    pause
    exit /b 1
)

REM Install server dependencies
echo.
echo Installing server dependencies...
cd server
echo Using npm cache: %SERVER_NPM_CACHE_DIR%
call npm install --cache "%SERVER_NPM_CACHE_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo Error: Failed to install server dependencies
    cd ..
    pause
    exit /b 1
)
echo Verifying better-sqlite3 native binding...
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); console.log('better-sqlite3 OK');"
if %ERRORLEVEL% NEQ 0 (
    echo Attempting to rebuild better-sqlite3 with local npm cache...
    call npm rebuild better-sqlite3 --cache "%SERVER_NPM_CACHE_DIR%"
    if %ERRORLEVEL% NEQ 0 (
        echo Error: Failed to rebuild better-sqlite3.
        echo Hint: if this machine cannot download a prebuilt binary, install Visual Studio with the "Desktop development with C++" workload and rerun setup.bat.
        cd ..
        pause
        exit /b 1
    )
    node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); console.log('better-sqlite3 OK');"
    if %ERRORLEVEL% NEQ 0 (
        echo Error: better-sqlite3 is still unavailable after rebuild.
        cd ..
        pause
        exit /b 1
    )
)
cd ..

REM Create server .env if it doesn't exist
if not exist "server\.env" (
    echo.
    echo Creating server\.env from example...
    copy server\.env.example server\.env
)

REM Create data directory
if not exist "server\data" (
    mkdir server\data
)

echo.
echo ==================================
echo   Setup Complete!
echo ==================================
echo.
echo Next steps:
echo.
echo   1. Start ACE-Step Gradio + API (in ACE-Step folder):
echo      cd path\to\ACE-Step
echo      set MASTER_ADDR=127.0.0.1
echo      set VLLM_HOST_IP=127.0.0.1
echo      set ACESTEP_LM_BACKEND=pt
echo      set ACESTEP_LM_OFFLOAD_TO_CPU=true
echo      env\Scripts\acestep.exe --port 8001 --enable-api --backend pt --server-name 127.0.0.1
echo.
echo   2. Start ACE-Step UI:
echo      start.bat
echo.
echo   3. Open http://localhost:3000
echo.
pause
