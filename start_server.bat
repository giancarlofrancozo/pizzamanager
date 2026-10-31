@echo off
rem Change to the script directory
cd /d "%~dp0"

echo Starting Pizza Manager server...

rem Ensure dependencies are installed (quiet mode)
npm install --silent

rem Start the Node server
node server.js

rem Keep the console open after exit
pause
