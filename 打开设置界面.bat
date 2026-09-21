@echo off
chcp 65001 >nul < nul
title Apple 取货监控 - 设置界面
cd /d "%~dp0"

rem 读取配置里的端口（默认 8787）
set PORT=8787
for /f "delims=" %%p in ('node -e "try{const c=require('./config.json');console.log(c.uiPort||8787)}catch(e){console.log(8787)}" 2^>nul') do set PORT=%%p

rem 先看界面是否已经在运行
powershell -NoProfile -Command "try{ Invoke-WebRequest ('http://127.0.0.1:%PORT%/') -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul

if errorlevel 1 (
  echo.
  echo 设置界面未在运行，正在后台启动...
  echo.
  if not exist "node_modules" (
    echo [1/2] 首次使用，正在安装依赖...
    call npm install --no-audit --no-fund < nul
    echo.
  )
  echo [2/2] 启动设置界面...
  start "" wscript.exe "scripts\open-ui.vbs"
  echo      等待服务就绪...
  powershell -NoProfile -Command "$u='http://127.0.0.1:%PORT%/'; for($i=0;$i -lt 30;$i++){ try{ Invoke-WebRequest $u -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 }catch{ Start-Sleep -Milliseconds 700 } }; exit 1"
  if errorlevel 1 (
    echo.
    echo [错误] 设置界面启动失败。
    echo        请先确认已安装 Node.js，然后重新双击本文件。
    echo.
    pause
    exit /b 1
  )
)

echo 正在打开浏览器:  http://127.0.0.1:%PORT%/
start "" "http://127.0.0.1:%PORT%/"
exit /b 0
