@echo off
cd /d "%~dp0"
title Safra - registros locais
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py
) else (
  python server.py
)
if errorlevel 1 pause
