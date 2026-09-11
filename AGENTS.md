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

## Verification

The commands and required order are declared in agent.yaml. Project
skills may add domain-specific checks, but no parent-workspace file is
required.

