[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedMainSha,

    [switch]$Apply,
    [switch]$ConfirmLegalLineOwner,
    [switch]$ConfirmLegacyEmployeeLoginDisabled,
    [switch]$ConfirmVendorLoginId
)

$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $workerRoot
$configPath = Join-Path $workerRoot 'wrangler.jsonc'
$wranglerPath = Join-Path $workerRoot 'node_modules\wrangler\bin\wrangler.js'
$expectedSha = $ExpectedMainSha.ToLowerInvariant()
$vendorLoginId = 'V000' + '01'
$vendorName = ConvertFrom-Json -InputObject '"\u79be\u62fe"'

function Read-SecureValue {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $secureValue = Read-Host -Prompt $Prompt -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
        if ($null -ne $secureValue) { $secureValue.Dispose() }
    }
}

function ConvertTo-SqlLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Expand-SqlTemplate {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $expanded = $Sql.Replace('{{OWNER_USER_ID}}', (ConvertTo-SqlLiteral $ownerUserId))
    $expanded = $expanded.Replace('{{LEGACY_EMPLOYEE_ID}}', (ConvertTo-SqlLiteral $legacyEmployeeId))
    $expanded = $expanded.Replace('{{VENDOR_LOGIN_ID}}', (ConvertTo-SqlLiteral $vendorLoginId))
    return $expanded.Replace('{{VENDOR_NAME}}', (ConvertTo-SqlLiteral $vendorName))
}

function Invoke-GitText {
    param([string[]]$Arguments)
    $output = & git -C $repoRoot @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'GIT_PREFLIGHT_FAILED' }
    return (@($output) -join "`n").Trim()
}

function Write-TemporarySql {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $path = [System.IO.Path]::Combine(
        [System.IO.Path]::GetTempPath(),
        ('bento-vendor-owner-' + [guid]::NewGuid().ToString('N') + '.sql')
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($path, $Sql, $encoding)
    return $path
}

function Invoke-WranglerJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $wranglerArguments = @($Arguments) + @(
        '--remote', '--config', $configPath, '--yes', '--json'
    )
    $output = & node $wranglerPath @wranglerArguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = (@($output) | ForEach-Object { [string]$_ }) -join "`n"
    if ($exitCode -ne 0) {
        if ($text -match '(?i)(unauthorized|authentication failed|not authenticated|invalid api token|status 401|status 403)') {
            throw "WRANGLER_AUTHORIZATION_FAILED:$exitCode"
        }
        if ($text -match '(?i)(ECONN|fetch failed|network error|timed out|connection|status 502|status 503|status 504)') {
            throw "WRANGLER_CONNECTION_FAILED:$exitCode"
        }
        throw "WRANGLER_D1_EXECUTE_FAILED:$exitCode"
    }
    $jsonStart = $text.IndexOf('[')
    $jsonEnd = $text.LastIndexOf(']')
    if ($jsonStart -lt 0 -or $jsonEnd -lt $jsonStart) {
        throw 'WRANGLER_D1_JSON_UNAVAILABLE'
    }
    try {
        $results = ConvertFrom-Json -InputObject $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1)
    } catch {
        throw 'WRANGLER_D1_JSON_INVALID'
    }
    foreach ($result in @($results)) {
        if ($result.success -eq $false) { throw 'WRANGLER_D1_QUERY_FAILED' }
    }
    return @($results)
}

function Invoke-WranglerSqlFile {
    param([Parameter(Mandatory = $true)][string]$SqlPath)
    $arguments = @('d1', 'execute', 'bento-formal', '--file', $SqlPath)
    return Invoke-WranglerJson -Arguments $arguments
}

function Invoke-D1Query {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $expandedSql = Expand-SqlTemplate -Sql $Sql
    $arguments = @('d1', 'execute', 'bento-formal', '--command', $expandedSql)
    $resultSets = Invoke-WranglerJson -Arguments $arguments
    $rows = @()
    foreach ($resultSet in $resultSets) {
        if ($null -ne $resultSet.results) { $rows += @($resultSet.results) }
    }
    return $rows
}

function Assert-Condition {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) { throw $Code }
}

function ConvertTo-CompactJson {
    param([object]$Value)
    return ConvertTo-Json -InputObject $Value -Depth 8 -Compress
}

