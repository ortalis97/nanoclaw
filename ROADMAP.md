# Roadmap

## Next Steps

- [ ] ...

## Ideas

- [ ] ...

## Bugs

- [ ] ...

## Decisions

- **Sensitive values in README/CLAUDE.md** — VM IP, phone number, and SSH key path are stored in plaintext in `README.md` and `CLAUDE.md`. Acceptable because the repo is private. If the repo ever goes public, move these to a gitignored `deploy/local.md` and reference it from `CLAUDE.md`.

## Done

- [x] Oracle Cloud VM deployment (systemd + logrotate + daily backup)
- [x] Sender allowlist (`ALLOWED_SENDERS`) — auto-register on first message
- [x] Default timezone `Asia/Jerusalem` for scheduled tasks
- [x] Renamed assistant from Andy to Alfred
