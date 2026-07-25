<#
.SYNOPSIS
  Log a saved ShiftlyCal food in one command. Built for a Stream Deck key or a
  Jarvis voice command, so logging costs a keypress instead of a form.

.EXAMPLE
  .\cal-log.ps1 harissa
  .\cal-log.ps1 "Longhorn Steak Plate" -Servings 0.5
  .\cal-log.ps1 -List

.NOTES
  Reads SHIFTLYCASH_LEDGER_TOKEN and optional SHIFTLYCASH_API_BASE the same way
  tools/shiftlycal_sync.py does: Documents\Nutrition\.env, then
  Documents\Investing\.env, then the process environment.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Food,
  [double]$Servings = 1,
  [string]$Date,
  [string]$Time,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

function Read-EnvFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content $Path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
    $k, $v = $t -split '=', 2
    $map[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
  }
  return $map
}

$envValues = @{}
foreach ($p in @(
    (Join-Path $HOME 'Documents\Nutrition\.env'),
    (Join-Path $HOME 'Documents\Investing\.env')
  )) {
  foreach ($kv in (Read-EnvFile $p).GetEnumerator()) { $envValues[$kv.Key] = $kv.Value }
}

$token = if ($env:SHIFTLYCASH_LEDGER_TOKEN) { $env:SHIFTLYCASH_LEDGER_TOKEN } else { $envValues['SHIFTLYCASH_LEDGER_TOKEN'] }
if (-not $token) {
  Write-Error "SHIFTLYCASH_LEDGER_TOKEN not found. Put it in Documents\Nutrition\.env or Documents\Investing\.env, or set it in the environment."
  exit 1
}

$apiBase = if ($env:SHIFTLYCASH_API_BASE) { $env:SHIFTLYCASH_API_BASE }
elseif ($envValues['SHIFTLYCASH_API_BASE']) { $envValues['SHIFTLYCASH_API_BASE'] }
else { 'https://shiftlycash.vercel.app' }
$apiBase = $apiBase.TrimEnd('/')

$uri = "$apiBase/api/cal/quick-log"
$headers = @{ Authorization = "Bearer $token" }

if ($List -or -not $Food) {
  $res = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
  Write-Host "Saved foods ($($res.today_iso)):"
  foreach ($f in $res.saved_foods) {
    "{0,-34} {1,5} cal  {2,4}g protein" -f $f.name, $f.calories, $f.protein_g | Write-Host
  }
  if (-not $Food) { Write-Host "`nUsage: .\cal-log.ps1 <name or fragment> [-Servings 1.5]" }
  exit 0
}

$body = @{ food = $Food; servings = $Servings }
if ($Date) { $body.date = $Date }
if ($Time) { $body.time = $Time }

try {
  $res = Invoke-RestMethod -Uri $uri -Headers $headers -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json)
  Write-Host "Logged: $($res.logged.meal_name) - $($res.logged.calories) cal, $($res.logged.protein_g)g protein at $($res.logged.logged_time) on $($res.logged.date)"
}
catch {
  # The API answers an ambiguous or unknown name with the list of candidates;
  # surface that instead of a bare HTTP error, so the next attempt can be right.
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $raw = $reader.ReadToEnd()
    try {
      $err = $raw | ConvertFrom-Json
      Write-Host $err.error -ForegroundColor Yellow
      if ($err.candidates) { Write-Host ("Did you mean: " + ($err.candidates -join ', ')) }
      elseif ($err.available) { Write-Host ("Available: " + ($err.available -join ', ')) }
    }
    catch { Write-Host $raw -ForegroundColor Yellow }
  }
  else { throw }
  exit 1
}
