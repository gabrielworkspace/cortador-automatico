@echo off
rem Garante o PATH basico do Windows - se ele vier quebrado, nada aqui funciona.
set "PATH=%SystemRoot%\system32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
chcp 65001 >nul 2>nul
title AUTOCORTES Z
cd /d "%~dp0"

echo.
echo   Iniciando o AUTOCORTES Z...
echo   A janela do programa abre sozinha em alguns segundos.
echo.
echo   NAO FECHE ESTA JANELA PRETA enquanto estiver usando.
echo.

rem Procura o Node: primeiro no PATH, depois nos lugares de sempre.
set "NODE="
node --version >nul 2>nul
if not errorlevel 1 set "NODE=node"

if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "NODE=%NVM_SYMLINK%\node.exe"
if not defined NODE if exist "%ProgramW6432%\nodejs\node.exe" set "NODE=%ProgramW6432%\nodejs\node.exe"
if not defined NODE goto semnode

rem O programa nao usa bibliotecas do npm: nao precisa de "npm install".

"%NODE%" src\server.js
goto fim

:semnode
echo   [ERRO] Nao encontrei o Node.js nesta maquina.
echo.
echo   Rode o  instalar.bat  (ele instala o Node.js junto) e depois
echo   abra este arquivo de novo.
echo   Ou instale a versao LTS em:  https://nodejs.org
echo.
echo   Acabou de instalar e ainda da esse erro? Reinicie o PC: o Windows
echo   as vezes so enxerga o Node depois de reiniciar.
echo.

:fim
echo.
echo   O programa foi encerrado.
pause
