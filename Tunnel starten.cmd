@echo off
title WhoGooned Tunnel
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tunnel.ps1"
if errorlevel 1 pause
