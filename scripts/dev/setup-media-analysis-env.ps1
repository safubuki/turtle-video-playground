param(
  [string]$VenvDir = ".venv-media-analysis",
  [string]$RequirementsPath = "scripts/dev/requirements-media-analysis.txt",
  [string]$SttRequirementsPath = "scripts/dev/requirements-media-analysis-stt.txt",
  [string]$SttIndexUrl = "https://pypi.org/simple",
  [switch]$WithStt,
  [switch]$PrefetchSttModels,
  [string[]]$SttModels = @("tiny", "small"),
  [string]$SttDevice = "auto",
  [string]$SttComputeType = "int8",
  [switch]$UpgradePip,
  [Alias("?")]
  [switch]$Help
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if ($Help) {
  Write-Host "Usage:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev/setup-media-analysis-env.ps1 [-VenvDir <path>] [-RequirementsPath <path>] [-SttRequirementsPath <path>] [-SttIndexUrl <url>] [-WithStt] [-PrefetchSttModels] [-SttModels <tiny small ...>] [-SttDevice <name>] [-SttComputeType <name>] [-UpgradePip]"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  npm run dev:media:setup"
  Write-Host "  npm run dev:media:setup -- -WithStt"
  Write-Host "  npm run dev:media:setup -- -WithStt -PrefetchSttModels -SttModels tiny,small"
  Write-Host "  npm run dev:media:setup -- -WithStt -SttIndexUrl https://pypi.org/simple"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev/setup-media-analysis-env.ps1 -WithStt -PrefetchSttModels -SttModels small"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev/setup-media-analysis-env.ps1 -UpgradePip"
  exit 0
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvPath = Join-Path $RepoRoot $VenvDir
$ResolvedRequirements = Join-Path $RepoRoot $RequirementsPath
$ResolvedSttRequirements = Join-Path $RepoRoot $SttRequirementsPath
$ResolvedPrefetchScript = Join-Path $PSScriptRoot "prefetch-whisper-models.py"

function Test-IsBlockedLoopbackProxy([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }
  $trimmed = $Value.Trim()
  $uriRef = [ref]([Uri]$null)
  if (-not [Uri]::TryCreate($trimmed, [UriKind]::Absolute, $uriRef)) {
    return $false
  }
  $uri = $uriRef.Value
  $host = $uri.Host.ToLowerInvariant()
  $isLoopbackHost = $host -eq "127.0.0.1" -or $host -eq "localhost" -or $host -eq "::1"
  return $isLoopbackHost -and $uri.Port -eq 9
}

function Invoke-WithSanitizedProxy([scriptblock]$Action) {
  $proxyVars = @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
  $savedValues = @{}
  $disabledVars = @()

  foreach ($varName in $proxyVars) {
    $item = Get-Item "Env:$varName" -ErrorAction SilentlyContinue
    if ($null -eq $item) {
      continue
    }
    $savedValues[$varName] = $item.Value
    if (Test-IsBlockedLoopbackProxy $item.Value) {
      Remove-Item "Env:$varName" -ErrorAction SilentlyContinue
      $disabledVars += $varName
    }
  }

  if ($disabledVars.Count -gt 0) {
    Write-Host "Detected loopback:9 proxy values and temporarily disabled: $($disabledVars -join ', ')"
  }

  try {
    & $Action
  } finally {
    foreach ($varName in $savedValues.Keys) {
      Set-Item "Env:$varName" $savedValues[$varName]
    }
  }
}

$HasPyLauncher = $null -ne (Get-Command py -ErrorAction SilentlyContinue)
$HasPython = $null -ne (Get-Command python -ErrorAction SilentlyContinue)

if (-not $HasPyLauncher -and -not $HasPython) {
  throw "Python was not found. Please install Python 3.11+."
}

if (-not (Test-Path $ResolvedRequirements)) {
  throw "requirements file was not found: $ResolvedRequirements"
}
if ($WithStt -and -not (Test-Path $ResolvedSttRequirements)) {
  throw "STT requirements file was not found: $ResolvedSttRequirements"
}
if ($PrefetchSttModels -and -not $WithStt) {
  throw "-PrefetchSttModels requires -WithStt."
}
if ($PrefetchSttModels -and -not (Test-Path $ResolvedPrefetchScript)) {
  throw "Whisper prefetch script was not found: $ResolvedPrefetchScript"
}

if (-not (Test-Path $VenvPath)) {
  Write-Host "Creating virtual environment: $VenvPath"
  if ($HasPyLauncher) {
    & py -3 -m venv $VenvPath
  } else {
    & python -m venv $VenvPath
  }
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} else {
  Write-Host "Using existing virtual environment: $VenvPath"
}

$VenvPythonCandidates = @(
  (Join-Path $VenvPath "Scripts\python.exe"),
  (Join-Path $VenvPath "bin\python.exe")
)
$VenvPython = $VenvPythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $VenvPython) {
  throw "venv python was not found. Checked: $($VenvPythonCandidates -join ', ')"
}

$pipAvailable = $true
try {
  & $VenvPython -m pip --version 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    $pipAvailable = $false
  }
} catch {
  $pipAvailable = $false
}

