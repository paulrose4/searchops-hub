$ErrorActionPreference = "Stop"
$ruleName = "SearchOps Hub LAN 3210"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3210 `
    -RemoteAddress LocalSubnet `
    -Profile Any | Out-Null
} else {
  Set-NetFirewallRule `
    -DisplayName $ruleName `
    -Enabled True `
    -Direction Inbound `
    -Action Allow `
    -Profile Any | Out-Null
  Get-NetFirewallRule -DisplayName $ruleName |
    Get-NetFirewallAddressFilter |
    Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet | Out-Null
  Get-NetFirewallRule -DisplayName $ruleName |
    Get-NetFirewallPortFilter |
    Set-NetFirewallPortFilter -Protocol TCP -LocalPort 3210 | Out-Null
}
Write-Output "Windows Firewall allows TCP 3210 from the local subnet only."
