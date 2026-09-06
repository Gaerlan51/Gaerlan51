# The whole launch story, for Windows. Run from the repo root in PowerShell:
#
#   .\dtr.ps1
#
# then open http://localhost:8000/admin/ and LEAVE THIS WINDOW OPEN — the
# server runs here. Closing it stops the app, and the browser will say
# ERR_CONNECTION_REFUSED.
#
# First run creates a virtual environment, installs the four dependencies,
# builds the database and adds demo data. Later runs just start the server.
# Arguments pass through, so `.\dtr.ps1 --port 9000` works.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Find a Python. The Windows launcher `py` is the reliable one when both exist.
$python = $null
foreach ($candidate in @('py', 'python', 'python3')) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($found) {
        # NOT $args — that automatic variable holds this script's own arguments,
        # and overwriting it would swallow anything passed to `dtr serve`.
        $probe = if ($candidate -eq 'py') { @('-3', '--version') } else { @('--version') }
        try {
            & $found.Source @probe | Out-Null
            $python = $found.Source
            $pyPrefix = if ($candidate -eq 'py') { @('-3') } else { @() }
            break
        } catch { }
    }
}
if (-not $python) {
    Write-Error @'
No Python found. Install Python 3.11 or newer from https://www.python.org/downloads/
(tick "Add python.exe to PATH" in the installer), then run this again.
'@
    exit 1
}

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
    Write-Host 'creating .venv'
    & $python @pyPrefix -m venv .venv
}

# Cheap check: if FastAPI imports, the rest is there too.
& $venvPython -c 'import fastapi' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'installing dependencies'
    & $venvPython -m pip install --quiet --upgrade pip
    & $venvPython -m pip install --quiet -r dtr\requirements.txt
}

# Seed only on a genuinely first run. Never add demo people to a live database.
$dataDir = if ($env:DTR_DATA_DIR) { $env:DTR_DATA_DIR } else { 'data\dtr' }
$firstRun = -not (Test-Path (Join-Path $dataDir 'dtr.db'))

& $venvPython -m dtr init

if ($firstRun) {
    & $venvPython -m dtr seed
    Write-Host ''
    Write-Host "That is demo data. For a real setup, delete $dataDir\dtr.db, run this again,"
    Write-Host "and create your own admin with: .venv\Scripts\python.exe -m dtr admin 1001 'Your Name'"
}

Write-Host ''
Write-Host 'Leave this window open — the server runs here. Ctrl-C stops it.' -ForegroundColor Yellow
Write-Host ''
& $venvPython -m dtr serve @args
