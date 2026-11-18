@echo off
rem Double-click to set up Kennko POS and the wall on this Windows tablet. Safe to run again after an update.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
