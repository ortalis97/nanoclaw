# Alfred — Personal WhatsApp AI Assistant

A personal fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) running as a 24/7 WhatsApp bot named **Alfred**, deployed on Oracle Cloud Always Free.

For general NanoClaw documentation, architecture, and philosophy see the [upstream repo](https://github.com/qwibitai/nanoclaw).

---

## This Fork

| | |
|-|--|
| **Bot name** | Alfred |
| **Trigger** | `@Alfred` |
| **VM** | Oracle Cloud Always Free (see `deploy/deploy.conf`) |
| **App path** | `/opt/nanoclaw` |
| **WhatsApp number** | configured at pairing time |
| **Timezone** | `Asia/Jerusalem` |

### Registered Chats

| Chat | Folder | Trigger required |
|------|--------|-----------------|
| Self-chat (admin) | `main` | No |
| Personal DM (owner) | `personal` | No |

Chats auto-register on first message — no manual CLI registration needed — as long as the sender (or any group member) is in the sender allowlist.

### Sender Allowlist

Access control is configured via `~/.config/nanoclaw/sender-allowlist.json` (outside the project root, never mounted into containers). If the file is missing, all non-self messages are denied (fail-closed).

**Schema:**
```json
{
  "default": { "allow": ["<OWNER_PHONE>@s.whatsapp.net", "<ALLOWED_PHONE_2>@s.whatsapp.net"], "mode": "drop" },
  "chats": {
    "120363XXXXXXXX@g.us": { "allow": "*", "mode": "drop" }
  },
  "logDenied": true
}
```

| Field | Values | Meaning |
|-------|--------|---------|
| `allow` | `"*"` or array of JIDs | Who can interact. JIDs are `<phone>@s.whatsapp.net` |
| `mode` | `"drop"` or `"trigger"` | `drop` = silently discard messages from non-allowed senders; `trigger` = accept messages but block triggering the agent |
| `chats` | per-JID overrides | Overrides `default` for specific chats or groups |
| `logDenied` | `true` / `false` | Log debug messages for denied senders |

**Group membership awareness:** In group chats, if **any** group member is on the allowlist, messages from **all** members are accepted — including non-listed contacts. The group participant list is cached on startup and refreshed automatically when membership changes. DMs still require an exact sender match.

Configure your allowed contacts in `~/.config/nanoclaw/sender-allowlist.json`. DMs from other numbers are silently dropped; groups are active as long as an allowed contact is a member.

---

## Custom Features (not in upstream)

### Image Understanding
Alfred receives WhatsApp images, saves them to `groups/<folder>/images/`, and passes the file path to the agent so it can read and analyze the image content. In group chats, images are accepted from any member if the group has an allowed contact; in DMs, only the allowed sender's images are downloaded.

**Cleanup:** Images older than 30 days are automatically deleted weekly. The cleanup runs once at startup and then every 7 days.

Relevant files: `src/transcription.ts` (`saveImageToGroup`), `src/image-cleanup.ts`

---

### Sending Files to WhatsApp

Alfred can send files from its workspace directly to WhatsApp using the `send_file` MCP tool. The agent specifies a path inside `/workspace/group/` and an optional caption; the host reads the file and delivers it via the appropriate WhatsApp message type.

**Usage (agent-side):**
```
send_file({ path: "/workspace/group/report.pdf", caption: "Here's the report" })
send_file({ path: "/workspace/group/chart.png" })
```

**Allowed file types:** images (`jpg`, `jpeg`, `png`, `gif`, `webp`), documents (`pdf`, `txt`, `md`, `csv`, `py`, `js`, `ts`, `yaml`, `yml`, `html`, `zip`), video (`mp4`, `mov`), audio (`mp3`, `ogg`, `wav`, `m4a`).

**Size limits:** 16 MB for images, 100 MB for all other files.

Files are automatically copied to `groups/<folder>/outbox/` for cleanup tracking (same 30-day retention as images). If delivery fails after 3 attempts, Alfred notifies the chat with the workspace path so the user can retrieve it manually.

Relevant files: `src/file-sending.ts`, `src/ipc.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`

---

### Voice Message Transcription
Incoming WhatsApp voice notes (PTT) are automatically transcribed via OpenAI Whisper and forwarded to the agent as text. Requires `OPENAI_API_KEY` in `.env`.

Relevant file: `src/transcription.ts` (`transcribeAudioMessage`)

---

### Outgoing Voice Messages (TTS)
Alfred can reply with voice messages. The agent triggers TTS via an IPC command; audio is synthesized via OpenAI TTS and sent as a WhatsApp voice note. Falls back to text if synthesis fails. Requires `OPENAI_API_KEY` in `.env`.

Relevant files: `src/tts.ts`, `src/ipc.ts`

---

### OAuth-First Authentication
When an Anthropic OAuth token is present, it takes priority over the `ANTHROPIC_API_KEY`. The API key is withheld from the container environment when OAuth is active. Configured via `ANTHROPIC_OAUTH_TOKEN` in `.env`.

Relevant file: `src/container-runner.ts`

---

### Notion MCP Server
The agent container includes the Notion MCP server, giving Alfred read/write access to Notion pages and databases. Requires `NOTION_API_KEY` in `.env`.

Relevant file: `container/Dockerfile`

---

### Hebrew Trigger Support
Alfred responds to his Hebrew name in addition to `@Alfred`. Set `ASSISTANT_HEBREW_NAME` in `.env` to enable. The trigger matches anywhere in the message (not just the start) with Unicode-aware word boundaries.

Relevant file: `src/config.ts`

---

### GitHub Issues Reporting
Alfred can file bugs, todos, and observations as GitHub Issues with the `alfred` label. Requires `GITHUB_TOKEN` in `.env` and the `gh` CLI available in the container.

---

### Configurable Agent Model
The Claude model used by agent containers is controlled via `AGENT_MODEL` in `.env` (e.g. `claude-haiku-4-5-20251001` for lower cost). Defaults to the SDK default (Sonnet) when unset.

Relevant file: `src/config.ts`

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
# SSH to VM (credentials in deploy/deploy.conf)
source deploy/deploy.conf && ssh -i $DEPLOY_KEY $DEPLOY_HOST

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
| `src/image-cleanup.ts` | Weekly cleanup of images/files older than 30 days |
| `src/file-sending.ts` | File type validation, MIME mapping, size limits |
| `src/transcription.ts` | Voice transcription (Whisper) + image save |
| `src/tts.ts` | Outgoing voice message synthesis (OpenAI TTS) |
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
