# Keeps one Kennko program running: started at sign-in by Windows Task Scheduler (see setup.ps1),
# and started again five seconds after it stops for any reason.
param([Parameter(Mandatory = $true)][ValidateSet('pos', 'wall')][string]$App)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logs = Join-Path $root 'apps\pos\data\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs "$App.log"

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { Add-Content -Path $log -Value "$(Get-Date -Format s)  npm was not found. Install Node.js and run setup again."; exit 1 }

Set-Location $root
while ($true) {
  # Keep the log small: start a fresh one past 5 MB, keeping the previous as .old
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item -Force $log "$log.old" }
  Add-Content -Path $log -Value "$(Get-Date -Format s)  starting"
  if ($App -eq 'pos') {
    & $npm run pos:start *>> $log
  } else {
    & $npm run wall:pos -- --no-open *>> $log
  }
  Add-Content -Path $log -Value "$(Get-Date -Format s)  stopped (exit $LASTEXITCODE), starting again in 5 seconds"
  Start-Sleep -Seconds 5
}
