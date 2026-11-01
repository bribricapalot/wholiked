# Starts the dev server (if it isn't running yet) and opens a Cloudflare quick tunnel to it,
# so friends can join over the internet. No Cloudflare account needed.
# Launched by "Tunnel starten.cmd" in the project root.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$port = 5173
Set-Location $root
# Brackets ships an old node.exe that shadows Node LTS on PATH, so prefer the real one.
$env:Path = "C:\Program Files\nodejs;$env:Path"

function Test-Port {
  # Vite may listen on IPv6 only (::1), so probe both loopback addresses.
  foreach ($h in '127.0.0.1', '::1') {
    try { (New-Object Net.Sockets.TcpClient($h, $port)).Close(); return $true } catch {}
  }
  return $false
}

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

# 1. cloudflared
$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
  Write-Host 'cloudflared fehlt - wird einmalig ueber winget installiert ...' -ForegroundColor Yellow
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $cloudflared = Find-Cloudflared
  if (-not $cloudflared) { throw 'cloudflared konnte nicht installiert werden. Manuell: winget install Cloudflare.cloudflared' }
}

# 2. Dev server
if (Test-Port) {
  Write-Host "Server laeuft schon auf Port $port." -ForegroundColor Green
} else {
  if (-not (Test-Path node_modules)) {
    Write-Host 'Installiere Abhaengigkeiten ...' -ForegroundColor Yellow
    npm install
  }
  Write-Host 'Starte Server in eigenem Fenster ...' -ForegroundColor Yellow
  Start-Process cmd.exe -ArgumentList '/k', "title WhoGooned Server && cd /d `"$root`" && npm run dev"
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Port)) {
    if ((Get-Date) -gt $deadline) { throw "Server ist nach 90 s nicht auf Port $port erreichbar - schau ins Server-Fenster." }
    Start-Sleep -Milliseconds 500
  }
}

# 3. Tunnel
$log = Join-Path $env:TEMP 'whogooned-tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
Write-Host 'Oeffne Cloudflare-Tunnel ...' -ForegroundColor Yellow
$tunnel = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://localhost:$port", '--logfile', $log -NoNewWindow -PassThru

$url = $null
$deadline = (Get-Date).AddSeconds(60)
while (-not $url) {
  if ($tunnel.HasExited) { throw "cloudflared wurde beendet. Log: $log" }
  if ((Get-Date) -gt $deadline) { throw "Keine Tunnel-Adresse nach 60 s. Log: $log" }
  Start-Sleep -Milliseconds 500
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}

Set-Clipboard $url
Write-Host ''
Write-Host '  ==========================================================' -ForegroundColor Cyan
Write-Host "   Link fuer deine Freunde:  $url" -ForegroundColor Cyan
Write-Host '   (ist schon in der Zwischenablage)' -ForegroundColor Cyan
Write-Host '  ==========================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Fenster offen lassen, solange ihr spielt. Strg+C oder Fenster schliessen beendet den Tunnel.'
Start-Sleep -Seconds 3 # the hostname needs a moment before it resolves everywhere
Start-Process $url
$tunnel.WaitForExit()
