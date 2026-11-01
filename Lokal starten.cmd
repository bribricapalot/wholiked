@echo off
title WhoGooned Server
cd /d "%~dp0"
rem Brackets ships an old node.exe that shadows Node LTS on PATH, so prefer the real one.
set "PATH=C:\Program Files\nodejs;%PATH%"
set "URL=http://localhost:5173"

rem Already running (e.g. via the Claude preview)? Then just open the browser.
rem Vite may listen on IPv6 only (::1), so probe both loopback addresses.
powershell -NoProfile -Command "foreach ($h in '127.0.0.1', '::1') { try { (New-Object Net.Sockets.TcpClient($h, 5173)).Close(); exit 0 } catch {} }; exit 1"
if not errorlevel 1 (
  echo Server laeuft schon - oeffne %URL%
  start "" %URL%
  timeout /t 3 >nul
  exit /b
)

if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install || (pause & exit /b 1)
)

rem Open the browser as soon as the server answers.
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 180; $i++) { foreach ($h in '127.0.0.1', '::1') { try { (New-Object Net.Sockets.TcpClient($h, 5173)).Close(); Start-Process '%URL%'; exit } catch {} }; Start-Sleep -Milliseconds 500 }"

echo Starte WhoGooned auf %URL% - Fenster offen lassen, Strg+C beendet den Server.
call npm run dev
pause
