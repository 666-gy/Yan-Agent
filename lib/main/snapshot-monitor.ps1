param([int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path (Join-Path $PSScriptRoot 'snapshot-monitor.cs') -ReferencedAssemblies System.Windows.Forms,System.Web.Extensions
[YanSnapshotMonitor]::Run($OwnerProcessId)
