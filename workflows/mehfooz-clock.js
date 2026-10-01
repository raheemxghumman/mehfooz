/* MEHFOOZ - the statutory clock
   Runs on a schedule. For every open case in Notion it enforces the 30-day inquiry window of the
   Protection Against Harassment of Women at the Workplace Act 2010:
     day 23+  -> one warning to the inquiry committee
     day 30+  -> BREACH: Notion marked Escalated/Breach, escalated to the Competent Authority
   It is also the retry worker: a case whose committee alert failed at intake (Delivery Status PARTIAL)
   is re-sent here, and after 3 failed attempts is raised to the Authority for manual action.
   Every action is idempotent - the clock can tick every 5 minutes without ever repeating itself. */
export default async function (ctx) {
  const fx = new Fastn({ connectors: { notion: { orgId: "managed" }, slack: { orgId: "managed" } } });

  // ---- deployment constants ------------------------------------------------
  const DB = "YOUR_NOTION_DATABASE_ID";
  const CH_COMMITTEE = "mehfooz-committee";
  const CH_AUTHORITY = "mehfooz-authority";
  const DEADLINE_DAYS = 30, WARN_DAY = 23, MAX_SLACK_ATTEMPTS = 3, DAY = 86400000;
  const P = { caseNo: "title", status: "QOw%5E", severity: "pIav", tenant: "%3E%5C%40z",
              reportedAt: "VPvK", deadline: "c%40XN", breach: "xiTO", delivery: "%5EVVi" };

  const inp = ctx.input || {};                      // SCOPE only
  const dryRun = inp.dryRun === true;               // compute, touch nothing
  const pageSize = Math.max(1, Math.min(100, Number(inp.limit) || 100));
  const now = Date.now();

  const out = { ok: true, dryRun, scanned: 0, warned: 0, breached: 0, escalationsSent: 0, authorityEmails: 0, retried: 0,
                deliveryFailed: 0, skipped: 0, skipReasons: {}, errors: 0, errorDetails: [], actions: [] };
  const skip = (why) => { out.skipped++; out.skipReasons[why] = (out.skipReasons[why] || 0) + 1; };
  const post = (channel, lines) => fx.connector.slack.createChatPostMessage({ channel, text: lines.join("\n") });

  // ---- read every case (paged) ------------------------------------------------
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const args = { databaseId: DB, page_size: pageSize };
    if (cursor) args.start_cursor = cursor;
    const q = await fx.connector.notion.queryDatabase(args);
    const res = q.output.results || [];
    for (let i = 0; i < res.length; i++) rows.push(res[i]);
    if (!q.output.has_more || !q.output.next_cursor || q.output.next_cursor === cursor) break;
    cursor = q.output.next_cursor;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let caseNo = "(unknown)";
    try {
      out.scanned++;
      const byId = {};
      const pv = row.properties || {};
      Object.keys(pv).forEach(k => { byId[pv[k].id] = pv[k]; });
      const title = byId[P.caseNo] && byId[P.caseNo].title;
      caseNo = title && title[0] ? title[0].plain_text : "";
      const reportedIso = byId[P.reportedAt] && byId[P.reportedAt].date && byId[P.reportedAt].date.start;
      if (!caseNo || !reportedIso) { skip("blank_row"); continue; }

      const status = sel(byId[P.status]), delivery = sel(byId[P.delivery]), severity = sel(byId[P.severity]);
      const breach = !!(byId[P.breach] && byId[P.breach].checkbox);
      const tt = byId[P.tenant] && byId[P.tenant].rich_text;
      const tenant = tt && tt[0] ? tt[0].plain_text : "(unspecified)";
      const pageId = row.id, url = row.url;
      if (status === "Closed") { skip("closed"); continue; }

      const elapsed = (now - Date.parse(reportedIso)) / DAY;
      const deadlineMs = Date.parse(reportedIso) + DEADLINE_DAYS * DAY;

      // ---- A. retry worker: committee alert that failed at intake ----
      if (delivery === "PARTIAL") {
        const key = "mehfooz:case:" + caseNo;
        const st = await fastn.state.get(key);
        if (st && st.slack === "FAILED") {
          const attempt = (st.slackAttempts || 1) + 1;
          out.actions.push({ caseNo, action: "retry_committee_alert", attempt });
          if (!dryRun) {
            try {
              await post(CH_COMMITTEE, [
                ":shield: *New case received*   `" + caseNo + "`   _(delivered on retry " + attempt + ")_",
                "*Organization:* " + esc(tenant) + "     *Severity:* " + severity,
                "*Statutory deadline:* " + fmt(deadlineMs) + "  (" + DEADLINE_DAYS + "-day inquiry window, Act 2010)",
                "<" + url + "|Open the case record>",
                "_No identifying details are shared in this channel._" ]);
              st.slack = "OK"; st.slackAttempts = attempt;
              const healed = st.gmail !== "FAILED";            // an unsent acknowledgement cannot be retried: the email was never stored
              if (healed) { st.deliveryStatus = "OK"; await setProps(fx, pageId, P.delivery, { select: { name: "OK" } }); }
              await fastn.state.set(key, st);
              out.retried++;
            } catch (e) {
              st.slackAttempts = attempt;
              out.errorDetails.push({ caseNo, step: "retry.slack", attempt, message: msg(e) });
              if (attempt >= MAX_SLACK_ATTEMPTS) {
                st.deliveryStatus = "FAILED"; out.deliveryFailed++;
                await setProps(fx, pageId, P.delivery, { select: { name: "FAILED" } });
                try { await post(CH_AUTHORITY, [
                  ":rotating_light: *MANUAL ACTION REQUIRED*   `" + caseNo + "`",
                  "The inquiry committee could not be alerted after " + attempt + " attempts. The case IS recorded.",
                  "<" + url + "|Open the case record>" ]); }
                catch (e2) { out.errorDetails.push({ caseNo, step: "retry.authorityAlert", message: msg(e2) }); }
              }
              await fastn.state.set(key, st);
            }
          }
        } else { skip("partial_not_retryable"); }
      }

      // ---- B. day 30+ : statutory breach ----
      if (elapsed >= DEADLINE_DAYS) {
        const overdue = Math.max(1, Math.floor(elapsed - DEADLINE_DAYS) + 1);
        if (!breach || status !== "Escalated") {
          out.actions.push({ caseNo, action: "breach", daysOverdue: overdue });
          if (!dryRun) {                                        // record of truth FIRST
            const up = {}; up[P.status] = { select: { name: "Escalated" } }; up[P.breach] = { checkbox: true };
            await fx.connector.notion.updatePage({ pageId, archived: false, properties: up });
          }
          out.breached++;
        }
        const ek = "mehfooz:escalated:" + pageId;
        if (!dryRun && !(await fastn.state.get(ek))) {
          try {
            await post(CH_AUTHORITY, [
              ":rotating_light: *STATUTORY BREACH*   `" + caseNo + "`",
              "The " + DEADLINE_DAYS + "-day inquiry window under the Protection Against Harassment of Women at the Workplace Act 2010 has expired with no recorded decision  -  *" + overdue + " day" + (overdue === 1 ? "" : "s") + " overdue*.",
              "*Organization:* " + esc(tenant) + "     *Severity:* " + severity + "     *Deadline was:* " + fmt(deadlineMs),
              "This case has been escalated automatically to the Competent Authority.  <" + url + "|Open the case record>",
              "_No identifying details are shared in this channel._" ]);
            await fastn.state.set(ek, { at: now, caseNo });
            out.escalationsSent++;
            try { await post(CH_COMMITTEE, [ ":no_entry: `" + caseNo + "` has *breached* the statutory deadline and was escalated to the Competent Authority." ]); }
            catch (e3) { out.errorDetails.push({ caseNo, step: "breach.committeeNotice", message: msg(e3) }); }
          } catch (e) {                                          // not marked sent -> re-attempted next tick
            out.errorDetails.push({ caseNo, step: "breach.escalation", message: msg(e) });
          }
        }
        // ---- higher authority: notify the Ombudsman (FOSPAH) once per case, through its own workflow ----
        if (!dryRun && !(await fastn.state.get("mehfooz:ombudsman:" + caseNo))) {
          try {
            const er = await fastn.flow.invoke("mehfooz-escalate", { caseNo, tenant, severity, reportedAt: reportedIso, pageId });
            if (er && er.sent) { out.authorityEmails++; out.actions.push({ caseNo, action: "ombudsman_notice", mode: er.mode }); }
            else if (!(er && er.duplicate)) out.errorDetails.push({ caseNo, step: "escalate.ombudsman", message: (er && er.reason) || "no result" });
          } catch (e) { out.errorDetails.push({ caseNo, step: "escalate.ombudsman", message: msg(e) }); }
        }
        continue;
      }

      // ---- C. day 23+ : warn the committee exactly once ----
      if (elapsed >= WARN_DAY) {
        const wk = "mehfooz:warned:" + pageId;
        if (!(await fastn.state.get(wk))) {
          const left = Math.max(1, Math.ceil(DEADLINE_DAYS - elapsed));
          out.actions.push({ caseNo, action: "warn", daysLeft: left });
          if (!dryRun) {
            try {
              await post(CH_COMMITTEE, [
                ":warning: *Day " + WARN_DAY + " warning*   `" + caseNo + "`",
                "*" + left + " day" + (left === 1 ? "" : "s") + " remain* to complete this inquiry. Statutory deadline: *" + fmt(deadlineMs) + "*.",
                "If no decision is recorded by then, the case escalates automatically to the Competent Authority.",
                "<" + url + "|Open the case record>" ]);
              await fastn.state.set(wk, { at: now, caseNo });
              out.warned++;
            } catch (e) { out.errorDetails.push({ caseNo, step: "warn.slack", message: msg(e) }); }
          } else { out.warned++; }
        }
      }
    } catch (e) {                                                // skip-on-error: one bad row never stops the clock
      out.errorDetails.push({ caseNo, step: "row", message: msg(e) });
    }
  }
  out.errors = out.errorDetails.length;
  out.ranAt = new Date(now).toISOString();
  return out;
}

async function setProps(fx, pageId, propId, value) { const up = {}; up[propId] = value; return fx.connector.notion.updatePage({ pageId, archived: false, properties: up }); }
function sel(p) { return p && p.select ? p.select.name : ""; }
function msg(e) { return String((e && e.message) || e).slice(0, 300); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function fmt(ms) { const d = new Date(ms), m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return d.getUTCDate() + " " + m[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
