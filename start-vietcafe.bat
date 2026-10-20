@echo off
REM Starts the VietCafe pipeline app on http://localhost:4999 -- the Windows
REM counterpart of `make sleeppiano` for the cafe-with-vocals sibling pipeline.
REM %~dp0 is this file's own folder, so the shortcut works from anywhere.
cd /d "%~dp0vietcafe"
if not exist node_modules (
    echo Installing VietCafe dependencies...
    call npm install
    call npx playwright install chromium
)
echo Starting VietCafe on http://localhost:4999 ...
REM npm start blocks, so open the UI from a side process once the server has booted.
start "" /min cmd /c "timeout /t 8 >nul && start http://localhost:4999"
npm start
