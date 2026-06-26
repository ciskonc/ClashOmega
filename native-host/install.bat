@echo off
chcp 65001 >nul 2>&1
REM ClashOmega Native Host Installer - BAT wrapper
REM 双击此文件运行安装，自动绕过 PowerShell 执行策略限制

set "SCRIPT_DIR=%~dp0"
set "PS1_FILE=%SCRIPT_DIR%install.ps1"

REM Check if PowerShell exists
where powershell.exe >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PowerShell not found / 未找到 PowerShell
    echo Please install Windows PowerShell / 请安装 Windows PowerShell
    pause
    exit /b 1
)

REM Check if install.ps1 exists
if not exist "%PS1_FILE%" (
    echo [ERROR] install.ps1 not found / 未找到 install.ps1
    echo Path: %PS1_FILE%
    pause
    exit /b 1
)

REM Run PowerShell with ExecutionPolicy Bypass
REM -ExecutionPolicy Bypass: bypass any execution policy restrictions
REM -NoProfile: skip loading user profile (faster, avoids profile errors)
REM -File: run the script file
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%PS1_FILE%" %*

REM If PowerShell failed to start (e.g. execution policy still blocks)
if %ERRORLEVEL% neq 0 (
    echo.
    echo ========================================
    echo [ERROR] PowerShell execution failed (code: %ERRORLEVEL%)
    echo [错误] PowerShell 执行失败 (代码: %ERRORLEVEL%)
    echo.
    echo Possible causes / 可能的原因:
    echo   1. System policy blocks PowerShell scripts
    echo      系统策略阻止了 PowerShell 脚本
    echo   2. PowerShell is not installed or corrupted
    echo      PowerShell 未安装或已损坏
    echo.
    echo Try manually running / 尝试手动运行:
    echo   powershell.exe -ExecutionPolicy Bypass -File "%PS1_FILE%"
    echo ========================================
    pause
)

