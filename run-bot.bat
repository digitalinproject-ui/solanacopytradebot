@echo off
echo ====================================
echo    SOLANA COPY-TRADE BOT MANAGER
echo ====================================
echo 1. Start Bot (Background)
echo 2. Lihat Log / Aktivitas Bot
echo 3. Stop Bot
echo 4. Cek Status Bot
echo 5. Keluar
echo ====================================
set /p opt="Pilih menu (1-5): "

if "%opt%"=="1" (
    & "C:\Users\zoomd\AppData\Roaming\npm\pm2.cmd" start "C:\Users\zoomd\solana-copytrade-bot\index.js" --name "solana-bot"
    pause
)
if "%opt%"=="2" (
    & "C:\Users\zoomd\AppData\Roaming\npm\pm2.cmd" logs solana-bot
)
if "%opt%"=="3" (
    & "C:\Users\zoomd\AppData\Roaming\npm\pm2.cmd" stop solana-bot
    pause
)
if "%opt%"=="4" (
    & "C:\Users\zoomd\AppData\Roaming\npm\pm2.cmd" status
    pause
)