if (-not $pipAvailable) {
  Write-Host "pip is missing in venv. Bootstrapping with ensurepip..."
  try {
    & $VenvPython -m ensurepip --upgrade
  } catch {
    throw "pip bootstrap failed in venv: $VenvPath"
  }
  if ($LASTEXITCODE -ne 0) {
    throw "pip bootstrap failed in venv: $VenvPath"
  }
}

if ($UpgradePip) {
  $upgradePipExitCode = 0
  Invoke-WithSanitizedProxy {
    & $VenvPython -m pip install --upgrade pip
    $script:upgradePipExitCode = $LASTEXITCODE
  }
  if ($upgradePipExitCode -ne 0) {
    exit $upgradePipExitCode
  }
}

Write-Host "Installing base media-analysis dependencies from: $ResolvedRequirements"
$baseInstallExitCode = 0
Invoke-WithSanitizedProxy {
  & $VenvPython -m pip install -r $ResolvedRequirements
  $script:baseInstallExitCode = $LASTEXITCODE
}
if ($baseInstallExitCode -ne 0) {
  exit $baseInstallExitCode
}

if ($WithStt) {
  Write-Host "Installing STT dependencies from: $ResolvedSttRequirements"
  $previousPipNoIndex = $env:PIP_NO_INDEX
  $hadNoIndex = Test-Path Env:NO_INDEX
  $previousNoIndex = $env:NO_INDEX
  $sttExitCode = 0
  try {
    $env:PIP_NO_INDEX = "0"
    if ($hadNoIndex) {
      Remove-Item Env:NO_INDEX -ErrorAction SilentlyContinue
    }
    Invoke-WithSanitizedProxy {
      if ([string]::IsNullOrWhiteSpace($SttIndexUrl)) {
        & $VenvPython -m pip install -r $ResolvedSttRequirements
      } else {
        & $VenvPython -m pip install --index-url $SttIndexUrl -r $ResolvedSttRequirements
      }
      $script:sttExitCode = $LASTEXITCODE
    }
  } finally {
    if ($null -eq $previousPipNoIndex) {
      Remove-Item Env:PIP_NO_INDEX -ErrorAction SilentlyContinue
    } else {
      $env:PIP_NO_INDEX = $previousPipNoIndex
    }
    if ($hadNoIndex) {
      $env:NO_INDEX = $previousNoIndex
    }
  }
  if ($sttExitCode -ne 0) {
    exit $sttExitCode
  }
}

if ($PrefetchSttModels) {
  $normalizedModels = @(
    $SttModels |
      ForEach-Object { "$_".Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Unique
  )
  if ($normalizedModels.Count -eq 0) {
    throw "SttModels is empty. Specify at least one model, e.g. -SttModels tiny,small"
  }

  Write-Host "Prefetching Whisper models: $($normalizedModels -join ', ')"
  $prefetchArgs = @(
    $ResolvedPrefetchScript,
    "--models"
  ) + $normalizedModels + @(
    "--device", "$SttDevice",
    "--compute-type", "$SttComputeType"
  )

  $prefetchExitCode = 0
  Invoke-WithSanitizedProxy {
    & $VenvPython @prefetchArgs
    $script:prefetchExitCode = $LASTEXITCODE
  }
  if ($prefetchExitCode -ne 0) {
    exit $prefetchExitCode
  }
}

Write-Host ""
Write-Host "Media analysis setup completed."
Write-Host "Next command:"
Write-Host '  npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4"'
if ($WithStt) {
  Write-Host '  npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode transcribe -SttModel small -SttLanguage ja'
}
if ($PrefetchSttModels) {
  Write-Host "Cached STT models: $($normalizedModels -join ', ')"
}