try {
    Assert-Condition (Test-Path -LiteralPath $wranglerPath -PathType Leaf) 'WRANGLER_NOT_INSTALLED'
    Assert-Condition ((Invoke-GitText @('branch', '--show-current')) -eq 'main') 'CHECKOUT_NOT_MAIN'
    Assert-Condition ((Invoke-GitText @('rev-parse', 'HEAD')).ToLowerInvariant() -eq $expectedSha) 'HEAD_SHA_MISMATCH'
    Assert-Condition ((Invoke-GitText @('rev-parse', 'origin/main')).ToLowerInvariant() -eq $expectedSha) 'ORIGIN_MAIN_SHA_MISMATCH'
    Assert-Condition ([string]::IsNullOrWhiteSpace((Invoke-GitText @('status', '--porcelain')))) 'WORKTREE_NOT_CLEAN'

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $database = @($config.d1_databases | Where-Object { $_.binding -eq 'DB' })
    Assert-Condition ($config.name -eq 'bento-api-poc') 'WRANGLER_WORKER_MISMATCH'
    Assert-Condition ($database.Count -eq 1) 'D1_BINDING_AMBIGUOUS'
    Assert-Condition ($database[0].database_name -eq 'bento-formal') 'D1_DATABASE_NAME_MISMATCH'
    Assert-Condition ($database[0].database_id -match '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') 'D1_DATABASE_ID_INVALID'
    Assert-Condition ($database[0].migrations_dir -eq 'migrations-formal') 'D1_MIGRATIONS_DIRECTORY_MISMATCH'

    $ownerUserId = Read-SecureValue -Prompt 'Canonical users.user_id from the authorized D1 inspection'
    $legacyEmployeeId = Read-SecureValue -Prompt 'Existing employee_id for the same canonical user'
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($ownerUserId)) 'CANONICAL_USER_ID_REQUIRED'
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($legacyEmployeeId)) 'LEGACY_EMPLOYEE_ID_REQUIRED'
    Assert-Condition ($ownerUserId.Length -le 200 -and $legacyEmployeeId.Length -le 200) 'OWNER_ID_INPUT_INVALID'

    $preflightSql = @'
