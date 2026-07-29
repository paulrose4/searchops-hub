$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.lan"
$dataDir = Join-Path $root "data"
$pidFile = Join-Path $dataDir "lan-server.pid"

if (-not (Test-Path -LiteralPath $envFile)) {
  & node (Join-Path $PSScriptRoot "setup-lan.js")
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
if (Test-Path -LiteralPath $pidFile) {
  $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
    Write-Output "SearchOps Hub is already running (PID $existingPid)."
    exit 0
  }
}

$stdout = Join-Path $dataDir "lan-server.out.log"
$stderr = Join-Path $dataDir "lan-server.err.log"
$process = Start-Process -FilePath "node" `
  -ArgumentList "--env-file=.env.lan", "src/server.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id

$baseUrl = (Get-Content -LiteralPath $envFile | Where-Object { $_ -like "APP_BASE_URL=*" }) -replace "^APP_BASE_URL=", ""
$port = (Get-Content -LiteralPath $envFile | Where-Object { $_ -like "PORT=*" }) -replace "^PORT=", ""
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $health = & curl.exe --noproxy "*" --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/health"
    if ($LASTEXITCODE -eq 0 -and $health -match '"status":"ok"') {
      Write-Output "SearchOps Hub is running: $baseUrl"
      Write-Output "PID: $($process.Id)"
      exit 0
    }
  } catch {}
  if ($process.HasExited) { break }
}

Write-Error "LAN service failed to start. Check $stderr"
