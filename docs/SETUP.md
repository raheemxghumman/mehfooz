# Setup — reproduce Mehfooz from scratch

The UI in this repository runs out of the box as a **local simulation** (nothing leaves your browser). This
guide wires it to a real Fastn backend with your own Notion, Slack and Gmail.

> **You need:** a [Fastn](https://fastn.ai) workspace, a Notion workspace, a Slack workspace, a Gmail account, and
> Python 3 (only to serve the static UI).

## 1 · Fastn workspace and MCP

1. Create a Fastn workspace.
2. Add Fastn's MCP server to your AI client. This repository already contains the config in
   [`.mcp.json`](../.mcp.json):
   ```json
   { "mcpServers": { "fastn": { "type": "http", "url": "https://mcp.fastn.dev" } } }
   ```
3. Authorize it (OAuth) when your client prompts you.

## 2 · Notion — the system of record

Create a database called **`Cases`** with these columns:

| Column | Type | Options |
|---|---|---|
| `Case Number` | Title | — |
| `Status` | Select | `Received` · `Under Inquiry` · `Escalated` · `Closed` |
| `Severity` | Select | `Low` · `Medium` · `High` |
| `Tenant` | Text | — |
| `Reported At` | Date | — |
| `Deadline` | Date | — |
| `Breach` | Checkbox | — |
| `Delivery Status` | Select | `OK` · `PARTIAL` · `FAILED` |

Connect Notion in Fastn and **share that database** on Notion's consent screen ("Select pages").

> There is deliberately **no column for the reporter.**

## 3 · Slack — two channels

1. Create `#mehfooz-committee` (the inquiry committee) and `#mehfooz-authority` (the Competent Authority).
2. Connect Slack in Fastn.
3. In **both** channels run `/invite @fastn` — the bot can only post where it is a member.

## 4 · Gmail — send-only

Connect Gmail with the **`gmail.send`** scope only.

> Google blocks the connector's default full-mailbox scopes for unverified apps (*"This app is blocked"*).
> Requesting the single send-only scope gets through — and it is all Mehfooz needs.

## 5 · Workflows

Create the four workflows from [`workflows/`](../workflows) and publish each one.

1. In `mehfooz-intake.js` and `mehfooz-clock.js`, set `DB` to your Notion database id and update the `P` map with
   your database's **property ids** (read them with the Notion connector's `getDatabase` action).
2. In `mehfooz-escalate.js` and `mehfooz-settings.js`, set `DEFAULTS.demoEmail` to an inbox you control.
3. Use the **`instant`** execution tier. (On the `standard` tier our executions sat in `queued` and never ran.)

## 6 · Triggers

| Trigger | Bind to | Settings |
|---|---|---|
| Webhook | `mehfooz-intake` | Auth `NONE` — an anonymous form has to reach it |
| Schedule | `mehfooz-clock` | `*/5 * * * *`, timezone `Asia/Karachi` |

`mehfooz-escalate` is called by the clock. `mehfooz-settings` is bound to **no** trigger on purpose.

## 7 · Escalation setting

Run `mehfooz-settings` once:

```json
{ "action": "set", "mode": "demo", "demoEmail": "you@example.com" }
```

Leave `fospah` mode **off** until you deliberately supply the Ombudsman's address. In `fospah` mode the workflow
refuses to send without one, and back-dating is disabled.

## 8 · The UI

Open [`ui/app.js`](../ui/app.js) and fill in the `CONFIG` block at the top:

| Key | Value |
|---|---|
| `WEBHOOK_URL` | The webhook trigger URL from step 6 |
| `EMBED_URL` | Fastn → Widgets → your widget → *Embed code* (the `src` of the iframe) |

Then start it:

```bat
run.bat
```

or, on macOS / Linux:

```bash
cd ui && python3 -m http.server 5173
```

and open <http://localhost:5173>. No install, no build step, no CDN — React 18 is vendored in `ui/vendor/`.

> Opening `ui/index.html` straight from disk also works. Only the inline connect widget needs `http(s)`
> (Fastn's `frame-ancestors *` never matches `file://`).

> **Never commit a real webhook URL or embed token to a public repository.** The webhook is unauthenticated by
> design; anyone who has the URL can file a case.

## 9 · Onboard an employer

Create a tenant, create a setup link for the widget, and send the employer the link (or let them use the widget
embedded on the **Employers** page). They connect their own three apps; Fastn stores and refreshes the tokens
per tenant. See the multi-tenant design in [`ARCHITECTURE.md`](ARCHITECTURE.md#employer-onboarding--the-multi-tenant-design).

## Try it

| What | How |
|---|---|
| File a report | Open the app → **Report an Issue** → submit with your own email → watch Notion, `#mehfooz-committee` and your inbox |
| See a breach happen | Open `index.html?demo=1` → *Presenter control* → **31 days ago** → submit → wait for the next 5-minute tick. Notion flips to `Escalated` + `Breach`, `#mehfooz-authority` fires, the `[DEMO]` Ombudsman notice lands |
| Demo board | `index.html?view=board&seed=1&theme=dark` |
