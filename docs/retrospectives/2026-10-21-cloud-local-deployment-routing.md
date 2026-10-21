# 2026-10-21 — Cloud / Local Worker release routing

- Issue: #104, #139. PR: #142.
- Problem: Codex Cloud shell observed curl exit 7/HTTP 000, connector internal error, Wrangler unauthenticated; the same block repeatedly prevented formal release. None proves Cloudflare API universally or permanently unavailable.
- Research: official Cloudflare Workers Builds Git integration, production branch selection and custom build/deploy configuration documented at https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/ , https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/ and https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ . Workers Builds is not GitHub Actions.
- Fix: Add mandatory runtime capability matrix and bounded path-selection/fallback to AGENTS.md. Builders must not turn on unconditional main auto-deploy or bypass D1 backup/migration/identity gates.
- Verification actually performed: fetched AGENTS.md from GitHub main and created documentation-only branch/PR. No CI, PII_SCAN, independent review or deployment attempted in this turn; all NOT RUN. No production changes.
- Remaining: independent reviewer, PII_SCAN and documentation checks; inspect existing Worker Builds configuration and formal backup/migration gates before any runtime deployment.
- P1 recommendation: build a fail-closed Cloudflare Builds release command and verify it against isolated environment before enabling production-branch automation; otherwise use a separately authorized direct CLI/API release host.
