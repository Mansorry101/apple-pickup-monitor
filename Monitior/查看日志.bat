@echo off
chcp 65001 >nul < nul
title 查看监控日志
cd /d "%~dp0"

if not exist monitor.log (
  echo.
  echo 还没有日志文件。
  echo.
  echo 可能的原因：
  echo   1. 程序尚未启动 —— 请先双击 一键部署.bat
  echo   2. 刚启动不久 —— 稍等一会儿再看
  echo.
  pause
  exit /b 0
)

echo.
echo 显示最近 40 行，并持续跟踪新日志。按 Ctrl+C 退出。
echo ==================================================
echo.
powershell -NoProfile -Command "Get-Content -Path 'monitor.log' -Encoding UTF8 -Tail 40 -Wait"
