@echo off
rem Double-click on Windows to start the wall.
cd /d "%~dp0"
node server.mjs %*
if errorlevel 1 pause
