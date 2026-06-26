@echo off
chcp 65001 >nul 2>&1
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0clash_rules_manager.ps1"