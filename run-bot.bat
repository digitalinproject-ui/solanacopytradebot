@echo off
title ANUBIS MULTI-CHAIN TERMINAL v2.0
color 0A

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js tidak ditemukan! Install Node.js terlebih dahulu.
    echo Download: https://nodejs.org
    pause
    exit /b 1
)

:menu
cls
echo ========================================================
echo          ANUBIS MULTI-CHAIN TERMINAL v2.0
echo   Solana + Base + BSC + Ethereum Copy Trade ^& Sniper
echo ========================================================
echo.
echo [1] Start Bot
echo [2] Start Bot (PM2 Background)
echo [3] Stop PM2 Bot
echo [4] PM2 Status ^& Logs
echo [5] Install Dependencies (npm install)
echo [6] Exit
echo.
set /p choice="Pilih menu (1-6): "

if "%choice%"=="1" goto run_normal
if "%choice%"=="2" goto run_pm2
if "%choice%"=="3" goto stop_pm2
if "%choice%"=="4" goto logs_pm2
if "%choice%"=="5" goto install_npm
if "%choice%"=="6" exit
echo.
echo Input tidak valid! Silakan pilih 1-6.
pause
goto menu

:run_normal
cls
echo Starting Anubis Multi-Chain Bot...
echo.
node index.js
pause
goto menu

:run_pm2
cls
echo Starting Bot via PM2...
npx pm2 start index.js --name "anubis-bot"
echo.
echo Bot berjalan di background!
pause
goto menu

:stop_pm2
cls
echo Stopping PM2 Bot...
npx pm2 stop anubis-bot 2>nul
npx pm2 delete anubis-bot 2>nul
echo.
echo Bot dihentikan!
pause
goto menu

:logs_pm2
cls
npx pm2 status
echo.
npx pm2 logs anubis-bot --lines 50
pause
goto menu

:install_npm
cls
echo Installing dependencies...
npm install
echo.
echo Selesai!
pause
goto menu
