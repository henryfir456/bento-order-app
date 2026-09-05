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
   Identify all pre-existing uncommitted changes. Treat unexplained
   staged, unstaged, and untracked work present at the start as
   user-owned unless proven otherwise.
6. Confirm the requested task scope and identify any direct collision
   between the planned files and pre-existing work. Stop that portion and
   report the collision instead of resolving it by guessing. If a target
   file already contains user changes, preserve them and edit around
   those changes.
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

## Output

Report the repository root, instruction and manifest paths read, Git
pre-existing changes, planned files, required skills found or missing,
scope collisions, and whether governed mutation is allowed.

The presence of a command or a Skill version in agent.yaml is not user
authorization to run it. Authorization still comes from the current task
and applicable repository instructions.
