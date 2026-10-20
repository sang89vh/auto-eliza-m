@echo off
REM Starts the SleepPiano pipeline app on http://localhost:3999 -- the Windows
REM counterpart of `make sleeppiano` (GNU make is not installed on this machine).
REM %~dp0 is this file's own folder, so the shortcut works from anywhere.
cd /d "%~dp0sleeppiano"
if not exist node_modules (
    echo Installing SleepPiano dependencies...
    call npm install
    call npx playwright install chromium
)
echo Starting SleepPiano on http://localhost:3999 ...
REM npm start blocks, so open the UI from a side process once the server has booted.
start "" /min cmd /c "timeout /t 8 >nul && start http://localhost:3999"
npm start
