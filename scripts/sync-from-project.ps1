<#
.SYNOPSIS
    Fetches items from the GitHub Project and generates/updates mesures.json locally.

.DESCRIPTION
    Wrapper around .github/scripts/generate-mesures.js that lets you run the
    same sync locally — useful to preview or validate changes before they are
    committed by the GitHub Action.

    The script will also validate the resulting mesures.json against the
    expected schema (ids unique, statut/priorite values correct, etc.).

.PARAMETER Token
    GitHub Personal Access Token with the "read:project" scope.
    Falls back to the GITHUB_TOKEN environment variable if not provided.

.PARAMETER Org
    GitHub organisation login. Default: leblancmesnil

.PARAMETER ProjectNumber
    Project number from the project URL (/projects/<N>). Default: 2

.PARAMETER DryRun
    Preview the generated JSON without writing it to disk.

.PARAMETER ValidateOnly
    Skip the network fetch — only validate the existing mesures.json on disk.

.EXAMPLE
    # Sync from GitHub Project (token from env)
    .\scripts\sync-from-project.ps1

    # Dry-run: see what would be generated without writing
    .\scripts\sync-from-project.ps1 -DryRun

    # Validate existing file only
    .\scripts\sync-from-project.ps1 -ValidateOnly

    # Provide token inline
    .\scripts\sync-from-project.ps1 -Token ghp_xxxxxxxxxxxx
#>
[CmdletBinding()]
param(
    [string] $Token         = $env:GITHUB_TOKEN,
    [string] $Org           = 'leblancmesnil',
    [int]    $ProjectNumber = 2,
    [switch] $DryRun,
    [switch] $ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$RepoRoot    = Split-Path -Parent $PSScriptRoot
$NodeScript  = Join-Path $RepoRoot '.github\scripts\generate-mesures.js'
$MesuresFile = Join-Path $RepoRoot 'src\assets\data\mesures.json'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Section([string] $Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Test-Prerequisites {
    Write-Section 'Checking prerequisites'

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error 'Node.js is not installed or not in PATH. Install from https://nodejs.org'
    }
    $v = node --version
    Write-Host "  Node.js $v" -ForegroundColor Green

    if (-not (Test-Path $NodeScript)) {
        Write-Error "Node script not found: $NodeScript"
    }
    Write-Host "  Script found: $NodeScript" -ForegroundColor Green
}

function Get-Token {
    if ($Token) { return $Token }

    Write-Host ""
    Write-Host "  No GITHUB_TOKEN set. Enter a PAT with the 'read:project' scope:" -ForegroundColor Yellow
    $secure = Read-Host -Prompt '  GitHub Token' -AsSecureString
    $ptr    = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Invoke-NodeScript([string] $ResolvedToken) {
    Write-Section "Syncing project #$ProjectNumber from org '$Org'"

    $env:GITHUB_TOKEN   = $ResolvedToken
    $env:ORG            = $Org
    $env:PROJECT_NUMBER = [string] $ProjectNumber
    $env:OUTPUT_FILE    = $MesuresFile
    $env:DRY_RUN        = if ($DryRun) { 'true' } else { 'false' }

    try {
        node $NodeScript
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Node script exited with code $LASTEXITCODE"
        }
    } finally {
        # Clear token from environment immediately after use
        Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:ORG            -ErrorAction SilentlyContinue
        Remove-Item Env:PROJECT_NUMBER -ErrorAction SilentlyContinue
        Remove-Item Env:OUTPUT_FILE    -ErrorAction SilentlyContinue
        Remove-Item Env:DRY_RUN        -ErrorAction SilentlyContinue
    }
}

function Invoke-Validation {
    Write-Section 'Validating mesures.json'

    if (-not (Test-Path $MesuresFile)) {
        Write-Host "  [FAIL] File not found: $MesuresFile" -ForegroundColor Red
        return $false
    }

    # Parse JSON
    $raw = Get-Content $MesuresFile -Raw -Encoding UTF8
    try {
        $json = $raw | ConvertFrom-Json
    } catch {
        Write-Host "  [FAIL] Invalid JSON: $_" -ForegroundColor Red
        return $false
    }

    $ok = $true

    # Top-level keys
    foreach ($key in @('meta', 'chapitres', 'mesures')) {
        if ($null -eq $json.$key) {
            Write-Host "  [FAIL] Missing top-level key: '$key'" -ForegroundColor Red
            $ok = $false
        }
    }
    if (-not $ok) { return $false }

    $mesures        = $json.mesures
    $validStatuts   = @('a-demarrer', 'en-cours', 'livre')
    $validPriorites = @('A', 'B', 'C')
    $seenIds        = @{}
    $errorCount     = 0

    foreach ($m in $mesures) {
        $tag = "Mesure $($m.id)"

        if (-not $m.id) {
            Write-Host "  [FAIL] $tag — missing id" -ForegroundColor Red
            $errorCount++
        } elseif ($seenIds.ContainsKey([string] $m.id)) {
            Write-Host "  [FAIL] $tag — duplicate id" -ForegroundColor Red
            $errorCount++
        } else {
            $seenIds[[string] $m.id] = $true
        }

        if ([string]::IsNullOrWhiteSpace($m.titre)) {
            Write-Host "  [FAIL] $tag — empty titre" -ForegroundColor Red
            $errorCount++
        }

        if ($m.chapitreId -le 0) {
            Write-Host "  [WARN] $tag ($($m.titre)) — chapitreId is 0" -ForegroundColor Yellow
        }

        if ($validStatuts -notcontains $m.statut) {
            Write-Host "  [FAIL] $tag — invalid statut '$($m.statut)'" -ForegroundColor Red
            $errorCount++
        }

        if ($validPriorites -notcontains $m.priorite) {
            Write-Host "  [FAIL] $tag — invalid priorite '$($m.priorite)'" -ForegroundColor Red
            $errorCount++
        }
    }

    # Summary table
    $aDeMarrer = @($mesures | Where-Object { $_.statut -eq 'a-demarrer' }).Count
    $enCours   = @($mesures | Where-Object { $_.statut -eq 'en-cours'   }).Count
    $livre     = @($mesures | Where-Object { $_.statut -eq 'livre'      }).Count
    $chapIds   = ($mesures | Select-Object -ExpandProperty chapitreId | Sort-Object -Unique) -join ', '

    Write-Host ""
    Write-Host "  Total mesures : $($mesures.Count)" -ForegroundColor White
    Write-Host "  A démarrer    : $aDeMarrer"         -ForegroundColor Gray
    Write-Host "  En cours      : $enCours"           -ForegroundColor Yellow
    Write-Host "  Livré         : $livre"             -ForegroundColor Green
    Write-Host "  Chapitres ids : $chapIds"           -ForegroundColor Gray

    if ($errorCount -gt 0) {
        Write-Host ""
        Write-Host "  $errorCount error(s) found." -ForegroundColor Red
        return $false
    }

    Write-Host ""
    Write-Host "  [OK] mesures.json is valid." -ForegroundColor Green
    return $true
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if ($ValidateOnly) {
    $valid = Invoke-Validation
    if ($valid) { exit 0 } else { exit 1 }
}

Test-Prerequisites

$resolvedToken = Get-Token

Invoke-NodeScript -ResolvedToken $resolvedToken

if (-not $DryRun) {
    $valid = Invoke-Validation
    if (-not $valid) { exit 1 }
}
