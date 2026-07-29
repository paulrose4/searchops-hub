$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\lan-server.pid"

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Output "SearchOps Hub is not running."
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
