---
name: ap-safe-preflight
description: Run before mutation in a repository to identify its root and instructions, inspect Git state, validate the Agent manifest and declared skill paths, protect user-owned changes, and fail closed when required governance inputs are missing.
metadata:
  version: "0.2.0"
---

# ap-safe-preflight

Run this skill before editing files, executing project scripts, building,
testing, installing, using a device, or deploying.

## Procedure

1. Identify the repository root with the repository's Git tooling. Do not
   assume that the current working directory or a parent workspace is the
   root.
2. Read the applicable root AGENTS.md and any closer applicable
   AGENTS.override.md or AGENTS.md files. Do not replace a missing
   manifest-declared skill with a parent or global instruction file.
3. Read the root agent.yaml before mutation. Validate that
   schema_version is 2 and that the manifest uses only the schema-2
   fields:
   schema_version, project, shared_source, shared_skills,
   project_skills, commands, and verification.
   Require shared_source.repository to be present and require
   shared_source.ref to be present and non-empty. The ref is a declared
   release identity; do not resolve it to a SHA at runtime.
4. Reject an unknown schema version, unknown field, malformed required
   value, absolute path, path containing a parent escape, symlink or
   reparse-point path, or path outside the repository.
5. Inspect and record the current Git state:
   - git status
   - git diff
   - git diff --cached
   - relevant untracked files
   Build a start-state ledger that separates:
   - pre-existing user changes present before this Agent's work;
   - changes the current task is expected to make;
   - stale tests or expectations that describe older behavior; and
   - unknown or potentially conflicting changes.
   Record which items were present before preflight. Pre-existing user
   changes are evidence, not defects. They must be checked for
   consistency, scope, and risk; do not assume that every pre-existing
   diff is either correct or defective.
6. Confirm the requested task scope and identify any direct collision
   between the planned files and pre-existing work. A direct collision is
   an actual conflict with the requested behavior or an unclear/incomplete
   change, not mere overlap with an existing user change. Stop that
   portion and report the collision instead of resolving it by guessing.
   If a target or adjacent file already contains user changes, preserve
   the user's intent and edit around those changes.
   Do not stop or require approval merely to preserve an already-existing
   user change, align a stale test or expectation with confirmed current
   repository behavior, or perform verification-only cleanup that does
   not change production behavior.
   Limit edits to files and lines required by the current task. Do not
   revert, overwrite, discard, normalize, reformat, or clean unrelated
   work.
7. Resolve only the exact repo-relative paths explicitly declared in
   agent.yaml. Each required skill must contain a readable SKILL.md.
   Never search by name for a global, parent, plugin, latest, or
   agent-platform replacement.
8. For every shared_skills entry, validate all of the following:
   - id is the Skill name declared by the target SKILL.md
   - version is an exact semantic version with no range operator
   - path exists and resolves within the repository
   - the path is not an unsafe symlink or reparse-point escape
   - SKILL.md exists and declares metadata.version
   - metadata.version exactly equals shared_skills[].version
   A mismatch is a contract failure.
9. If the manifest, shared source ref, a required skill, a required
   version field, or a required validation input is missing or invalid,
   allow read-only diagnosis only. Do not edit, overwrite, clean,
   execute project scripts, build, test, use a device, commit, push, or
   deploy under an incomplete governed workflow.
10. Preserve all pre-existing user work. Do not reset, revert, clean,
    overwrite, or broaden the task to unrelated files.

## Existing changes, stale expectations, and approval

`Pre-existing user changes are evidence, not defects.` Preserve them and
include them in the reasoning and final handoff. Never automatically
revert, overwrite, discard, or "repair" an existing change solely because
the Agent did not create it.

When all of the following are supported by evidence:

- the repository or production-facing current state is internally
  consistent;
- the change was present before the Agent started;
- build or relevant static verification does not show a production defect;
  and
- a failing test or expectation clearly describes the old behavior;

first consider whether the verification expectation is stale. Updating a
test or baseline to match the confirmed current contract is allowed when
within task scope; do not revert the current production state just to
silence a stale expectation. This preservation, stale-expectation
alignment, or verification-only cleanup does not by itself require an
additional approval gate.

Stop and request clarification or approval when the existing change
directly conflicts with the task, appears incomplete or partially applied,
raises a security, authentication, migration, data-integrity, or
irreversible-behavior concern, would make a test hide a production bug, or
leaves the intended contract unclear. An unresolved risk is not made safe
by labeling it pre-existing.

## Output

Report the repository root, instruction and manifest paths read, Git
pre-existing changes, current-task changes, stale expectations, unresolved
risks, planned files, required skills found or missing, scope collisions,
any approval or clarification decision, and whether governed mutation is
allowed.

The presence of a command or a Skill version in agent.yaml is not user
authorization to run it. Authorization still comes from the current task
and applicable repository instructions.
