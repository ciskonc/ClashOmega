@echo off
chcp 65001 >nul 2>&1
set "SCRIPT_DIR=%~dp0"
set "PS1_FILE=%SCRIPT_DIR%uninstall.ps1"
where powershell.exe >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PowerShell not found
    pause
    exit /b 1
)
if not exist "%PS1_FILE%" (
    echo [ERROR] uninstall.ps1 not found
    pause
    exit /b 1
)
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%PS1_FILE%" %*
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PowerShell execution failed (code: %ERRORLEVEL%)
    echo Try manually running:
    echo   powershell.exe -ExecutionPolicy Bypass -File "%PS1_FILE%"
    pause
)
