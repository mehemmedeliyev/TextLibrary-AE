# Text Library - After Effects panel installer / updater (Windows)
#   install.bat      -> copies the panel into After Effects (install or update)
#   install-dev.bat  -> links the panel to this folder, so code edits here show up in After Effects directly
param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $env:APPDATA 'Adobe\CEP\extensions\TextLibrary'

Write-Host ''
Write-Host '=== Text Library setup ===' -ForegroundColor Cyan

if (Get-Process -Name 'AfterFX' -ErrorAction SilentlyContinue) {
    Write-Host 'After Effects is running. Restart it after the installation.' -ForegroundColor Yellow
}

# 1) Allow unsigned panels (CEP debug mode) for every CEP version AE 2020+ may use
foreach ($v in 9..20) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Write-Host '[1/2] CEP debug mode enabled.'

# 2) Remove the previous version. A junction is removed as a link only - never its target's files.
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) {
    $item = Get-Item $target -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        cmd /c rmdir "$target" | Out-Null
    } else {
        Remove-Item $target -Recurse -Force
    }
}

if ($Dev) {
    New-Item -ItemType Junction -Path $target -Target $source | Out-Null
    Write-Host "[2/2] Developer mode: panel linked to this folder -> $source"
} else {
    New-Item -ItemType Directory -Path $target | Out-Null
    Get-ChildItem $source -Force | Where-Object { $_.Name -notin @('install.ps1', 'install.bat', 'install-dev.bat') } |
        Copy-Item -Destination $target -Recurse -Force
    Write-Host "[2/2] Panel copied to -> $target"
}

Write-Host ''
Write-Host 'Done! Open After Effects: Window > Extensions > Text Library' -ForegroundColor Green
Write-Host ''