SELECT
  (SELECT COUNT(*) FROM users WHERE user_id = {{OWNER_USER_ID}} AND UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))) AS selected_owner_count,
  (SELECT COUNT(*) FROM d1_migrations) AS total_migration_count,
  (SELECT COUNT(*) FROM d1_migrations WHERE name IN (
    '0015_invalid_employee_marker.sql',
    '0016_announcement_user_preferences.sql',
    '0017_protected_account_auth_audit.sql',
    '0018_vendor_principals_and_memberships.sql',
    '0019_vendor_order_settlements.sql',
    '0020_safe_vendor_order_identity_resolution.sql',
    '0021_verified_vendor_settlement_sources.sql'
  )) AS required_migration_count,
  (SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1) AS latest_migration,
  (SELECT COUNT(*) FROM users WHERE UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))) AS owner_count,
  (SELECT COUNT(*) FROM users WHERE user_id = {{OWNER_USER_ID}} AND active = 1) AS active_owner_count,
  (SELECT COUNT(*) FROM users WHERE user_id = {{OWNER_USER_ID}} AND active = 1 AND invalid_reason IS NULL AND role = 'User') AS eligible_owner_count,
  (SELECT COUNT(*) FROM users WHERE user_id = {{OWNER_USER_ID}} AND verification_status = 'UNVERIFIED') AS unverified_owner_count,
  (SELECT COUNT(*) FROM users owner JOIN users line_owner ON line_owner.line_user_id = owner.line_user_id WHERE owner.user_id = {{OWNER_USER_ID}} AND length(trim(COALESCE(owner.line_user_id, ''))) > 0) AS line_owner_count,
  (SELECT COUNT(*) FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1) AS enabled_vendor_count,
  (SELECT COUNT(*) FROM users WHERE UPPER(trim(employee_id)) = {{VENDOR_LOGIN_ID}}) AS employee_alias_collision_count,
  (SELECT COUNT(*) FROM vendor_principals WHERE UPPER(trim(vendor_login_id)) = {{VENDOR_LOGIN_ID}}) AS alias_principal_count,
  (SELECT COUNT(*) FROM vendor_principals principal WHERE principal.user_id = {{OWNER_USER_ID}} AND principal.vendor_login_id IS NULL AND principal.principal_role = 'Vendor' AND principal.status = 'ACTIVE') AS unassigned_active_principal_count,
  (SELECT COUNT(*) FROM vendor_principals principal WHERE principal.user_id = {{OWNER_USER_ID}} AND principal.vendor_login_id = {{VENDOR_LOGIN_ID}} AND principal.principal_role = 'Vendor' AND principal.status = 'ACTIVE') AS assigned_active_principal_count,
  (SELECT COUNT(*) FROM vendor_principals principal WHERE principal.user_id = {{OWNER_USER_ID}}) AS owner_principal_count,
  (SELECT COUNT(*) FROM protected_account_user_mappings WHERE account_key = 'RESERVED_VENDOR_OWNER') AS owner_mapping_count,
  (SELECT COUNT(*) FROM protected_account_user_mappings mapping WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER' AND mapping.user_id = {{OWNER_USER_ID}}) AS mapping_matches_owner_count,
  (SELECT COUNT(*) FROM protected_account_user_mappings mapping WHERE mapping.account_key <> 'RESERVED_VENDOR_OWNER' AND mapping.user_id = {{OWNER_USER_ID}}) AS owner_other_mapping_count,
  (SELECT COUNT(*) FROM vendor_memberships membership WHERE membership.user_id = {{OWNER_USER_ID}} AND membership.status = 'ACTIVE' AND membership.vendor_id <> (SELECT vendor_id FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1)) AS active_other_membership_count,
  (SELECT COUNT(*) FROM vendor_memberships membership WHERE membership.user_id = {{OWNER_USER_ID}} AND membership.vendor_id = (SELECT vendor_id FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1)) AS target_membership_count,
  (SELECT COUNT(*) FROM vendor_memberships membership WHERE membership.user_id = {{OWNER_USER_ID}} AND membership.vendor_id = (SELECT vendor_id FROM vendors WHERE name = {{VENDOR_NAME}} AND enabled = 1) AND membership.status = 'ACTIVE') AS active_target_membership_count
'@
    $preflightRows = @(Invoke-D1Query -Sql $preflightSql)
    Assert-Condition ($preflightRows.Count -eq 1) 'D1_PREFLIGHT_RESULT_INVALID'
    $preflight = $preflightRows[0]

    Assert-Condition ([int]$preflight.total_migration_count -eq 22) 'FORMAL_MIGRATION_SEQUENCE_INCOMPLETE'
    Assert-Condition ([int]$preflight.required_migration_count -eq 7) 'FORMAL_MIGRATIONS_NOT_CURRENT'
    Assert-Condition ([string]$preflight.latest_migration -eq '0021_verified_vendor_settlement_sources.sql') 'FORMAL_SCHEMA_NOT_CURRENT'
    Assert-Condition ([int]$preflight.selected_owner_count -eq 1) 'SELECTED_OWNER_MISMATCH'
    Assert-Condition ([int]$preflight.owner_count -eq 1) 'LEGACY_OWNER_NOT_UNIQUE'
    Assert-Condition ([int]$preflight.active_owner_count -eq 1) 'LEGACY_OWNER_NOT_ACTIVE'
    Assert-Condition ([int]$preflight.eligible_owner_count -eq 1) 'LEGACY_OWNER_STATE_UNEXPECTED'
    Assert-Condition ([int]$preflight.unverified_owner_count -eq 1) 'VERIFICATION_STATE_CHANGED'
    Assert-Condition ([int]$preflight.line_owner_count -eq 1) 'LINE_BINDING_NOT_UNIQUE'
    Assert-Condition ([int]$preflight.enabled_vendor_count -eq 1) 'CANONICAL_VENDOR_NOT_UNIQUE'
    Assert-Condition ([int]$preflight.employee_alias_collision_count -eq 0) 'VENDOR_LOGIN_ID_COLLIDES_EMPLOYEE_ID'
    Assert-Condition ([int]$preflight.alias_principal_count -le 1) 'VENDOR_LOGIN_ID_AMBIGUOUS'
    Assert-Condition ([int]$preflight.owner_principal_count -le 1) 'VENDOR_PRINCIPAL_AMBIGUOUS'
    Assert-Condition (([int]$preflight.owner_principal_count -eq 0) -or (([int]$preflight.unassigned_active_principal_count + [int]$preflight.assigned_active_principal_count) -eq 1)) 'VENDOR_PRINCIPAL_STATE_UNEXPECTED'
    Assert-Condition (([int]$preflight.alias_principal_count -eq 0) -or ([int]$preflight.assigned_active_principal_count -eq 1)) 'VENDOR_LOGIN_ID_OWNED_BY_OTHER_PRINCIPAL'
    Assert-Condition ([int]$preflight.owner_mapping_count -le 1) 'PROTECTED_OWNER_MAPPING_AMBIGUOUS'
    Assert-Condition (([int]$preflight.owner_mapping_count -eq [int]$preflight.mapping_matches_owner_count) -or ([int]$preflight.owner_mapping_count -eq 0)) 'PROTECTED_OWNER_MAPPING_MISMATCH'
    Assert-Condition ([int]$preflight.owner_other_mapping_count -eq 0) 'PROTECTED_OWNER_ALREADY_MAPPED'
    Assert-Condition ([int]$preflight.active_other_membership_count -eq 0) 'VENDOR_SCOPE_ALREADY_CROSSED'
    Assert-Condition ([int]$preflight.target_membership_count -le 1) 'VENDOR_MEMBERSHIP_AMBIGUOUS'
    Assert-Condition (([int]$preflight.target_membership_count -eq 0) -or ([int]$preflight.active_target_membership_count -eq 1)) 'VENDOR_MEMBERSHIP_NOT_ACTIVE'

    $identitySql = @'
SELECT user_id, employee_id, line_user_id, role, active, invalid_reason, verification_status
FROM users
WHERE user_id = {{OWNER_USER_ID}}
  AND UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}}))
