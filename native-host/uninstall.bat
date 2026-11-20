@echo off
REM ClashOmega - Native Host Uninstaller / 卸载脚本
REM v1.4.9: 新增（原 uninstall.ps1 注释引导双击此文件，但文件缺失 → 卸载链路断裂）
echo ========================================
echo   ClashOmega - Native Host Uninstaller
echo   ClashOmega - Native Host 卸载程序
echo ========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
