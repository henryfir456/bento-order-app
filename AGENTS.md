# AGENTS.md

This file applies only to the 80_bento-order-app repository. It is
self-contained and must not depend on the AI parent workspace.

## Bootstrap

1. Find this repository's Git root.
2. Read the root agent.yaml before mutation.
3. Validate the supported schema and resolve only the repo-relative skill
   paths explicitly declared there.
4. Use the declared ap-safe-preflight and ap-verification-core skills for
   their detailed workflows.

## Safety floor

- Protect every staged, unstaged, and untracked change that exists before
  the current task.
- Never reset, revert, overwrite, or clean unrelated user work.
- Missing agent.yaml, an unsupported schema, an unknown field, an invalid
  path, or a missing required skill permits read-only diagnosis only.
- Never substitute a global, parent, plugin, latest, or differently
  located skill for a missing manifest-declared skill.
- A command listed in agent.yaml is not authorization to execute it.
- Commit, push, and deploy only when explicitly requested by the current
  user.
- Report automated and manual verification separately as PASS, FAIL,
  NOT RUN, or NOT VERIFIED.

## Operational Handoff

- Optional advisory handoff: `../agent-handoff/projects/80_bento-order-app/CURRENT.md`.
- The handoff contains advisory / operational state only; it is not a source
  of truth or a required dependency for this repository.
- After reading the handoff, reconcile it with this consumer repository's
  actual Git state before starting implementation.
- If the handoff conflicts with code, tests, durable specs, or Git state, the
  consumer repository's actual state wins. Do not modify this repository to
  make it match an old handoff.
- Update the handoff only for a material operational state change or a session
  handoff. An update is not required for every commit.

## Bento project contract

- Active production architecture is Cloudflare Worker + D1. The Worker
  formal runtime is the only production backend and all new capabilities
  must be implemented there.
- GAS is fully retired. Files under `gas/`, the GAS adapter, and GAS tests
  are legacy artifacts and regression evidence only. Do not add GAS API,
  identity/auth logic, Sheet contracts, or business logic unless the user
  explicitly authorizes a legacy change.
- The frontend is a React/Vite application. `VITE_LIFF_ID` and
  `VITE_WORKER_API_URL` are local configuration inputs; do not commit
  secrets or replace them with machine-specific paths.
- Preserve the separation between authenticated identity, View As
  identity, and effective identity.
- Preserve the existing LIFF authentication, access-token, Worker
  authorization, and D1 contracts when changing either side.
- Real LIFF authentication, View As behavior, Worker deployment, and
  production D1 behavior require manual or external evidence and must not
  be reported as verified from local static checks. GAS deployment is not a
  production verification target.

## Retired transport governance

Cloudflare Worker + D1 is the sole production transport and source of truth
for identity, authorization, balances, and new feature behavior. The
frontend may retain an explicit GAS adapter only as a bounded legacy seam for
regression evidence; omitted transport configuration defaults to Worker.
Never recreate a second identity source of truth for transport parity.

## Historical migration continuation governance

Historical migration tasks are execution tasks by default, not rediscovery
tasks. Do not broaden into root-cause investigation, repository-wide
analysis, or workflow redesign unless a concrete validation failure requires
it.

This repository-local policy supplements the declared `ap-safe-preflight` and
`ap-verification-core` skills. It must not be implemented by editing
`.agents/skills/**`: those files are upstream-managed agent-platform
dependencies and future upgrades must be able to sync without overwriting
this policy.

### Preflight modes

Every historical migration execution must report one of these modes as
`PREFLIGHT_MODE=FULL` or `PREFLIGHT_MODE=FAST`.

`FULL_PREFLIGHT` is run only when at least one of these conditions is true:

- this is the first migration session on the machine;
- the machine changed;
- the repository branch or `HEAD` changed unexpectedly;
- the schema or migration version changed;
- the remote D1 target or UUID changed;
- declared governance or skill paths/versions changed; or
- `FAST_PREFLIGHT` detects an inconsistency.

Before applying a new schema migration, `FULL_PREFLIGHT` is required once.
`FULL_PREFLIGHT` may validate the repository root, branch, working tree,
`AGENTS.md`, `agent.yaml`, declared skills and versions, the remote D1 target
and UUID, migrations/schema, and relevant repository migration contracts.
When `FULL` is used even though `FAST` would otherwise be sufficient, report
the exact escalation reason alongside `PREFLIGHT_MODE=FULL`.

For continuation of an already-approved historical import in the same
validated environment and session, `FAST_PREFLIGHT` is the default. It must
check only:

1. the expected repository and branch;
2. no unexpected working-tree changes;
3. the exact remote D1 target, including UUID, remains unchanged;
4. the expected migration/schema version remains unchanged;
5. current remote overlap/count for the domain being mutated; and
6. minimal FK, duplicate, and conflict checks relevant to that domain.

`FAST_PREFLIGHT` must explicitly skip repeated `AGENTS.md` validation,
repeated `agent.yaml` validation, repeated declared-skill/version validation,
repository-wide documentation scans, completed migration domains, unrelated
tables/domains, regeneration of an already-approved semantic plan, and broad
historical-source rediscovery. If a FAST check is inconsistent, stop and
escalate to `FULL_PREFLIGHT` before continuing.

### Approved-plan continuation

Once a historical domain has an explicitly approved semantic plan, execution
must use its frozen approved semantic set. Do not regenerate or reinterpret
the planner before each batch. Differences in provenance or evidence
serialization do not invalidate the approved semantic set. Only
mutation-relevant semantic drift may stop execution; drift that changes a
mutation target, operation, value, identity/ownership, dependency, or
conflict status requires stopping for review.

### Batch and domain transitions

During a historical import, do not run `FULL_PREFLIGHT` or a repository-wide
preflight between batches. Use only bounded mutation checks and cumulative
reconciliation. If a write result is ambiguous, stop and reconcile remote
state before retrying.

When moving between historical domains, such as Likes -> Orders -> Wallet,
run `FAST_PREFLIGHT` for the new domain unless a `FULL_PREFLIGHT` escalation
condition is present. Completed domains and unrelated tables remain outside
that new-domain FAST scope.

After a new schema migration has been successfully applied and verified,
subsequent historical data import against that unchanged schema returns to
`FAST_PREFLIGHT`.

## GAS verification policy

GAS_VERIFICATION_POLICY=NON_BLOCKING_LEGACY

GAS is a retired legacy transport for the current Worker/D1 path. GAS-only
runtime and business-behavior tests are non-blocking for Worker/D1 schema
migrations and historical imports. Do not run GAS-only suites as required
gates unless the task explicitly modifies GAS runtime behavior. Do not
investigate, baseline, fix, or attribute GAS-only failures unless explicitly
requested. Parsing `gas/bento_script.sql` for historical migration evidence
remains in scope and must stay validated.

This policy is repository-local and composes with the declared upstream
agent-platform skills. Do not modify shared agent-platform skill contents.

## Verification

The commands and required order are declared in agent.yaml. Project
skills may add domain-specific checks, but no parent-workspace file is
required.

