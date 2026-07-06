# ==================================================
# MedSetu - Database Backup
# Usage: double-click backup.bat, or run:
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# See scripts/backup.md for full setup instructions.
# ==================================================

$ErrorActionPreference = "Stop"

$repoRoot  = Split-Path -Parent $PSScriptRoot
$envFile   = Join-Path $repoRoot ".env.local"
$backupDir = Join-Path $repoRoot "backups"

# -- 1. pg_dump must be findable -- PATH first, then common install
#      locations (a just-installed pg_dump often isn't on PATH yet in
#      an already-open shell until a fresh login/terminal picks up the
#      updated registry PATH).
function Find-PgTool([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

$pgDumpPath = Find-PgTool "pg_dump"
if (-not $pgDumpPath) {
    Write-Host "pg_dump nahi mila - PostgreSQL client tools install nahi hain." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install karo (ek baar hi, Administrator PowerShell se):" -ForegroundColor Yellow
    Write-Host "  choco install postgresql --params '/Password:temp-unused' -y"
    Write-Host "  (ya https://www.postgresql.org/download/windows/ se installer - setup mein sirf"
    Write-Host "   'Command Line Tools' component check karo, baaki uncheck kar sakte ho)"
    Write-Host ""
    Write-Host "Install ke baad ek NAYA PowerShell/terminal window kholo (PATH refresh ke liye)" -ForegroundColor Yellow
    Write-Host "aur yeh script dobara chalao."
    exit 1
}

# -- 2. Connection details from .env.local (gitignored, never committed) --
# Read as separate HOST/PORT/USER/DB/PASSWORD fields, NOT a single URI --
# a password containing '@', '#', '%', etc. (very common) silently breaks
# postgresql:// URI parsing (misparses the host/port), which is exactly
# what happened on the first real test of this script. Passing the
# password via PGPASSWORD instead sidesteps that entirely.
if (-not (Test-Path $envFile)) {
    Write-Host ".env.local nahi mila (repo root mein banao)." -ForegroundColor Red
    Write-Host ""
    Write-Host "Yeh lines daalo (scripts/backup.md mein poora detail hai):" -ForegroundColor Yellow
    Write-Host "  MEDSETU_DB_HOST=aws-0-REGION.pooler.supabase.com"
    Write-Host "  MEDSETU_DB_PORT=5432"
    Write-Host "  MEDSETU_DB_USER=postgres.xxxxxxxx"
    Write-Host "  MEDSETU_DB_NAME=postgres"
    Write-Host "  MEDSETU_DB_PASSWORD=your-real-password"
    Write-Host ""
    Write-Host "Yeh values kahan se milengi: Supabase Dashboard -> Project Settings -> Database"
    Write-Host "-> Connection string -> 'Session pooler' tab (port 5432, IPv4-compatible)."
    exit 1
}

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*(MEDSETU_DB_\w+)\s*=\s*(.+?)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
}
$dbHost = $envVars['MEDSETU_DB_HOST']
$dbPort = $envVars['MEDSETU_DB_PORT']
$dbUser = $envVars['MEDSETU_DB_USER']
$dbName = $envVars['MEDSETU_DB_NAME']
$dbPass = $envVars['MEDSETU_DB_PASSWORD']

if (-not $dbHost -or -not $dbPort -or -not $dbUser -or -not $dbName -or -not $dbPass) {
    Write-Host "MEDSETU_DB_HOST/PORT/USER/NAME/PASSWORD - koi ek .env.local mein missing hai." -ForegroundColor Red
    Write-Host "scripts/backup.md ke setup steps dobara check karo." -ForegroundColor Yellow
    exit 1
}

# -- 3. backups/ folder ready --
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

# -- 4. Run the dump --
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$outFile   = Join-Path $backupDir "MedSetu_backup_$timestamp.sql"

Write-Host "Backup shuru ho raha hai..."
Write-Host "  -> $outFile"
Write-Host ""

# --no-owner --no-privileges: Supabase manages roles/grants itself --
# without these flags, a restore attempt errors out on ALTER OWNER/GRANT
# statements for roles that don't exist on whichever DB you restore into.
# --format=plain: a readable .sql file (schema + data), restorable via psql.
$env:PGPASSWORD = $dbPass
try {
    & $pgDumpPath -h $dbHost -p $dbPort -U $dbUser -d $dbName `
        --no-owner --no-privileges --format=plain --file="$outFile" 2>&1 | ForEach-Object { Write-Host $_ }
    $dumpExitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if ($dumpExitCode -ne 0) {
    Write-Host ""
    Write-Host "Backup FAIL hua (exit code $dumpExitCode). Upar ka error dekho." -ForegroundColor Red
    Write-Host "Common wajah: host/user/password galat, ya password expire/reset ho gaya," -ForegroundColor Yellow
    Write-Host "ya firewall/network block kar raha hai port 5432." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0) {
    Write-Host "pg_dump 'success' bola par file khaali/missing hai - kuch to gadbad hai." -ForegroundColor Red
    exit 1
}

$sizeKB = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host ""
Write-Host "Backup ban gaya: $outFile ($sizeKB KB)" -ForegroundColor Green
Write-Host "Pehli 5 lines check karne ke liye: Get-Content '$outFile' -TotalCount 5"
