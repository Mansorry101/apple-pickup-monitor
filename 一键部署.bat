@echo off
chcp 65001 >nul < nul
title Apple 取货监控 - 一键部署
cd /d "%~dp0"

echo.
echo ==================================================
echo    Apple 取货监控 - 一键部署
echo    监控 iPhone 18 Pro Max 512GB 银/黑 @ 广东道
echo    后台静默运行，有货时邮件通知
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js
  echo.
  echo 请先安装 Node.js LTS，一路点下一步即可：
  echo     https://nodejs.org
  echo.
  echo 安装完成后重新双击本文件。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [环境] Node.js %%v 已就绪
echo.

echo [1/3] 安装依赖...
rem 末尾的 < nul 很重要：否则 npm 会吞掉后续输入，导致配置向导读不到内容
call npm install --no-audit --no-fund < nul
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)
echo.

echo [2/3] 配置邮箱...
if exist ".env" goto :already_configured
echo     首次部署，需要输入一次邮箱信息。
echo.
node "src\setup.js"
if errorlevel 1 (
  echo.
  echo [错误] 邮箱配置未完成，已中止。
  pause
  exit /b 1
)
goto :after_config

:already_configured
echo     已配置过，跳过。
echo     如需修改，请双击 重新配置邮箱.bat

:after_config
echo.
echo [3/3] 注册后台任务...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-windows-task.ps1"
if errorlevel 1 (
  echo.
  echo [错误] 后台任务注册失败。
  pause
  exit /b 1
)

echo.
echo ==================================================
echo    部署完成，程序已在后台静默运行
echo.
echo    有货时会自动发邮件通知你。
echo    查看运行情况：双击 查看日志.bat
echo    停止监控    ：双击 停止监控.bat
echo ==================================================
echo.
pause
