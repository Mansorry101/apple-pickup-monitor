@echo off
chcp 65001 >nul < nul
title 重新配置邮箱
cd /d "%~dp0"

echo.
echo 重新配置收件邮箱 / 发件邮箱 / 授权码
echo 直接回车可以沿用原来的值。
echo.
node "src\setup.js"
echo.
echo 提示：配置改完后，监控程序会自动使用新配置；
echo       如果它正在后台运行，可双击 停止监控.bat 选 1 再选 2 让它重新加载。
echo.
pause