'@
    $historySql = @'
SELECT
  (SELECT COUNT(*) FROM orders) AS order_count,
  (SELECT COALESCE(SUM(total_amount), 0) FROM orders) AS order_amount_total,
  (SELECT COUNT(*) FROM balance_ledger) AS ledger_count,
  (SELECT COALESCE(SUM(amount), 0) FROM balance_ledger) AS ledger_amount_total,
  (SELECT COALESCE(SUM(balance_after), 0) FROM balance_ledger) AS ledger_balance_total
'@
    $identityBefore = @(Invoke-D1Query -Sql $identitySql)
    $historyBeforeRows = @(Invoke-D1Query -Sql $historySql)
    Assert-Condition ($identityBefore.Count -eq 1) 'OWNER_READBACK_NOT_UNIQUE'
    Assert-Condition ($historyBeforeRows.Count -eq 1) 'HISTORY_SNAPSHOT_UNAVAILABLE'
    $historyBefore = $historyBeforeRows[0]

    Write-Host '[PASS] Clean main checkout and exact source SHA.'
    Write-Host '[PASS] Formal D1 target, migration sequence, unique active owner and existing LINE binding.'
    Write-Host '[PASS] UNVERIFIED state, Vendor login uniqueness and single canonical Vendor membership preflight.'

    if (-not $Apply) {
        Write-Host 'DRY_RUN: preflight passed; no D1 data was changed.'
        return
    }

    Assert-Condition ($ConfirmLegalLineOwner) 'LEGAL_LINE_OWNER_CONFIRMATION_REQUIRED'
    Assert-Condition ($ConfirmLegacyEmployeeLoginDisabled) 'LEGACY_EMPLOYEE_LOGIN_CONFIRMATION_REQUIRED'
    Assert-Condition ($ConfirmVendorLoginId) 'VENDOR_LOGIN_CONFIRMATION_REQUIRED'
    Assert-Condition ($PSBoundParameters.ContainsKey('Confirm')) 'EXPLICIT_POWERSHELL_CONFIRM_REQUIRED'
    if (-not $PSCmdlet.ShouldProcess('formal D1 vendor identity', 'Set the Vendor principal, membership and protected owner mapping')) {
        Write-Host 'USER_DECLINED: no D1 data was changed.'
        return
    }

    $conversionSqlPath = Join-Path $PSScriptRoot 'configure-vendor-owner.sql'
    $conversionTemplate = Get-Content -LiteralPath $conversionSqlPath -Raw -Encoding UTF8
    $expandedConversion = Expand-SqlTemplate -Sql $conversionTemplate
    $temporaryConversionPath = Write-TemporarySql -Sql $expandedConversion
    try {
        $null = Invoke-WranglerSqlFile -SqlPath $temporaryConversionPath
    } finally {
        Remove-Item -LiteralPath $temporaryConversionPath -Force -ErrorAction SilentlyContinue
    }

    $identityAfter = @(Invoke-D1Query -Sql $identitySql)
    $historyAfterRows = @(Invoke-D1Query -Sql $historySql)
    Assert-Condition ($identityAfter.Count -eq 1) 'OWNER_READBACK_NOT_UNIQUE'
    Assert-Condition ($historyAfterRows.Count -eq 1) 'HISTORY_READBACK_UNAVAILABLE'
    Assert-Condition ((ConvertTo-CompactJson $identityAfter[0]) -eq (ConvertTo-CompactJson $identityBefore[0])) 'CANONICAL_USER_OR_LINE_BINDING_CHANGED'
    Assert-Condition ((ConvertTo-CompactJson $historyAfterRows[0]) -eq (ConvertTo-CompactJson $historyBefore)) 'ORDER_OR_LEDGER_AGGREGATE_CHANGED'

    $readbackSql = @'
