@echo off
REM Double-click to restore the LATEST backup in backups\ — see scripts\backup.md
REM For a specific file, run restore.ps1 directly with -BackupFile instead.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore.ps1"
echo.
pause
