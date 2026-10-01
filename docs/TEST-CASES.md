# Acceptance test cases

Every workflow was built **test-first**: the acceptance cases below were drafted, reviewed and approved by a human
*before* the workflow code was written, then attached to the workflow in Fastn. After each build (and after every
later code edit) the cases were re-run and the results saved to the workflow's validation panel.

Fastn ships no mock stubs for the Notion, Slack and Gmail connectors, so **every runnable case was validated
live** against the real services. Cases that would require *forcing a third-party outage* are recorded as
**skipped, with the reason written down** — we chose not to sabotage live connections to fake a failure.

## Summary

| Workflow | Cases attached | Pass | Skipped | Fail |
|---|:-:|:-:|:-:|:-:|
| [`mehfooz-intake`](../workflows/mehfooz-intake.js) | 14 | 11 | 3 | 0 |
| [`mehfooz-clock`](../workflows/mehfooz-clock.js) | 12 | 9 | 3 | 0 |
| [`mehfooz-escalate`](../workflows/mehfooz-escalate.js) | 7 | 6 | 1 | 0 |
| [`mehfooz-settings`](../workflows/mehfooz-settings.js) | 5 | 5 | 0 | 0 |
| **Total** | **38** | **31** | **7** | **0** |

> Three further cases (the clock → `mehfooz-escalate` hand-off: the Ombudsman notice is sent once per case, and
> is not re-sent on later ticks) were approved and verified live; their evidence is recorded in the clock
> workflow's validation notes rather than as attached cases. That makes **41 approved cases: 34 verified live,
> 7 skipped with a written reason, 0 failing.**

## `mehfooz-intake`

