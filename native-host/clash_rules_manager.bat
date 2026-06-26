@echo off
chcp 65001 >nul 2>&1
REM ClashOmega Native Messaging Host entry point (called by Chrome)
REM Chrome Native Messaging requires a native executable; .ps1 is not supported
REM This bat launches PowerShell to run the actual logic in clash_rules_manager.ps1
REM Do NOT delete this file — Chrome depends on it via com.clash.omega.json path

set "SCRIPT_DIR=%~dp0"
set "PS1_FILE=%SCRIPT_DIR%clash_rules_manager.ps1"

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%PS1_FILE%" %*
