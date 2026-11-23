@echo off
chcp 65001 >nul
title Instalador - AUTOCORTES Z
cd /d "%~dp0"

echo.
echo  ============================================================
echo    INSTALADOR DO AUTOCORTES Z
echo  ============================================================
echo.
echo   Isso instala o que o programa precisa pra funcionar:
echo     - Node.js        (o programa em si)
echo     - ffmpeg         (corta e monta os videos)
echo     - yt-dlp         (baixa os videos e as lives)
echo     - Python         (motor da transcricao)
echo     - Visual C++     (biblioteca do Windows que a transcricao usa)
echo     - o modelo que le a fala do video
echo.
echo   Pode demorar uns 10 minutos na primeira vez.
echo   Depois disso voce so usa o iniciar.bat.
echo.
pause

rem O winget vem no Windows 10/11 atualizado (app "Instalador de Aplicativo").
winget --version >nul 2>nul
if errorlevel 1 goto semwinget

echo.
echo  [1/8] Instalando o Node.js...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent

echo.
echo  [2/8] Instalando o ffmpeg...
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --silent

echo.
echo  [3/8] Instalando o baixador de videos (yt-dlp)...
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements --silent

echo.
echo  [4/8] Instalando o Visual C++ do Windows...
winget install --id Microsoft.VCRedist.2015+.x64 -e --accept-source-agreements --accept-package-agreements --silent

echo.
echo  [5/8] Instalando o Python 3.12...
winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements --silent --scope user

echo.
echo  [6/8] Procurando o Python 3.12...
rem A transcricao precisa do 3.12 (ou 3.11/3.10): no 3.13+ ainda faltam
rem pecas prontas do faster-whisper pra Windows.
set "PY="
for %%V in (312 311 310) do (
  if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
  if not defined PY if exist "%ProgramFiles%\Python%%V\python.exe" set "PY=%ProgramFiles%\Python%%V\python.exe"
  if not defined PY if exist "C:\Python%%V\python.exe" set "PY=C:\Python%%V\python.exe"
)
if not defined PY (
  py -3.12 -c "import sys; print(sys.executable)" > "%TEMP%\autocortes-py.txt" 2>nul
  if not errorlevel 1 set /p PY=<"%TEMP%\autocortes-py.txt"
)
if not defined PY goto sempython
echo        Achei: %PY%

echo.
echo  [7/8] Criando o Python do programa e instalando a transcricao...
rem Um Python so do programa, dentro desta pasta (pasta "ambiente"): assim
rem o faster-whisper nao se mistura com outro Python que o PC ja tenha.
if not exist "%~dp0ambiente\Scripts\python.exe" "%PY%" -m venv "%~dp0ambiente"
set "VPY=%~dp0ambiente\Scripts\python.exe"
if not exist "%VPY%" goto semvenv
"%VPY%" -m pip install --upgrade pip
rem Versoes fixas, as mesmas do instalador .exe: biblioteca nova as vezes
rem quebra a transcricao (o PyAV 19 quebrou o faster-whisper em nov/2026).
"%VPY%" -m pip install faster-whisper==1.2.1 av==18.1.0 ctranslate2==4.8.2
if errorlevel 1 goto sempip

echo.
echo        Testando a transcricao...
"%VPY%" -c "import faster_whisper; print('        faster-whisper OK')"
if errorlevel 1 goto semcarregar

echo.
echo  [8/8] Baixando o modelo de reconhecimento de fala...
"%VPY%" -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8', download_root=r'%~dp0modelos'); print('        modelo pronto')"

echo.
echo  ============================================================
echo    TUDO PRONTO!
echo.
echo    Feche esta janela e de dois cliques no arquivo  iniciar.bat
echo  ============================================================
echo.
pause
exit /b 0

:semwinget
echo.
echo  [ERRO] Nao achei o winget (o instalador de programas do Windows).
echo  Abra a Microsoft Store, procure "Instalador de Aplicativo" e atualize.
echo  Depois rode este instalar.bat de novo.
echo.
pause
exit /b 1

:sempython
echo.
echo  [ERRO] Nao achei o Python 3.12 depois de instalar.
echo  Feche esta janela, abra ela de novo e rode o instalar.bat mais uma vez.
echo  (O Windows as vezes so reconhece o Python numa janela nova.)
echo  Se continuar: instale o Python 3.12 pelo site python.org e rode de novo.
echo.
pause
exit /b 1

:semvenv
echo.
echo  [ERRO] Nao consegui criar o Python do programa na pasta "ambiente".
echo  Confira se a pasta do programa nao esta protegida (ex.: dentro de
echo  Arquivos de Programas) e rode o instalar.bat de novo.
echo.
pause
exit /b 1

:sempip
echo.
echo  [ERRO] A instalacao do faster-whisper falhou (veja a mensagem acima).
echo  Confira a internet e rode o instalar.bat de novo.
echo.
pause
exit /b 1

:semcarregar
echo.
echo  [ERRO] O faster-whisper instalou, mas nao abre neste PC.
echo  Quase sempre e o Visual C++ do Windows. Instale por este link
echo  e rode o instalar.bat de novo:
echo     https://aka.ms/vs/17/release/vc_redist.x64.exe
echo.
pause
exit /b 1
