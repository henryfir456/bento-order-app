---
name: ap-safe-preflight
description: Run before mutation in a repository to identify its root and instructions, inspect Git state, validate the Agent manifest and declared skill paths, protect user-owned changes, and fail closed when required governance inputs are missing.
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
   schema_version is supported and that the manifest uses only the v0.1
   fields:
   schema_version, project, shared_source, shared_skills,
   project_skills, commands, and verification.
4. Reject an unknown schema version, unknown field, malformed required
   value, absolute path, path containing a parent escape, symlink or
   reparse-point path, or path outside the repository.
5. Inspect and record the current Git state:
   - git status
   - git diff
   - git diff --cached
   - relevant untracked files
   Treat staged, unstaged, and untracked work present at the start as
   pre-existing user-owned changes.
6. Confirm the requested task scope and identify any direct collision
   between the planned files and pre-existing work. Stop that portion and
   report the collision instead of resolving it by guessing.
7. Resolve only the exact repo-relative paths explicitly declared in
   agent.yaml. Each required skill must contain a readable SKILL.md.
   Never search by name for a global, parent, plugin, latest, or
   agent-platform replacement.
8. If the manifest, a required skill, or a required validation input is
   missing or invalid, allow read-only diagnosis only. Do not edit,
   overwrite, clean, execute project scripts, build, test, use a device,
   commit, push, or deploy under an incomplete governed workflow.
9. Preserve all pre-existing user work. Do not reset, revert, clean,
   overwrite, or broaden the task to unrelated files.

## Output

Report the repository root, instruction and manifest paths read, Git
pre-existing changes, planned files, required skills found or missing,
scope collisions, and whether governed mutation is allowed.

The presence of a command in agent.yaml is not user authorization to run
it. Authorization still comes from the current task and applicable
repository instructions.

