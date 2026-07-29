param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.lan"
$dataDir = Join-Path $root "data"
$stdout = Join-Path $dataDir "lan-server.out.log"
$stderr = Join-Path $dataDir "lan-server.err.log"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw ".env.lan is missing. Run npm run lan:setup first."
}
if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Node.js was not found at $NodePath"
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
Set-Location $root
& $NodePath --env-file=.env.lan src/server.js 1>> $stdout 2>> $stderr
exit $LASTEXITCODE
