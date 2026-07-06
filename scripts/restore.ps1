# ==================================================
# MedSetu - Database Restore
# WARNING: yeh command TARGET DATABASE ka existing data
#   OVERWRITE/mix kar sakta hai. Production par sirf tab chalao jab
#   bilkul zaroor ho - ideally pehle ek fresh/test Supabase project
#   par try karo. Poora detail scripts/backup.md mein.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -BackupFile backups\MedSetu_backup_2026-07-06_1530.sql
#   (BackupFile na do to sabse latest backups\ ki file use hogi)
# ==================================================

param(
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$repoRoot  = Split-Path -Parent $PSScriptRoot
$envFile   = Join-Path $repoRoot ".env.local"
$backupDir = Join-Path $repoRoot "backups"

# -- 1. psql must be findable -- PATH first, then common install
#      locations (same reasoning as backup.ps1).
function Find-PgTool([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

$psqlPath = Find-PgTool "psql"
if (-not $psqlPath) {
    Write-Host "psql nahi mila - PostgreSQL client tools install nahi hain." -ForegroundColor Red
    Write-Host "Same install steps jo backup.ps1 mein hain - scripts/backup.md dekho." -ForegroundColor Yellow
    exit 1
}

# -- 2. Connection details (same HOST/PORT/USER/NAME/PASSWORD fields as
#      backup.ps1 -- see that file's comment for why not a single URI). --
if (-not (Test-Path $envFile)) {
    Write-Host ".env.local nahi mila - scripts/backup.md ke setup steps pehle karo." -ForegroundColor Red
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
    exit 1
}

# -- 3. Which backup file? --
if (-not $BackupFile) {
    $latest = Get-ChildItem -Path $backupDir -Filter "MedSetu_backup_*.sql" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) {
        Write-Host "backups\ mein koi backup file nahi mili. -BackupFile se path do." -ForegroundColor Red
        exit 1
    }
    $BackupFile = $latest.FullName
}
if (-not (Test-Path $BackupFile)) {
    Write-Host "Backup file nahi mili: $BackupFile" -ForegroundColor Red
    exit 1
}

# -- 4. Loud confirmation -- this is the dangerous step --
Write-Host ""
Write-Host "================================================" -ForegroundColor Red
Write-Host " WARNING: RESTORE OVERWRITES EXISTING DATA"        -ForegroundColor Red
Write-Host "================================================" -ForegroundColor Red
Write-Host "File:   $BackupFile"
Write-Host "Target: $dbUser@$dbHost`:$dbPort/$dbName"
Write-Host ""
Write-Host "Yeh target database mein already maujood tables/rows ke saath"
Write-Host "TAKRA sakta hai (duplicate keys, conflicting data) ya unhe"
Write-Host "overwrite kar sakta hai. Agar yeh production DB hai aur aap"
Write-Host "sirf kisi cheez ko wapas laane ki koshish kar rahe hain, pehle"
Write-Host "EK AUR backup abhi le lo (dobara backup.ps1 chalao) taaki"
Write-Host "restore se pehle ka state bhi mehfooz rahe."
Write-Host ""
$confirm = Read-Host "Confirm karne ke liye 'RESTORE' likho (kuch aur = cancel)"
if ($confirm -ne "RESTORE") {
    Write-Host "Cancel ho gaya - kuch nahi hua." -ForegroundColor Yellow
    exit 0
}

# -- 5. Run it --
Write-Host ""
Write-Host "Restore shuru ho raha hai..."
$env:PGPASSWORD = $dbPass
try {
    & $psqlPath -h $dbHost -p $dbPort -U $dbUser -d $dbName --file="$BackupFile" 2>&1 | ForEach-Object { Write-Host $_ }
    $restoreExitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if ($restoreExitCode -ne 0) {
    Write-Host ""
    Write-Host "psql ne non-zero exit diya (code $restoreExitCode)." -ForegroundColor Red
    Write-Host "Kuch statements shayad fail hue hon (e.g. table already exists) -" -ForegroundColor Yellow
    Write-Host "upar ka poora output padho, ho sakta hai baaki sab theek se chal gaya ho." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Restore complete." -ForegroundColor Green