SELECT
  (SELECT COUNT(*) FROM protected_account_user_mappings mapping WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER' AND mapping.user_id = {{OWNER_USER_ID}}) AS owner_mapping_count,
  (SELECT COUNT(*) FROM vendor_principals principal WHERE principal.user_id = {{OWNER_USER_ID}} AND principal.vendor_login_id = {{VENDOR_LOGIN_ID}} AND principal.principal_role = 'Vendor' AND principal.status = 'ACTIVE') AS active_principal_count,
  (SELECT COUNT(*) FROM vendor_memberships membership JOIN vendors vendor ON vendor.vendor_id = membership.vendor_id WHERE membership.user_id = {{OWNER_USER_ID}} AND vendor.name = {{VENDOR_NAME}} AND vendor.enabled = 1 AND membership.status = 'ACTIVE') AS active_target_membership_count,
  (SELECT COUNT(*) FROM vendor_memberships membership JOIN vendors vendor ON vendor.vendor_id = membership.vendor_id WHERE membership.user_id = {{OWNER_USER_ID}} AND membership.status = 'ACTIVE' AND vendor.name <> {{VENDOR_NAME}}) AS active_other_membership_count,
  (SELECT COUNT(*) FROM users WHERE user_id = {{OWNER_USER_ID}} AND UPPER(trim(employee_id)) = UPPER(trim({{LEGACY_EMPLOYEE_ID}})) AND role = 'User' AND active = 1 AND invalid_reason IS NULL AND verification_status = 'UNVERIFIED' AND length(trim(COALESCE(line_user_id, ''))) > 0) AS unchanged_owner_count
'@
    $readbackRows = @(Invoke-D1Query -Sql $readbackSql)
    Assert-Condition ($readbackRows.Count -eq 1) 'CONVERSION_READBACK_UNAVAILABLE'
    $readback = $readbackRows[0]
    Assert-Condition ([int]$readback.owner_mapping_count -eq 1) 'PROTECTED_OWNER_MAPPING_READBACK_FAILED'
    Assert-Condition ([int]$readback.active_principal_count -eq 1) 'VENDOR_PRINCIPAL_READBACK_FAILED'
    Assert-Condition ([int]$readback.active_target_membership_count -eq 1) 'VENDOR_MEMBERSHIP_READBACK_FAILED'
    Assert-Condition ([int]$readback.active_other_membership_count -eq 0) 'VENDOR_SCOPE_READBACK_FAILED'
    Assert-Condition ([int]$readback.unchanged_owner_count -eq 1) 'OWNER_STATE_READBACK_FAILED'
    Write-Host 'USER_EXECUTION_VERIFIED: Vendor identity, LINE ownership, verification state, vendor scope, and order/ledger aggregates passed readback.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {
    $ownerUserId = $null
    $legacyEmployeeId = $null
    $vendorLoginId = $null
}
