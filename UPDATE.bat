@echo off
rem Double-click to build new Zyne installers (laptop + phone).
rem Options: UPDATE.bat -Only desktop   /   UPDATE.bat -Only phone   /   UPDATE.bat -NoBump
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
