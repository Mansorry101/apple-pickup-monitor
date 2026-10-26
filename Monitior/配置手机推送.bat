@echo off
chcp 65001 >nul < nul
title 配置手机推送（Bark）
cd /d "%~dp0"

echo.
echo 配置 iPhone 手机推送（Bark）：有货时 1~2 秒弹到手机，点开直接去下单。
echo 邮件通知照常保留。
echo.
node "src\push-setup.js"
if errorlevel 1 (
  echo.
  echo 推送没有配置成功，邮件通知不受影响。
  echo.
  pause
  exit /b 1
)
echo.
echo 正在重启后台监控，让推送设置生效...
schtasks /End /TN ApplePickupMonitor >nul 2>nul
timeout /t 2 >nul
schtasks /Run /TN ApplePickupMonitor >nul 2>nul
if errorlevel 1 (
  echo 没找到后台任务。请先双击 一键部署.bat 完成部署。
) else (
  echo 已重启。打开 查看日志.bat 能看到「手机推送已开启」。
)
echo.
pause
