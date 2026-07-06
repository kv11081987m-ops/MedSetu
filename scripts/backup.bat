@echo off
REM Double-click this file to run a backup — see scripts\backup.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1"
echo.
pause
