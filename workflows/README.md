# Fastn workflows

The four workflows that make up Mehfooz's backend. Each file is the JavaScript that runs inside Fastn's
workflow sandbox (`export default async function (ctx) { … }`). They were authored, tested, published and
debugged through **Fastn's MCP server**.

| File | Fastn workflow | Trigger | What it does |
|---|---|---|---|
| [`mehfooz-intake.js`](mehfooz-intake.js) | `mehfooz-intake` | **Webhook** (public, async) | Validates the report, drops duplicates, starts the statutory clock, writes the Notion case record, alerts the committee in Slack (case link only), emails the reporter's acknowledgement, and settles the delivery status. |
| [`mehfooz-clock.js`](mehfooz-clock.js) | `mehfooz-clock` | **Schedule** `*/5 * * * *` (Asia/Karachi) | Reads every open case. Retries failed committee alerts, sends the day‑23 warning once, and on day 30 marks the case `Escalated` + `Breach`, alerts the Competent Authority and hands off to `mehfooz-escalate`. |
| [`mehfooz-escalate.js`](mehfooz-escalate.js) | `mehfooz-escalate` | Called by the clock (`fastn.flow.invoke`) | Re-checks the 30 days itself, then emails a formal breach notice to the Federal Ombudsman (FOSPAH) — exactly once per case. |
| [`mehfooz-settings.js`](mehfooz-settings.js) | `mehfooz-settings` | **None** — owner-only by design | Gets / sets where breach notices go (`demo` inbox or the real `fospah` address). |

## Before you deploy them

These are the workflows exactly as they ran at the hackathon, with **two values replaced by placeholders** so
nothing from our workspace is published:

| Placeholder | Where | Replace with |
|---|---|---|
| `YOUR_NOTION_DATABASE_ID` | `mehfooz-intake.js`, `mehfooz-clock.js` (`DB`) | The id of your Notion `Cases` database |
| `demo-inbox@example.com` | `mehfooz-escalate.js`, `mehfooz-settings.js` (`DEFAULTS.demoEmail`) | An inbox you control, for demo breach notices |

You will also need to update the `P` map (Notion **property ids**) in the intake and clock workflows — the ids
are specific to each database. Read them with the Notion connector's `getDatabase` action. Columns are addressed
by id, not by name, so renaming a column in Notion never breaks a workflow.

Full step-by-step instructions: [`docs/SETUP.md`](../docs/SETUP.md).

## Sandbox notes

Things we learned the hard way about Fastn's workflow sandbox:

- Community-scoped connectors must be reached through `new Fastn({ connectors: { slug: { orgId: "managed" } } })`.
- `fastn.state`, `fastn.envConfig` and `fastn.flow.invoke` are available as ambient globals.
- There is no `Buffer`, `btoa`, `crypto`, `URL` or timers — the intake and escalate workflows carry their own
  base64url encoder to build the RFC 822 message that Gmail's `sendMessage` expects.
- A failed connector call **throws**, so every external call is wrapped in its own `try / catch`. A failed
  delivery never crashes a run; it is recorded and retried.
