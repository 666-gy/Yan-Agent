$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$providerId = $env:YAN_DESKTOP_PROVIDER
$configuredExe = $env:YAN_DESKTOP_EXECUTABLE
if ($providerId -notin @('codex', 'claude', 'reasonix')) { throw 'Unknown provider' }
$displayName = if ($providerId -eq 'codex') { 'Codex' } elseif ($providerId -eq 'reasonix') { 'Reasonix Studio' } else { 'Claude' }

function Read-DesktopMetadata([string]$candidate, [string]$packageVersion = '') {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
    if ([IO.Path]::GetExtension($candidate) -ine '.exe') { return $null }
    $item = Get-Item -LiteralPath $candidate
    if ($item.VersionInfo.ProductName -ine $displayName) { return $null }
    # Desktop applications ship an Electron archive; their CLI engines do not.
    $archive = Join-Path $item.DirectoryName 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { return $null }
    $version = if ($packageVersion) { $packageVersion } elseif ($providerId -eq 'reasonix') { $item.VersionInfo.FileVersion } else { $item.VersionInfo.ProductVersion }
    return @{ installed = $true; executable = $item.FullName; version = $version }
}

if ($configuredExe) {
    $found = Read-DesktopMetadata $configuredExe
    if ($null -eq $found) {
        @{ installed = $false; reason = 'not-desktop' } | ConvertTo-Json -Compress
    } else { $found | ConvertTo-Json -Compress }
    exit
}

if ($providerId -eq 'reasonix') {
    @{ installed = $false; reason = 'not-found' } | ConvertTo-Json -Compress
    exit
}

$packageName = if ($providerId -eq 'codex') { 'OpenAI.Codex' } else { 'Claude' }
$appId = if ($providerId -eq 'codex') { 'App' } else { 'Claude' }
foreach ($package in @(Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Sort-Object Version -Descending)) {
    try {
        [xml]$manifest = Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw
        $application = @($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq $appId } | Select-Object -First 1
        if ($null -eq $application -or -not $application.Executable) { continue }
        $found = Read-DesktopMetadata (Join-Path $package.InstallLocation $application.Executable) ([string]$package.Version)
        if ($null -ne $found) { $found | ConvertTo-Json -Compress; exit }
    } catch { continue }
}

$candidates = @()
if ($env:LOCALAPPDATA) {
    if ($providerId -eq 'codex') {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Codex\Codex.exe')
        $candidates += (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\Codex.exe')
    } else {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Claude\Claude.exe')
        $candidates += (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\Claude.exe')
        $base = Join-Path $env:LOCALAPPDATA 'AnthropicClaude'
        if (Test-Path -LiteralPath $base -PathType Container) {
            foreach ($versionDir in @(Get-ChildItem -LiteralPath $base -Directory -Filter 'app-*' | Sort-Object Name -Descending)) {
                $candidates += (Join-Path $versionDir.FullName 'Claude.exe')
            }
        }
    }
}
foreach ($candidate in $candidates) {
    $found = Read-DesktopMetadata $candidate
    if ($null -ne $found) { $found | ConvertTo-Json -Compress; exit }
}
@{ installed = $false; reason = 'not-found' } | ConvertTo-Json -Compress
