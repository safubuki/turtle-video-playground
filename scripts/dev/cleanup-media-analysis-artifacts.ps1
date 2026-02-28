param(
  [ValidateSet("all", "keep-json")]
  [string]$Mode = "all",
  [string]$TmpVideoAnalysisDir = "tmp/video-analysis",
  [string]$MediaAnalysisOutputDir = ".media-analysis-output",
  [Alias("?")]
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host "Usage:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev/cleanup-media-analysis-artifacts.ps1 [-Mode all|keep-json] [-TmpVideoAnalysisDir <path>] [-MediaAnalysisOutputDir <path>]"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  npm run dev:media:cleanup"
  Write-Host "  npm run dev:media:cleanup:keep-json"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/dev/cleanup-media-analysis-artifacts.ps1 -Mode keep-json"
  exit 0
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ResolvedTmpDir = Join-Path $RepoRoot $TmpVideoAnalysisDir
$ResolvedOutputDir = Join-Path $RepoRoot $MediaAnalysisOutputDir

if ($Mode -eq "all") {
  if (Test-Path $ResolvedTmpDir) {
    Get-ChildItem -Path $ResolvedTmpDir -Force -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $ResolvedOutputDir) {
    Get-ChildItem -Path $ResolvedOutputDir -Force -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Cleanup completed: removed all files under $TmpVideoAnalysisDir and $MediaAnalysisOutputDir."
  exit 0
}

# keep-json mode:
# - keep *.json files in tmp/video-analysis
# - remove everything else in tmp/video-analysis
# - remove all files in .media-analysis-output
if (Test-Path $ResolvedTmpDir) {
  Get-ChildItem -Path $ResolvedTmpDir -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      if ($_.PSIsContainer) {
        Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        return
      }
      $isJson = $_.Extension -ieq ".json"
      if (-not $isJson) {
        Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
      }
    }
}
if (Test-Path $ResolvedOutputDir) {
  Get-ChildItem -Path $ResolvedOutputDir -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed: kept JSON files in $TmpVideoAnalysisDir; removed other artifacts and all files under $MediaAnalysisOutputDir."
