# Project Patterns
<!-- CC10X MEMORY CONTRACT: Do not rename headings. Used as Edit anchors. -->

## Architecture Patterns
- Config values: exported constants in src/config.ts, read from process.env first, fall back to default
- Env vars: loaded via readEnvFile() in src/env.ts, but process.env takes precedence
- Secrets (API keys): NOT in src/config.ts — loaded directly in container-runner.ts to avoid leaking

## Code Conventions
- All config exports are top-level named exports in src/config.ts
- POSIX env var TZ= controls timezone; Node.js reads it at startup automatically

## File Structure
- Config: src/config.ts
- Env template: .env.example (at project root)
- Live env: /opt/nanoclaw/.env on VM (not in git)
- Deploy scripts: deploy/ directory

## Testing Patterns
- Config-only changes: no unit tests needed; verify via systemctl status + env inspection

## Common Gotchas
- systemd service uses EnvironmentFile=/opt/nanoclaw/.env — env vars from that file ARE injected into the process; no changes to .service unit needed for new env vars
- .env.example is the template; actual /opt/nanoclaw/.env on VM must be edited separately (not synced by deploy-changes.sh)
- Asia/Jerusalem is the correct IANA name for Israel time (includes DST rules automatically)

## API Patterns
- N/A

## Error Handling
- N/A

## Dependencies
- Node.js: respects TZ env var at process startup (no code changes required to use it)
