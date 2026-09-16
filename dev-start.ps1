$ErrorActionPreference = "Stop"

# ============================================================================
# Bento dev launcher v7
# - Starts Vite
# - Starts Pinggy
# - Reads Pinggy public URL from the local Pinggy debugger
# - Updates LIFF Endpoint URL
# - Uses an explicit LINE Login Channel ID (no default-channel dependency)
# - No diagnostic log file
# ============================================================================

$repoRoot = $PSScriptRoot
$channelId = "2011372097"
$pinggyDebugPort = 4300

function Pause-And-Exit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [int]$ExitCode = 1
    )

    Write-Host ""
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close this launcher"
    exit $ExitCode
}

function Get-EnvFileValue {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    $envFiles = @(
        ".env.local",
        ".env.development.local",
        ".env.development",
        ".env"
    )

    foreach ($envFile in $envFiles) {
        $path = Join-Path $repoRoot $envFile

        if (-not (Test-Path $path)) {
            continue
        }

        foreach ($line in Get-Content $path) {
            foreach ($name in $Names) {
                $escapedName = [regex]::Escape($name)

                if ($line -match "^\s*$escapedName\s*=\s*[`"']?([^`"'#\s]+)[`"']?\s*(?:#.*)?$") {
                    Write-Host "      Found $name in $envFile"
                    return $Matches[1]
                }
            }
        }
    }

    return $null
}

function Get-LiffId {
    $candidates = @(
        @{ Name = "LIFF_ID"; Value = $env:LIFF_ID },
        @{ Name = "VITE_LIFF_ID"; Value = $env:VITE_LIFF_ID },
        @{ Name = "LINE_LIFF_ID"; Value = $env:LINE_LIFF_ID },
        @{ Name = "VITE_LINE_LIFF_ID"; Value = $env:VITE_LINE_LIFF_ID }
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate.Value)) {
            Write-Host "      Found $($candidate.Name) in environment"
            return $candidate.Value.Trim()
        }
    }

    return Get-EnvFileValue -Names @(
        "LIFF_ID",
        "VITE_LIFF_ID",
        "LINE_LIFF_ID",
        "VITE_LINE_LIFF_ID"
    )
}

function Get-LiffCliPath {
    $commands = @(
        "liff-cli.cmd",
        "liff-cli"
    )

    foreach ($commandName in $commands) {
        $cmd = Get-Command $commandName -ErrorAction SilentlyContinue

        if ($cmd) {
            return $cmd.Source
        }
    }

    $localCandidates = @(
        (Join-Path $repoRoot "node_modules\.bin\liff-cli.cmd"),
        (Join-Path $repoRoot "node_modules\.bin\liff-cli")
    )

    foreach ($path in $localCandidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

function Get-PinggyUrl {
    param(
        [int]$DebugPort = 4300,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $apiUrl = "http://127.0.0.1:$DebugPort/urls"

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-RestMethod `
                -Uri $apiUrl `
                -Method Get `
                -TimeoutSec 2 `
                -ErrorAction Stop

            $urls = @()

            if ($null -ne $response.urls) {
                $urls = @($response.urls)
            }
            elseif ($response -is [System.Array]) {
                $urls = @($response)
            }

            # Prefer the domain already used by the project's remote-test CORS rule.
            $preferred = $urls |
                Where-Object {
                    $_ -is [string] -and
                    $_ -match '^https://[^/]+\.run\.pinggy-free\.link/?$'
                } |
                Select-Object -First 1

            if (-not [string]::IsNullOrWhiteSpace($preferred)) {
                return $preferred.TrimEnd("/")
            }

            $fallback = $urls |
                Where-Object {
                    $_ -is [string] -and $_ -match '^https://'
                } |
                Select-Object -First 1

            if (-not [string]::IsNullOrWhiteSpace($fallback)) {
                return $fallback.TrimEnd("/")
            }
        }
        catch {
            # Pinggy debugger is not ready yet.
        }

        Start-Sleep -Milliseconds 500
    }

    return $null
}

Write-Host ""
Write-Host "=== Bento dev launcher v7 ===" -ForegroundColor Cyan
Write-Host "Repo:       $repoRoot"
Write-Host "Channel ID: $channelId"
Write-Host ""

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

Write-Host "[1/6] Checking LIFF configuration..."

$liffId = Get-LiffId

if (-not $liffId) {
    Pause-And-Exit "LIFF ID not found. Put VITE_LIFF_ID (or LIFF_ID) in an .env file."
}

Write-Host "      LIFF ID: $liffId" -ForegroundColor Green

$liffCli = Get-LiffCliPath

if (-not $liffCli) {
    Pause-And-Exit "LIFF CLI not found. Install it with: npm install -g @line/liff-cli"
}

Write-Host "      LIFF CLI: $liffCli" -ForegroundColor Green

Write-Host "[2/6] Checking LINE channel access..."

& $liffCli app list --channel-id $channelId
$channelCheckExit = $LASTEXITCODE

if ($channelCheckExit -ne 0) {
    Pause-And-Exit "Cannot access LINE channel $channelId. Run 'liff-cli channel add $channelId' with this LINE Login channel's Channel Secret." $channelCheckExit
}

Write-Host "      Channel access: PASS" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Start Vite
# ---------------------------------------------------------------------------

Write-Host "[3/6] Starting Vite..."

$escapedRepoRoot = $repoRoot.Replace("'", "''")

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$escapedRepoRoot'; npm run dev"
)

Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
# Start Pinggy
# ---------------------------------------------------------------------------

Write-Host "[4/6] Starting Pinggy..."
Write-Host "      When Pinggy asks for a password, press Enter." -ForegroundColor Yellow

$pinggyCmd = "ssh -p 443 -R0:127.0.0.1:5173 -L${pinggyDebugPort}:127.0.0.1:4300 free.pinggy.io"

Start-Process cmd.exe `
    -WorkingDirectory $repoRoot `
    -ArgumentList @(
        "/d",
        "/k",
        $pinggyCmd
    )

# ---------------------------------------------------------------------------
# Get Pinggy URL
# ---------------------------------------------------------------------------

Write-Host "[5/6] Waiting for Pinggy public URL..."

$pinggyUrl = Get-PinggyUrl -DebugPort $pinggyDebugPort

if (-not $pinggyUrl) {
    Pause-And-Exit "Could not obtain Pinggy URL within 60 seconds. Check the Pinggy window and make sure local port $pinggyDebugPort is free."
}

Write-Host "      Pinggy URL: $pinggyUrl" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Update LIFF
# ---------------------------------------------------------------------------

Write-Host "[6/6] Updating LIFF Endpoint URL..."

Write-Host "      Channel:  $channelId"
Write-Host "      LIFF ID:  $liffId"
Write-Host "      Endpoint: $pinggyUrl"

& $liffCli app update `
    --channel-id $channelId `
    --liff-id $liffId `
    --endpoint-url $pinggyUrl

$updateExit = $LASTEXITCODE

if ($updateExit -ne 0) {
    Pause-And-Exit "LIFF Endpoint URL update failed with exit code $updateExit." $updateExit
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "[PASS] LIFF Endpoint URL updated successfully." -ForegroundColor Green
Write-Host "Channel ID : $channelId"
Write-Host "LIFF ID    : $liffId"
Write-Host "Endpoint   : $pinggyUrl"
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Vite and Pinggy remain running in their own windows."
Write-Host ""

Read-Host "Press Enter to close this launcher"
