# AMP Memory PoC

Bento is an opt-in pilot consumer for the agent-platform AMP memory experiment.

Current status: **disabled**.

## Boundaries

This experiment does not change Bento runtime behavior.

It does not:

- change `agent.yaml` schema 2;
- change shared-Skill versions;
- install AMP hooks;
- change authentication or authorization;
- mutate D1;
- deploy frontend or Worker code;
- automatically capture memories.

The local policy is:

`.agents/experiments/amp-memory-policy.yaml`

The canonical experiment design and A/B task set live in agent-platform:

- `docs/experiments/amp-memory-poc.md`
- `docs/experiments/bento-amp-pilot.md`
- Issue #1 in `henryfir456/agent-platform`

## Source-of-truth rule

If recalled memory conflicts with the current repository, the repository wins.

```text
AGENTS / Skills          = HOW TO WORK
Bento canonical docs     = WHAT IS TRUE NOW
AMP memory               = WHAT WE LEARNED BEFORE
```

Current state remains owned by `PROJECT_STATE.md`, `DECISIONS.md`,
`REPO_FACTS.md`, `CHANGELOG.md`, configuration, schema, and code.

## Activation requirement

Do not switch `enabled` or recall to `true` until:

1. a separate memory repository exists;
2. seed memories have been manually reviewed;
3. no secret/private-user-data exposure is present; and
4. a paired CONTROL / MEMORY task is ready to run.

Activation is an experiment toggle, not production deployment.
