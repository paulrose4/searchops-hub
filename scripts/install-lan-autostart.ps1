$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startupDirectory = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDirectory "SearchOps Hub LAN.cmd"
$startScript = Join-Path $PSScriptRoot "start-lan.ps1"
$content = @(
  "@echo off",
  "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
)
Set-Content -LiteralPath $startupFile -Value $content -Encoding Ascii
Write-Output "SearchOps Hub will start after this Windows user signs in."
Write-Output "Startup entry: $startupFile"
