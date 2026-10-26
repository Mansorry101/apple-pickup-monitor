@echo off
chcp 65001 >nul < nul
title 停止 / 启动监控
cd /d "%~dp0"

echo.
echo 当前状态：
schtasks /Query /TN ApplePickupMonitor 2>nul | findstr /i "ApplePickupMonitor"
echo.
echo   1 = 停止监控
echo   2 = 启动监控
echo   3 = 立即查看一次库存
echo   0 = 退出
echo.
set /p choice=请输入数字后回车: 

if "%choice%"=="1" goto :stop
if "%choice%"=="2" goto :start
if "%choice%"=="3" goto :once

echo 已退出。
timeout /t 2 >nul
exit /b 0

:stop
schtasks /End /TN ApplePickupMonitor >nul 2>nul
echo.
echo 已停止。要恢复请重新运行本脚本选 2，或重启电脑。
echo.
pause
exit /b 0

:start
schtasks /Run /TN ApplePickupMonitor >nul 2>nul
echo.
echo 已启动，后台静默运行中。
echo.
pause
exit /b 0

:once
echo.
node "src\index.js" --once
echo.
pause
exit /b 0
