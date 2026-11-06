param(
  [Parameter(Mandatory=$true)][string]$Baseline,
  [Parameter(Mandatory=$true)][string]$Delta,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
function Read-Exact($Stream, [int]$Count) {
  $buffer = New-Object byte[] $Count
  $offset = 0
  while ($offset -lt $Count) {
    $received = $Stream.Read($buffer, $offset, $Count - $offset)
    if ($received -eq 0) { throw 'Truncated update data' }
    $offset += $received
  }
  return ,$buffer
}
function Get-Sha512Base64([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $hash = [Security.Cryptography.SHA512]::Create()
  try { return [Convert]::ToBase64String($hash.ComputeHash($stream)) }
  finally { $hash.Dispose(); $stream.Dispose() }
}
$target = [IO.Path]::GetFullPath($Output)
if ([IO.File]::Exists($target)) { throw 'Output already exists; choose a new filename' }
$temporary = $target + '.' + [Guid]::NewGuid().ToString('N') + '.part'
$patch = [IO.File]::OpenRead([IO.Path]::GetFullPath($Delta))
$old = $null; $destination = $null
try {
  $prefix = Read-Exact $patch 12
  if ([Text.Encoding]::ASCII.GetString($prefix, 0, 8) -ne 'YANDELTA') { throw 'Invalid delta magic' }
  $length = [BitConverter]::ToUInt32($prefix, 8)
  if ($length -gt 33554432) { throw 'Delta header too large' }
  $header = [Text.Encoding]::UTF8.GetString((Read-Exact $patch $length)) | ConvertFrom-Json
  if ($header.schemaVersion -ne 1 -or $header.operations.Count -gt 262144 -or $header.target.size -le 0 -or $header.target.size -gt 8589934592) { throw 'Invalid delta manifest' }
  Write-Host 'Verifying original installer...'
  if ((Get-Sha512Base64 $Baseline) -cne $header.base.sha512) { throw "Wrong baseline installer. Required exact original installer: $($header.base.name)" }
  $old = [IO.File]::OpenRead([IO.Path]::GetFullPath($Baseline))
  $destination = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  [long]$position = 0
  foreach ($operation in $header.operations) {
    if ($operation.offset -ne $position -or $operation.size -lt 1 -or $operation.size -gt 524288 -or $operation.sourceOffset -lt 0) { throw 'Invalid operation' }
    if ($operation.source -eq 'base') { $source = $old; $source.Position = $operation.sourceOffset }
    elseif ($operation.source -eq 'payload') { $source = $patch; $source.Position = 12 + $length + $operation.sourceOffset }
    else { throw 'Unknown delta source' }
    $bytes = Read-Exact $source $operation.size
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actual -cne $operation.sha256) { throw 'Corrupt update chunk' }
    $destination.Write($bytes, 0, $bytes.Length); $position += $bytes.Length
    Write-Progress -Activity 'Reconstructing verified Yan installer' -PercentComplete ([Math]::Min(100, 100 * $position / $header.target.size))
  }
  $destination.Dispose(); $destination = $null
  if ($position -ne $header.target.size -or (Get-Sha512Base64 $temporary) -cne $header.target.sha512) { throw 'Final installer checksum mismatch' }
  [IO.File]::Move($temporary, $target)
  Write-Progress -Activity 'Reconstructing verified Yan installer' -Completed
  Write-Host "Verified installer saved: $target"
  Write-Host 'Close Yan and open this installer when ready. No application files have been modified.'
} finally {
  $patch.Dispose()
  if ($old) { $old.Dispose() }
  if ($destination) { $destination.Dispose() }
  # Only this invocation's uniquely named temporary file is removed.
  if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
