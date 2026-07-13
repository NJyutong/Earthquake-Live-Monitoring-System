$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $root 'earthquake-system-github-release.zip'
$entries = @(
  '.env.example',
  '.gitignore',
  '.npmrc',
  'README.md',
  'README_CN.md',
  'LICENSE',
  'SECURITY.md',
  'server.js',
  'release.json',
  'package.json',
  'package-lock.json',
  'cloudflare',
  'data/.gitkeep',
  'docs',
  'public',
  'scripts'
)

Set-Location $root
$npm = (Get-Command 'npm.cmd' -ErrorAction Stop).Source

& $npm run check
if ($LASTEXITCODE -ne 0) {
  throw 'JavaScript syntax checks failed; archive was not created.'
}

& $npm run feature-check
if ($LASTEXITCODE -ne 0) {
  throw 'Feature smoke checks failed; archive was not created.'
}

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

& tar.exe -a -c -f $archive @entries
if ($LASTEXITCODE -ne 0) {
  throw 'Archive creation failed.'
}

$archiveEntries = @(& tar.exe -t -f $archive) | ForEach-Object { $_ -replace '\\', '/' }
if ($LASTEXITCODE -ne 0) {
  throw 'Archive inventory failed.'
}

$forbidden = $archiveEntries | Where-Object {
  $_ -match '(^|/)\.git(/|$)' -or
  ($_ -match '(^|/)\.env(?:\.|$)' -and $_ -notmatch '(^|/)\.env\.example$') -or
  $_ -match '(^|/)node_modules(/|$)' -or
  ($_ -match '(^|/)data/.+' -and $_ -notmatch '(^|/)data/\.gitkeep$')
}
if ($forbidden) {
  Remove-Item -LiteralPath $archive -Force
  throw 'Archive contains forbidden local or secret-bearing paths.'
}

$item = Get-Item -LiteralPath $archive
$hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
Write-Output "Created: $($item.FullName)"
Write-Output "Bytes: $($item.Length)"
Write-Output "SHA256: $($hash.Hash)"
