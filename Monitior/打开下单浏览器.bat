@echo off
chcp 65001 >nul < nul
title Apple 取货监控 - 打开下单浏览器
cd /d "%~dp0"

rem 用专用的 Chrome 配置打开 Apple 购物袋：在里面登录 Apple 账户、把机型加进购物袋、装好扩展
node src\open-browser.js
if errorlevel 1 (
  echo.
  echo [错误] 下单浏览器没打开，请确认已安装 Node.js 和 Chrome。
  echo.
  pause
  exit /b 1
)
exit /b 0
