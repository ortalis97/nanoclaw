# Alfred — Personal WhatsApp AI Assistant

A personal fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) running as a 24/7 WhatsApp bot named **Alfred**, deployed on Oracle Cloud Always Free.

For general NanoClaw documentation, architecture, and philosophy see the [upstream repo](https://github.com/qwibitai/nanoclaw).

---

## This Fork

| | |
|-|--|
| **Bot name** | Alfred |
| **Trigger** | `@Alfred` |
| **VM** | Oracle Cloud Always Free — `ubuntu@VM_IP_REDACTED` |
| **App path** | `/opt/nanoclaw` |
| **WhatsApp number** | `+ALFRED_PHONE_REDACTED` (eSIM) |
| **Timezone** | `Asia/Jerusalem` |

### Registered Chats

| Chat | Folder | Trigger required |
|------|--------|-----------------|
| Self-chat (admin) | `main` | No |
| Personal DM (Or) | `personal` | No |

Chats auto-register on first message — no manual CLI registration needed — as long as the sender is in `ALLOWED_SENDERS`.

### Sender Allowlist

Only Or (`OWNER_PHONE_REDACTED`) and Maya (`ALLOWED_PHONE_2_REDACTED`) can interact with Alfred. DMs from other numbers are silently dropped; groups only respond if Or or Maya are members. Configured via `ALLOWED_SENDERS` in `.env`.

---

## Day-to-Day Workflow

```bash
# Make changes locally
git add <files> && git commit -m "description"
bash deploy/deploy-changes.sh

# When container/Dockerfile changes (takes 10–15 min)
bash deploy/deploy-changes.sh --rebuild-docker
```

```bash
# SSH to VM
ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED

# Service management
sudo systemctl status nanoclaw
sudo systemctl restart nanoclaw
tail -f /opt/nanoclaw/logs/nanoclaw.log
tail -f /opt/nanoclaw/logs/nanoclaw.error.log
```

---

## First-Time Deployment

See [`deploy/README.md`](deploy/README.md) for the full VM setup walkthrough (Phases 1–5).

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — message loop, agent orchestration |
| `src/config.ts` | Config loaded from `.env` |
| `src/channels/whatsapp.ts` | WhatsApp connection (Baileys) |
| `src/container-runner.ts` | Docker agent spawn + IPC |
| `src/task-scheduler.ts` | Scheduled tasks (cron/interval/once) |
| `src/db.ts` | SQLite — messages, groups, sessions, tasks |
| `groups/*/CLAUDE.md` | Per-group memory for Alfred |
| `deploy/` | VM deployment scripts |
| `.env.example` | Environment template |

---

## Roadmap & Ideas

See [`ROADMAP.md`](ROADMAP.md).

---

## License

MIT — based on [NanoClaw](https://github.com/qwibitai/nanoclaw) by Gavriel.
