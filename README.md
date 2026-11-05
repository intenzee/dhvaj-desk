# Dhvaj Desk

A chartered accountants' firm run from team chat. Claude Code agents work the
Dhvaj Portal's live data in [Switch](https://github.com/sandbox-quantum/switch)
rooms next to the firm's people, through one MCP server, `dhvaj-mcp`. People
approve anything that is signed, filed or sent to a client.

| Agent | Room | Does |
|---|---|---|
| dhvaj-desk | #firm-ops, #compliance-desk | morning brief, what is due, assigns filings, quick tasks |
| dhvaj-chaser | #client-chase | drafts client reminders; sends only on a person's *send* |
| dhvaj-reviewer | #review-queue, #partner-signoff | first-pass review, return or pass, sign-off packs |

Each agent is signed in to the portal as **its own portal user**, so the
portal's roles and row-level security decide what it may do. A senior cannot
mint upload links, only a stream lead may assign, and only a partner signs.

The portal talks back in two ways:
- **Notification channel:** reviews, returns, uploads, client chases and
  sign-offs post into the right room as `dhvaj-portal`.
- **Live bridge:** a quick task given to an agent in the portal, or a reply to
  one it gave, reaches the agent in its room.

## Run the Core demo

You need the Dhvaj Portal API (branch `switch-integration`) on :3101 with the
demo story seeded, and a Switch server.

```sh
npm install
npm run seed                     # the demo story: Sharma Traders, Acme Exports, the Mehtas
npm run test:mcp                 # every dhvaj-mcp tool, end to end
npm run agents                   # builds agents/<name>/ with each agent's .mcp.json
```

1. Deploy the template: `npm run deploy` (or, in Switch Console, deploy
   `switch/dhvaj-desk.template.yaml` with `checkout` set to this folder).
2. Connect the portal to the rooms: `npm run connect`.
   With Switch Console's own local server both find the server and its local
   admin login by themselves; for any other server set `SWITCH_URL`,
   `SWITCH_EMAIL` and `SWITCH_PASSWORD`.
   Start the portal API with the env it prints (`NOTIFICATION_CHANNELS=portal,switch`, `SWITCH_*`).
3. Start the bridge: `npm run bridge`.

## Layout

- `mcp/server.mjs` — dhvaj-mcp: 17 tools over the portal API; `chase_send`
  refuses without `approval: {by, messageLink}` from a person.
- `mcp/smoke.mjs` — drives every tool as three different agents.
- `switch/dhvaj-desk.template.yaml` — 3 agents, 5 linked rooms, kickoffs
  (passes Switch's `template_lint`).
- `switch/deploy.mjs` — deploys the template (agents, then rooms).
- `switch/connect.mjs` — registers `dhvaj-portal` and adds it to the rooms.
- `bridge/bridge.mjs` — the portal's live stream → the agents' rooms.
- `seed/demo-story.mjs` — the demo firm's clients and filings.
