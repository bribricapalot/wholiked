@echo off
rem Brackets ships an old node.exe that shadows Node LTS on PATH — prefer the real one.
set "PATH=C:\Program Files\nodejs;%PATH%"
set "API_PORT=3001"
cd /d "%~dp0.."
npm run dev
