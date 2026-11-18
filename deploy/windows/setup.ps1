# Sets up Kennko POS and the projector wall on the shop's Windows tablet.
# Run it by double-clicking setup.cmd. It is safe to run again, for example after updating the code.
#
# What it does:
#   1. installs the code's dependencies and builds the till screens
#   2. asks for the PINs the first time (saved in apps\pos\config.json, never in git)
#   3. lets the projector reach the tablet over the shop wifi (firewall, private network)
#   4. stops the tablet from sleeping while it is plugged in, so the till stays reachable
#   5. starts the till and the wall now, and again every time this Windows user signs in

param([string]$User = '')

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here '..\..')).Path

function Say($text) { Write-Host "  $text" }
function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Red; if ($isAdmin) { Read-Host '  Press Enter to close' | Out-Null }; exit 1 }

# ---------- run as administrator, but set things up for the person who double-clicked ----------
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $User) { $User = $me.Name }
if (-not $isAdmin) {
  Write-Host 'Windows will ask for permission to change the firewall and power settings.'
  $relaunch = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -User `"$User`""
  try { Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch -Wait } catch { Fail 'Setup needs administrator permission to continue.' }
  exit 0
}

Write-Host ''
Write-Host '  KENNKO SHOP SETUP' -ForegroundColor Yellow
Say "Code folder: $root"
Say "Starts for:  $User"

# ---------- 1. Node.js ----------
Step 'Checking Node.js'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int]((& node.exe -p 'process.versions.node.split(".")[0]').Trim()) }
if ($major -lt 24) {
  Say 'Node.js 24 or newer is needed. Installing it with winget...'
  & winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { Fail 'Node.js did not install. Install it from https://nodejs.org (LTS), then run setup again.' }
  $major = [int]((& node.exe -p 'process.versions.node.split(".")[0]').Trim())
  if ($major -lt 24) { Fail "Node.js $major is too old. Install the LTS from https://nodejs.org, then run setup again." }
}
Say "Node.js $(& node.exe -v)"

# ---------- stop a running till before rebuilding it ----------
foreach ($task in 'Kennko POS', 'Kennko Wall') {
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue }
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$root*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---------- 2. dependencies and build ----------
Step 'Installing and building (a few minutes the first time)'
Set-Location $root
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Say 'Clean install failed; trying a normal install.'; & npm.cmd install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Fail 'Installing the code''s dependencies failed. Check the internet connection and run setup again.' }
& npm.cmd run pos:build
if ($LASTEXITCODE -ne 0) { Fail 'Building the till screens failed. The messages above say why.' }

# ---------- 3. settings and PINs ----------
Step 'Till settings'
$config = Join-Path $root 'apps\pos\config.json'
if (Test-Path $config) {
  Say 'Keeping the existing apps\pos\config.json (PINs unchanged).'
} else {
  function Ask-Pin($label, $min) {
    while ($true) {
      $pin = (Read-Host "  $label ($min to 8 digits)").Trim()
      if ($pin -match "^\d{$min,8}$" -and $pin -notmatch '^(\d)\1+$' -and '0123456789' -notlike "*$pin*") { return $pin }
      Write-Host "  Use $min to 8 digits, not all the same and not 1234-style." -ForegroundColor Yellow
    }
  }
  $staff = Ask-Pin 'Staff PIN, to open the till on a device' 4
  do { $manager = Ask-Pin 'Manager PIN, for voids, cash out and closing the till' 6 } while ($manager -eq $staff)
  $backup = (Read-Host '  Second folder for the daily backup, e.g. a Google Drive or USB folder (Enter to skip)').Trim().Trim('"')

  $settings = Get-Content -Raw (Join-Path $root 'apps\pos\config.example.json') | ConvertFrom-Json
  $settings.staffPin = $staff
  $settings.managerPin = $manager
  $settings.backupDir = $backup
  # Written without a byte-order mark, which the till would otherwise reject.
  [IO.File]::WriteAllText($config, ($settings | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Say 'Saved apps\pos\config.json'
}

# ---------- 4. network ----------
Step 'Letting the projector reach this tablet'
Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' -and $_.NetworkCategory -eq 'Public' } | ForEach-Object {
  Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
  Say "Marked the network '$($_.Name)' as private (a trusted network, like home or the shop)."
}
Get-NetFirewallRule -Group 'Kennko' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Kennko POS and wall' -Group 'Kennko' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4466, 4443, 4455 -Profile Private | Out-Null
Say 'Firewall allows ports 4466 (till), 4443 (till, secure) and 4455 (wall) on private networks.'

# ---------- 5. power ----------
Step 'Keeping the tablet awake while plugged in'
& powercfg.exe /change standby-timeout-ac 0
& powercfg.exe /change hibernate-timeout-ac 0
& powercfg.exe /change monitor-timeout-ac 0
Say 'While charging it no longer sleeps or turns its screen off. Keep it plugged in during opening hours.'

# ---------- 6. start now and at every sign-in ----------
Step 'Starting the till and the wall'
$settingsSet = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
foreach ($app in 'pos', 'wall') {
  $name = if ($app -eq 'pos') { 'Kennko POS' } else { 'Kennko Wall' }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $here 'run.ps1')`" -App $app" -WorkingDirectory $root
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settingsSet -Force | Out-Null
  Start-ScheduledTask -TaskName $name
}

$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:4466/api/bootstrap' | Out-Null; $up = $true } catch { }
}
if (-not $up) { Fail "The till did not start. See $(Join-Path $root 'apps\pos\data\logs\pos.log')" }

# ---------- done ----------
# The address on the network with a router (the shop wifi), not a virtual adapter.
$ips = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress }
$ip = if ($ips) { @($ips)[0] } else { '<this tablet''s address>' }

Write-Host ''
Write-Host '  ALL SET' -ForegroundColor Green
Say 'The till and the wall now start by themselves whenever this Windows user signs in.'
Write-Host ''
Say 'On this tablet:'
Say '  Open Microsoft Edge at  http://localhost:4466/'
Say '  Tap "Install Kennko POS on this device" under the PIN pad. It then opens from the Start menu.'
Write-Host ''
Say 'On the Wanbo projector:'
Say "  Open its browser at  http://${ip}:4455/"
Say '  Press OK on the big button once to start the music and go full screen.'
Write-Host ''
Say "Other tablets or phones: open http://${ip}:4466/setup once on each."
Say "Logs: $(Join-Path $root 'apps\pos\data\logs')"
Write-Host ''
Read-Host '  Press Enter to close' | Out-Null
