@echo off
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Programs\Git Credential Manager;%PATH%"

echo ========================================================
echo   Enviando o projeto para o GitHub:
echo   https://github.com/giancarlofrancozo/pizzamanager
echo ========================================================
echo.

git push -u origin main

if errorlevel 1 (
    echo.
    echo ========================================================
    echo Houve um erro ao enviar. Se pediu autenticacao, complete
    echo o login no navegador ou forneca o Token do GitHub.
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo   Sucesso! Projeto publicado no GitHub com sucesso!
    echo ========================================================
)
echo.
pause
