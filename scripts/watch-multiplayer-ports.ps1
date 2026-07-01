param(
    [int[]]$Ports = @(18888),
    [int]$IntervalSeconds = 1
)

$ErrorActionPreference = "SilentlyContinue"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $root ".logs\net"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "ports-$stamp.log"
$seen = @{}

"# Started $(Get-Date -Format o)" | Tee-Object -FilePath $logPath
"# Watching ports: $($Ports -join ', ')" | Tee-Object -FilePath $logPath -Append

while ($true) {
    $now = Get-Date -Format o
    $rows = @()

    foreach ($port in $Ports) {
        $rows += Get-NetTCPConnection |
            Where-Object { $_.LocalPort -eq $port -or $_.RemotePort -eq $port } |
            Select-Object @{Name="Protocol";Expression={"TCP"}}, State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess

        $rows += Get-NetUDPEndpoint |
            Where-Object { $_.LocalPort -eq $port } |
            Select-Object @{Name="Protocol";Expression={"UDP"}}, @{Name="State";Expression={""}}, LocalAddress, LocalPort, @{Name="RemoteAddress";Expression={""}}, @{Name="RemotePort";Expression={""}}, OwningProcess
    }

    foreach ($row in $rows) {
        $key = "$($row.Protocol)|$($row.State)|$($row.LocalAddress)|$($row.LocalPort)|$($row.RemoteAddress)|$($row.RemotePort)|$($row.OwningProcess)"
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            $process = Get-Process -Id $row.OwningProcess
            $line = "$now $key process=$($process.ProcessName)"
            $line | Tee-Object -FilePath $logPath -Append
        }
    }

    Start-Sleep -Seconds $IntervalSeconds
}
