param(
    [string]$Device = "127.0.0.1:62001",
    [string]$Package = "com.kakaogames.wdfp"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupDir = Join-Path $root ".logs\client-state"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$restorePath = "/data/data/$Package/$Package/Local Store/production---latest/room_restore_data"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupDir "room_restore_data-$stamp"

adb connect $Device | Out-Host
adb shell am force-stop $Package | Out-Host

$exists = adb shell "if [ -f '$restorePath' ]; then echo yes; else echo no; fi"
if (($exists -join "").Trim() -ne "yes") {
    Write-Host "room_restore_data not found; nothing to reset."
    exit 0
}

adb pull $restorePath $backupPath | Out-Host
adb shell "rm '$restorePath'" | Out-Host

$after = adb shell "if [ -f '$restorePath' ]; then echo still_exists; else echo removed; fi"
Write-Host "room_restore_data reset: $(($after -join '').Trim())"
Write-Host "backup: $backupPath"
