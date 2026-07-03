@echo off
REM ClashOmega Native Host Installer - BAT wrapper
REM Double-click this file to run the installer.
REM This wrapper bypasses PowerShell execution policy for the current run only.

set "SCRIPT_DIR=%~dp0"
set "PS1_FILE=%SCRIPT_DIR%install.ps1"

REM Check if PowerShell exists
where powershell.exe >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PowerShell not found.
    echo Please install Windows PowerShell.
    pause
    exit /b 1
)

REM Check if install.ps1 exists
if not exist "%PS1_FILE%" (
    echo [ERROR] install.ps1 not found.
    echo Expected path: %PS1_FILE%
    pause
    exit /b 1
)

REM Run PowerShell with ExecutionPolicy Bypass
REM -ExecutionPolicy Bypass: bypass any execution policy restrictions for this run only
REM -NoProfile: skip loading user profile (faster, avoids profile errors)
REM -File: run the script file
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%PS1_FILE%" %*

REM If PowerShell failed to start (e.g. execution policy still blocks)
if %ERRORLEVEL% neq 0 (
    echo.
    echo ========================================
    echo [ERROR] PowerShell execution failed (code: %ERRORLEVEL%)
    echo.
    echo Possible causes:
    echo   1. System policy blocks PowerShell scripts.
    echo   2. PowerShell is not installed or corrupted.
    echo.
    echo Try manually running:
    echo   powershell.exe -ExecutionPolicy Bypass -File "%PS1_FILE%"
    echo ========================================
    pause
)
