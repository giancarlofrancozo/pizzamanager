@echo off
setlocal
cd /d "%~dp0"

set "RUNTIME=%~dp0runtime"
set "NODE_DIR=%RUNTIME%\node-v18.20.4-win-x64"

if exist "%NODE_DIR%\node.exe" goto have_node

echo Baixando Node.js 18 portatil...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.20.4/node-v18.20.4-win-x64.zip' -OutFile '%TEMP%\node18.zip'"
if errorlevel 1 goto err_download

echo Extraindo...
powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\node18.zip' -DestinationPath '%RUNTIME%' -Force"
if errorlevel 1 goto err_extract

:have_node
set "PATH=%NODE_DIR%;%PATH%"
echo Node em uso:
node -v

if exist "node_modules\sqlite3\build\Release\node_sqlite3.node" goto start_server
if exist "node_modules\sqlite3\lib\binding" goto start_server

echo Reinstalando dependencias...
if exist node_modules rmdir /s /q node_modules
call npm install
if errorlevel 1 goto err_npm

:start_server
echo Iniciando servidor em http://localhost:3000
node server.js
pause
exit /b 0

:err_download
echo ERRO: falha no download do Node.
pause
exit /b 1

:err_extract
echo ERRO: falha ao extrair o Node.
pause
exit /b 1

:err_npm
echo ERRO: falha no npm install.
pause
exit /b 1
