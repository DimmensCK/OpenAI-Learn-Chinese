@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
set "LEARN_ENTRY=%~dp0学习资料\index.html"
if not exist "%LEARN_ENTRY%" (
    echo 找不到学习网站。请先完整解压，再双击“开始学习.cmd”。
    echo 请保留“开始学习.cmd”和“学习资料”文件夹的相对位置。
    pause
    exit /b 1
)
start "" "%LEARN_ENTRY%"
if errorlevel 1 (
    echo 无法打开默认浏览器。请进入“学习资料”文件夹，双击 index.html。
    pause
    exit /b 2
)
exit /b 0
