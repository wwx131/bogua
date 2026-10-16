@echo off
chcp 65001 >nul
title 手机访问服务 - 周易卜卦
cd /d "%~dp0"

set PORT=8080
set PY=

where python >nul 2>nul && set PY=python
if "%PY%"=="" ( where py >nul 2>nul && set PY=py )

echo.
echo   ============================================
echo     周易卜卦 · 手机访问服务
echo   ============================================
echo.

if "%PY%"=="" (
  echo   [!] 没有找到 Python，无法启动。
  echo       请安装 Python，或改用其它方式托管本文件。
  echo.
  pause
  exit /b 1
)

echo   正在获取本机局域网地址...
for /f "usebackq delims=" %%i in (`%PY% -c "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.connect(('8.8.8.8',80));print(s.getsockname()[0])"`) do set IP=%%i
if "%IP%"=="" set IP=127.0.0.1

echo.
echo   请在手机浏览器（连同一个 Wi-Fi）打开：
echo.
echo        http://%IP%:%PORT%/
echo.
echo   电脑上也可以打开同样地址预览。
echo   本窗口保持开启，按 Ctrl+C 停止服务。
echo.

start "" "http://%IP%:%PORT%/"
%PY% -m http.server %PORT% --bind 0.0.0.0
pause