| ID | Group | Scenario | Pass condition | Result |
|---|---|---|---|---|
| `IN-01` | Intake - happy path | Valid report WITH reporter email is submitted (caseNo MHF-####-XX, tenant, category, severity, description). | Returns ok:true, deliveryStatus 'OK', delivery {notion:'OK', slack:'OK', gmail:'OK'}. READ-BACK: exactly one Notion row whose Case Number equals caseNo, Status='Received', Severity and Tenant match the input, Breach=false, Delivery Status='OK', and Deadline = Reported At + 30 days. | ✅ Pass |
| `IN-02` | Intake - happy path | Fully anonymous report: reporterEmail is null. | delivery.gmail === 'SKIPPED', googleGmail.sendMessage is never called, deliveryStatus is 'OK' (a skipped optional step is not a failure). | ✅ Pass |
| `IN-03` | Intake - confidentiality (Act s.4) | Report whose description and reporterEmail contain recognisable marker strings. | The Slack message contains the case number, severity, tenant and statutory deadline, and contains NEITHER the description marker NOR the reporter email. The committee is alerted with a case link only. | ✅ Pass |
| `IN-04` | Intake - confidentiality (Act s.4) | Same marker report, inspecting the Notion payload. | The description is written only to the page body. The reporter email appears in NO Notion property and NO Notion block - it is used once for the acknowledgement and never persisted. | ✅ Pass |
| `IN-05` | Intake - partial delivery / error handling | Slack chat.postMessage fails (e.g. channel_not_found / rate limited) while Notion succeeds. | Workflow does NOT throw. delivery.slack === 'FAILED', deliveryStatus === 'PARTIAL', the Notion row's Delivery Status is set to 'PARTIAL' so the clock's retry worker picks it up, and errorDetails names the failed step. | ⏭️ Skipped — Cannot be re-induced for the v4 regression: both Slack channels now exist and no mock stubs exist for slack.createChatPostMessage. This case PASSED LIVE on v1 against a genuine Slack outage (channel_not_found -> no throw, delivery.slack FAILED, deliveryStatus PARTIAL, Notion row PARTIAL, later healed by the clock's retry worker). The v2-v4 diff touches only the clock-start block (step 3); the Slack try/catch (step 5) is byte-identical. |
| `IN-06` | Intake - partial delivery / error handling | Gmail send fails while Notion and Slack succeed. | delivery.gmail === 'FAILED', deliveryStatus === 'PARTIAL', Notion row and Slack alert are still created exactly once. | ⏭️ Skipped — Cannot be induced: no mock stubs exist for googleGmail.sendMessage on this platform connector, and the Gmail API accepts any syntactically valid recipient so a live failure cannot be forced safely. The Gmail step uses the identical try/catch -> FAILED -> PARTIAL structure proven live for Slack. |
| `IN-07` | Intake - partial delivery / error handling | Notion createPage fails - the system of record could not be written. | Returns ok:false, reason 'record_failed', deliveryStatus 'FAILED'. A Slack alert flagged MANUAL ACTION REQUIRED is still sent so a human knows a report exists; no acknowledgement email claims the case was recorded. | ⏭️ Skipped — Cannot be induced: no mock stubs exist for notion.createPageRaw, and forcing a live Notion failure would require revoking the connection mid-build. Code path reviewed: returns ok:false/record_failed, sends the MANUAL ACTION alert, skips the acknowledgement, releases the dedupe key. |
| `IN-08` | Intake - conflict / duplicate handling | The same caseNo is submitted twice (double-click, webhook redelivery, retry). | Second call returns ok:true, duplicate:true and makes ZERO connector calls: no second Notion row, no second Slack alert, no second email. | ✅ Pass |
| `IN-09` | Intake - validation | Payload missing a required field (caseNo, tenant, category or severity). | Returns ok:false, reason 'invalid_input' with the offending fields listed. ZERO connector calls are made. | ✅ Pass |
| `IN-10` | Intake - validation | severity is a value outside Low / Medium / High (e.g. 'Critical'). | Rejected with reason 'invalid_input'; nothing is written to Notion (an unknown select option would otherwise be silently created). | ✅ Pass |
| `IN-11` | Intake - validation | caseNo does not match the MHF-####-XX format. | Rejected with reason 'invalid_input', zero connector calls. | ✅ Pass |
| `IN-12` | Intake - statutory clock start | reportedAt is supplied; separately, backdateDays=26 is supplied for demo seeding. | Deadline is exactly reportedAt + 30 calendar days. With backdateDays=26, Reported At = now - 26 days and Deadline = Reported At + 30 days. | ✅ Pass |
| `IN-13` | Intake - edge cases | Description longer than Notion's 2,000-character rich-text limit. | Description is split across multiple paragraph blocks (each <= 2,000 chars); Notion create succeeds; no text is lost. | ✅ Pass |
| `IN-14` | Intake - trigger | HTTP POST of a valid report to the public webhook trigger URL. | Webhook responds 202; an execution correlated to that event appears and completes with ok:true; the Notion row exists on read-back. | ✅ Pass |

## `mehfooz-clock`

| ID | Group | Scenario | Pass condition | Result |
|---|---|---|---|---|
| `CL-01` | Clock - inside the window | Open case at day 10 of 30. | Counted in scanned; NO Slack message, NO Notion update; warned=0, breached=0. | ✅ Pass |
| `CL-02` | Clock - day 23 warning | Open case at day 24, never warned before. | Exactly one PII-free warning posted to #mehfooz-committee stating 7 days remain; warned=1; the case is recorded as warned. | ✅ Pass |
| `CL-03` | Clock - day 23 warning | The same day-24 case on the NEXT scheduled run. | warned=0 and no Slack call - the warning is idempotent and never repeats every 5 minutes. | ✅ Pass |
| `CL-04` | Clock - day 30 breach | Open case whose Reported At is 31 days ago, Breach=false. | breached=1. READ-BACK: Notion Status='Escalated' and Breach=true. One PII-free escalation is posted to #mehfooz-authority naming the case number and days overdue. | ✅ Pass |
| `CL-05` | Clock - day 30 breach | Case already marked Breach=true / Status='Escalated'. | Skipped: no second escalation, no Notion write; breached=0. | ✅ Pass |
| `CL-06` | Clock - day 30 breach | Case past day 30 but Status='Closed'. | Ignored entirely - a closed inquiry cannot breach. | ✅ Pass |
| `CL-07` | Clock - retry worker | Row with Delivery Status='PARTIAL' (committee alert failed at intake); Slack now works. | Committee alert is re-sent once; Delivery Status becomes 'OK'; retried=1. | ✅ Pass |
| `CL-08` | Clock - retry worker | PARTIAL row whose Slack delivery is still failing on its 3rd attempt. | Delivery Status becomes 'FAILED' and a MANUAL ACTION alert is raised to #mehfooz-authority. The run returns normally with the failure listed in errorDetails. | ⏭️ Skipped — Cannot be induced: requires Slack to fail on three consecutive ticks; no mock stubs exist and we will not remove the bot from a live channel. Code path reviewed. |
| `CL-09` | Clock - robustness | Database contains a blank row (no Case Number, no Reported At). | Row is skipped with reason 'blank_row'; errors=0; the run does not throw. | ✅ Pass |
| `CL-10` | Clock - robustness | At breach, the Notion update succeeds but the Slack escalation fails. | Notion is still Escalated/Breach=true (record of truth first); the failure is in errorDetails; the escalation is re-attempted on the next run rather than lost. | ⏭️ Skipped — Cannot be induced: requires Slack to fail at the instant of breach with no mock stubs available. Code path reviewed: Notion is written first and the 'escalated' marker only after a successful post. |
| `CL-11` | Clock - robustness | One row throws mid-run while others are valid. | Skip-on-error: the bad row is counted in errors with its message, and every other row is still processed. | ⏭️ Skipped — Cannot be induced: no real row throws - every property access is guarded. The per-row try/catch reports to errorDetails. |
| `CL-12` | Clock - trigger | The 5-minute schedule trigger is fired (run-now). | An execution correlated to the trigger's eventId appears and completes, returning named counts {scanned, warned, breached, retried, errors}. | ✅ Pass |

## `mehfooz-escalate`

| ID | Group | Scenario | Pass condition | Result |
|---|---|---|---|---|
| `ES-01` | Escalate - demo mode | A case reported 31 days ago is escalated while the setting is mode='demo'. | Returns ok:true, sent:true, mode:'demo'. Gmail returns a SENT message id. The subject starts with [DEMO] and the body carries a DEMONSTRATION ONLY banner. The notice contains case number, organization, severity, date registered, statutory deadline and days overdue - and NO description and NO complainant/accused identity. | ✅ Pass |
| `ES-02` | Escalate - idempotency | The same breached case is escalated a second time. | Returns ok:true, duplicate:true and makes ZERO Gmail calls - an authority is never notified twice about one case. | ✅ Pass |
| `ES-03` | Escalate - safety guards | Escalation is requested for a case that is only 10 days old. | Returns ok:false, reason:'not_breached', ZERO Gmail calls. The workflow re-computes the 30 days itself and does not trust the caller. | ✅ Pass |
| `ES-04` | Escalate - safety guards | Setting is mode='fospah' but no FOSPAH address has been configured. | Returns ok:false, reason:'recipient_not_configured', ZERO Gmail calls. It never falls back to another address and never sends a fabricated case to a real authority by accident. | ✅ Pass |
| `ES-05` | Escalate - FOSPAH mode | Setting is mode='fospah' with an address configured (the team's own inbox is used as the stand-in address for this test). | Sent to the configured FOSPAH address. Subject has NO [DEMO] prefix and the body has NO demonstration banner - it is the real notice. | ✅ Pass |
| `ES-06` | Escalate - validation | Input has a malformed caseNo or no reportedAt. | Returns ok:false, reason:'invalid_input' naming the fields; ZERO Gmail calls. | ✅ Pass |
| `ES-07` | Escalate - failure handling | Gmail send fails. | Returns ok:false, reason:'send_failed'. NO 'sent' marker is written, so the statutory clock re-attempts the escalation on its next tick. | ⏭️ Skipped — Cannot be induced: no mock stubs exist for googleGmail.sendMessage and the Gmail API accepts any syntactically valid recipient, so a live send failure cannot be forced safely. Code path reviewed: the catch returns send_failed and writes no 'sent' marker, so the clock retries on its next tick. |

## `mehfooz-settings`

| ID | Group | Scenario | Pass condition | Result |
|---|---|---|---|---|
| `ST-01` | Settings | action='get' before anything has been saved. | Returns the effective setting: mode 'demo', the demo inbox, empty fospahEmail, source 'defaults'. | ✅ Pass |
| `ST-02` | Settings | action='set' with mode='demo' and a valid demoEmail. | Saved to Fastn environment config; a following 'get' returns the same values with source 'envConfig'. The escalate workflow uses the new address with no code change. | ✅ Pass |
| `ST-03` | Settings - validation | action='set' with a malformed email address. | Rejected with reason 'invalid_input'; the stored setting is unchanged. | ✅ Pass |
| `ST-04` | Settings - validation | action='set' with mode='fospah' while no fospahEmail is supplied or stored. | Rejected with reason 'fospah_email_required' - FOSPAH mode cannot be switched on without deliberately providing the address. | ✅ Pass |
| `ST-05` | Settings - validation | action='set' with an unknown mode such as 'live'. | Rejected with reason 'invalid_input'. | ✅ Pass |
