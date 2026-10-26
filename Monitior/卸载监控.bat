@echo off
chcp 65001 >nul < nul
title 卸载监控
cd /d "%~dp0"

echo.
echo 这将停止并移除后台监控任务。
echo.
set /p confirm=确定要卸载吗？输入 y 回车确认: 
if /i not "%confirm%"=="y" (
  echo 已取消。
  timeout /t 2 >nul
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-windows-task.ps1" -Uninstall

echo.
echo 提示：邮箱配置 .env 和日志 monitor.log 仍保留在本目录，
echo       如需彻底清理可手动删除。
echo.
pause
