# Active Context
<!-- CC10X: Do not rename headings. Used as Edit anchors. -->

## Current Focus
Default NanoClaw timezone to Asia/Jerusalem via .env.example and live VM .env

## Recent Changes
- Plan saved: docs/plans/2026-03-03-default-timezone-israel-plan.md

## Next Steps
1. Execute plan: docs/plans/2026-03-03-default-timezone-israel-plan.md
   - Phase 1: Edit .env.example locally + commit
   - Phase 2: SSH to VM, add TZ= to /opt/nanoclaw/.env, restart service
   - Phase 3: Run deploy/deploy-changes.sh

## Decisions
- No src/config.ts change needed: TIMEZONE already reads process.env.TZ (line 63-64)
- TZ= is the POSIX standard var; Node.js respects it at process start automatically
- systemd EnvironmentFile injects .env vars — no service unit changes needed

## Learnings
- src/config.ts already exports TIMEZONE = process.env.TZ || system fallback
- .env.example does not yet have a TZ= entry
- /opt/nanoclaw/.env on the VM is the live config that needs the line added

## References
- Plan: `docs/plans/2026-03-03-default-timezone-israel-plan.md`
- Design: N/A
- Research: N/A

## Blockers
- None

## Last Updated
2026-03-03
