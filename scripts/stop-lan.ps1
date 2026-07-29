$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\lan-server.pid"
$scheduledTask = Get-ScheduledTask -TaskName "SearchOps Hub LAN" -ErrorAction SilentlyContinue

if ($scheduledTask -and $scheduledTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName "SearchOps Hub LAN"
  Write-Output "SearchOps Hub Windows boot task stopped."
}

if (-not (Test-Path -LiteralPath $pidFile)) {
  if (-not $scheduledTask) {
    Write-Output "SearchOps Hub is not running."
  }
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
if ($process -and $process.CommandLine -match "src[/\\]server\.js") {
  Stop-Process -Id $serverPid -Force
  Write-Output "SearchOps Hub stopped (PID $serverPid)."
} else {
  Write-Output "The saved PID does not belong to SearchOps Hub; no process was stopped."
}
Remove-Item -LiteralPath $pidFile -Force
