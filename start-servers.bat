@echo off
cd /d %USERPROFILE%\code\auto-eliza-m
start cmd /k "npm run server"
echo Starting frontend server...
timeout /t 5
start cmd /k "npm start" 