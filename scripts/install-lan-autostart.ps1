$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "SearchOps Hub LAN"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot "run-lan-task.ps1"
$envFile = Join-Path $root ".env.lan"
$startupDirectory = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDirectory "SearchOps Hub LAN.cmd"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this command from an Administrator PowerShell window."
}
if (-not (Test-Path -LiteralPath $envFile)) {
  & $nodePath (Join-Path $PSScriptRoot "setup-lan.js")
}

if (Test-Path -LiteralPath $startupFile) {
  Remove-Item -LiteralPath $startupFile -Force
}

$pidFile = Join-Path $root "data\lan-server.pid"
if (Test-Path -LiteralPath $pidFile) {
  $manualPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  $manualProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $manualPid" -ErrorAction SilentlyContinue
  if ($manualProcess -and $manualProcess.CommandLine -match "src[/\\]server\.js") {
    Stop-Process -Id $manualPid -Force
  }
  Remove-Item -LiteralPath $pidFile -Force
}

$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -NodePath `"$nodePath`""
$action = New-ScheduledTaskAction `
  -Execute $powerShellPath `
  -Argument $arguments `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $taskPrincipal `
  -Description "Starts SearchOps Hub for office LAN access at Windows boot." `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$baseUrl = (Get-Content -LiteralPath $envFile | Where-Object { $_ -like "APP_BASE_URL=*" }) -replace "^APP_BASE_URL=", ""
$port = (Get-Content -LiteralPath $envFile | Where-Object { $_ -like "PORT=*" }) -replace "^PORT=", ""
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  $health = & curl.exe --noproxy "*" --fail --silent --max-time 2 "http://127.0.0.1:$port/health" 2>$null
  if ($LASTEXITCODE -eq 0 -and $health -match '"status":"ok"') {
    Write-Output "SearchOps Hub now starts at Windows boot: $baseUrl"
    exit 0
  }
}
throw "The boot task was installed but the service did not become healthy."
