$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'officecli-runner.js'

if ($env:YAN_ELECTRON_RUNTIME) {
  $previousMode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $env:YAN_ELECTRON_RUNTIME $runner @args
    exit $LASTEXITCODE
  } finally {
    $env:ELECTRON_RUN_AS_NODE = $previousMode
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  [Console]::Error.WriteLine('[Yan OfficeCLI] 未找到 Yan runtime 或 Node.js。')
  exit 1
}

& $node.Source $runner @args
exit $LASTEXITCODE
