# ============================================================
# run-fetch-hot.ps1 -- launcher (ASCII only, no Chinese)  Day 17
# ------------------------------------------------------------
# Why this launcher exists:
#   Windows PowerShell 5.1 reads .ps1 files as ANSI(GBK) when they have no
#   BOM. fetch-hot.ps1 contains Chinese text, so it fails to parse.
#   This launcher is pure ASCII, reads fetch-hot.ps1 as explicit UTF-8,
#   then runs it in the current session.
#
# Usage (run from the project root):
#   powershell -ExecutionPolicy Bypass -File scripts_cloudbase/run-fetch-hot.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

# Resolve project root: this file lives in <root>/scripts_cloudbase/
if ($PSScriptRoot) {
  $root = Split-Path -Parent $PSScriptRoot
} else {
  $root = (Get-Location).Path
}
Set-Location $root

$target = Join-Path $root 'scripts_cloudbase\fetch-hot.ps1'
if (-not (Test-Path $target)) { throw "not found: $target" }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$src = [System.IO.File]::ReadAllText($target, $utf8NoBom)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$sb = [scriptblock]::Create($src)
& $sb

Write-Host ''
Write-Host 'DONE. Output: db/hot_sync.sql'
