/* MEHFOOZ - intake
   Anonymous report -> Notion case record -> PII-free Slack committee alert -> Gmail acknowledgement.
   Statutory basis: Protection Against Harassment of Women at the Workplace Act 2010 (30-day inquiry window).
   Guarantees: duplicate submissions are dropped (caseNo is the idempotency key); a failed delivery never
   throws - the case is marked PARTIAL and the clock workflow's retry worker picks it up. */
export default async function (ctx) {
  const fx = new Fastn({ connectors: {
    notion: { orgId: "managed" }, slack: { orgId: "managed" }, googleGmail: { orgId: "managed" } } });

  // ---- deployment constants ------------------------------------------------
  const DB = "YOUR_NOTION_DATABASE_ID";     // Notion "Cases" database
  const CH_COMMITTEE = "mehfooz-committee";               // inquiry committee channel
  const DEADLINE_DAYS = 30;                               // statutory - Act 2010
  const DAY = 86400000;
  // Notion property IDs (rename-proof; two column names carry trailing spaces)
  const P = { caseNo: "title", status: "QOw%5E", severity: "pIav", tenant: "%3E%5C%40z",
              reportedAt: "VPvK", deadline: "c%40XN", breach: "xiTO", delivery: "%5EVVi" };

  // ---- unwrap (direct execute sends the report as ctx.input; a webhook may wrap it) ----
  let inp = ctx.input || {};
  if (!inp.caseNo && inp.body) inp = typeof inp.body === "string" ? safeParse(inp.body) : inp.body;
  if (!inp.caseNo && inp.payload) inp = typeof inp.payload === "string" ? safeParse(inp.payload) : inp.payload;
  inp = inp || {};

  // ---- 1. validate - before ANY connector call --------------------------------
  const bad = [];
  const caseNo = str(inp.caseNo).toUpperCase();
  const tenant = str(inp.tenant).slice(0, 80);
  const category = str(inp.category).slice(0, 120);
  const severity = str(inp.severity);
  const description = str(inp.description).slice(0, 60000);
  const email = inp.reporterEmail == null || str(inp.reporterEmail) === "" ? null : str(inp.reporterEmail);
  if (!/^MHF-\d{4}-[A-Z]{2}$/.test(caseNo)) bad.push("caseNo");
  if (!tenant) bad.push("tenant");
  if (!category) bad.push("category");
  if (["Low", "Medium", "High"].indexOf(severity) === -1) bad.push("severity");
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) bad.push("reporterEmail");
  if (bad.length) return { ok: false, reason: "invalid_input", fields: bad };

  // ---- 2. duplicate guard (conflict handling) --------------------------------
  const key = "mehfooz:case:" + caseNo;
  const seen = await fastn.state.get(key);
  if (seen && (seen.phase === "done" || Date.now() - (seen.at || 0) < 120000)) {
    return { ok: true, duplicate: true, caseNo, deliveryStatus: seen.deliveryStatus || "IN_PROGRESS",
             notionPageId: seen.pageId || null };
  }
  await fastn.state.set(key, { phase: "processing", at: Date.now() });

  // ---- 3. start the statutory clock -------------------------------------------
  const now = Date.now();
  let reported = now;
  const back = Number(inp.backdateDays);
  if (back > 0 && back <= 400 && (await demoMode())) reported = now - back * DAY;               // demo seeding only
  else if (inp.reportedAt) { const t = Date.parse(inp.reportedAt); if (!isNaN(t) && Math.abs(t - now) <= 600000) reported = t; }   // the clock starts on the SERVER's time: a caller's timestamp is accepted only within 10 minutes of it
  const deadline = reported + DEADLINE_DAYS * DAY;

  const delivery = { notion: "PENDING", slack: "PENDING", gmail: email ? "PENDING" : "SKIPPED" };
  const errorDetails = [];
  let pageId = null, pageUrl = null;

  // ---- 4. Notion - the record of truth. NO reporter identity is ever written. ----
  try {
    const props = {};
    props[P.caseNo]     = { title: [{ text: { content: caseNo } }] };
    props[P.status]     = { select: { name: "Received" } };
    props[P.severity]   = { select: { name: severity } };
    props[P.tenant]     = { rich_text: [{ text: { content: tenant } }] };
    props[P.reportedAt] = { date: { start: new Date(reported).toISOString() } };
    props[P.deadline]   = { date: { start: new Date(deadline).toISOString() } };
    props[P.breach]     = { checkbox: false };
    props[P.delivery]   = { select: { name: "PARTIAL" } };   // pessimistic: promoted to OK only once every step lands
    const children = [ para("Category: " + category, true) ];
    const chunks = chunk(description || "(no description provided)", 1900);
    for (let i = 0; i < chunks.length && children.length < 95; i++) children.push(para(chunks[i], false));
    const r = await fx.connector.notion.createPageRaw({ parent: { database_id: DB }, properties: props, children });
    pageId = r.output.id; pageUrl = r.output.url; delivery.notion = "OK";
  } catch (e) { delivery.notion = "FAILED"; errorDetails.push({ step: "notion.createPageRaw", message: msg(e) }); }

  // ---- 5. Slack - committee alert. Case link ONLY: no description, no email (confidentiality). ----
  try {
    const lines = delivery.notion === "OK" ? [
      ":shield: *New case received*   `" + caseNo + "`",
      "*Organization:* " + slackEsc(tenant) + "     *Severity:* " + severity,
      "*Statutory deadline:* " + fmt(deadline) + "  (" + DEADLINE_DAYS + "-day inquiry window, Act 2010)",
      "<" + pageUrl + "|Open the case record>",
      "_No identifying details are shared in this channel._"
    ] : [
      ":rotating_light: *MANUAL ACTION REQUIRED*   `" + caseNo + "`",
      "A report was received but the case record could NOT be written. Organization: " + slackEsc(tenant) + ", severity: " + severity + ".",
      "_The reporter has not been told the case is recorded. Please investigate immediately._"
    ];
    await fx.connector.slack.createChatPostMessage({ channel: CH_COMMITTEE, text: lines.join("\n") });
    delivery.slack = "OK";
  } catch (e) { delivery.slack = "FAILED"; errorDetails.push({ step: "slack.createChatPostMessage", message: msg(e) }); }

  // ---- 6. Gmail - acknowledgement. Only if asked for, and only if the record really exists. ----
  if (email && delivery.notion === "OK") {
    try {
      const html = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0D1320;line-height:1.6\">" +
        "<p>Your report has been received and recorded.</p>" +
        "<p style=\"font-size:26px;font-weight:700;letter-spacing:2px;color:#2D3AAE;font-family:Consolas,monospace\">" + caseNo + "</p>" +
        "<p>Keep this case number. It is the only way to check your case.</p>" +
        "<p><b>Statutory deadline for the inquiry:</b> " + fmt(deadline) + " (" + DEADLINE_DAYS + " days, Protection Against Harassment of Women at the Workplace Act 2010).</p>" +
        "<p>The inquiry committee has been alerted with a case link only - no identifying details. If the deadline passes without a decision, the case escalates automatically to the Competent Authority.</p>" +
        "<p style=\"color:#5E6776;font-size:13px\">Your email address was used once to send this message and has not been stored.</p></div>";
      const raw = "To: " + email + "\r\nSubject: Mehfooz - your case " + caseNo + " has been recorded\r\n" +
        "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n" + html;
      await fx.connector.googleGmail.sendMessage({ raw: b64url(raw) });
      delivery.gmail = "OK";
    } catch (e) { delivery.gmail = "FAILED"; errorDetails.push({ step: "googleGmail.sendMessage", message: msg(e) }); }
  } else if (email) { delivery.gmail = "SKIPPED"; }

  // ---- 7. settle the delivery status -------------------------------------------
  const failed = Object.keys(delivery).filter(k => delivery[k] === "FAILED");
  const deliveryStatus = delivery.notion === "FAILED" ? "FAILED" : failed.length ? "PARTIAL" : "OK";
  if (pageId && deliveryStatus === "OK") {
    try { const up = {}; up[P.delivery] = { select: { name: "OK" } };
      await fx.connector.notion.updatePage({ pageId, archived: false, properties: up }); }
    catch (e) { errorDetails.push({ step: "notion.updatePage(deliveryStatus)", message: msg(e) }); }
  }

  if (delivery.notion === "FAILED") {
    await fastn.state.delete(key);                         // let an honest resubmission through
    return { ok: false, reason: "record_failed", caseNo, deliveryStatus, delivery, errors: errorDetails.length, errorDetails };
  }
  await fastn.state.set(key, { phase: "done", at: Date.now(), pageId, pageUrl, deliveryStatus,
    slack: delivery.slack, gmail: delivery.gmail, slackAttempts: 1, tenant, severity, deadline });

  return { ok: true, duplicate: false, caseNo, deliveryStatus, delivery, notionPageId: pageId, notionUrl: pageUrl,
           reportedAt: new Date(reported).toISOString(), deadline: new Date(deadline).toISOString(),
           errors: errorDetails.length, errorDetails };
}

/* Back-dating exists only to stage demos. It is honoured ONLY while the escalation setting is in "demo"
   mode: once breach notices go to the real Ombudsman, nobody can mint an already-breached case through
   the open webhook. Fails closed - if the setting cannot be read, back-dating is refused. */
async function demoMode() {
  try { const s = await fastn.envConfig.get("mehfoozEscalation"); return !s || !s.mode || s.mode === "demo"; }
  catch (e) { return false; }
}
function str(v) { return v == null ? "" : String(v).trim(); }
function msg(e) { return String((e && e.message) || e).slice(0, 300); }
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
function chunk(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; }
function para(text, bold) { return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text }, annotations: { bold: !!bold } }] } }; }
function slackEsc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function fmt(ms) { const d = new Date(ms), m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return d.getUTCDate() + " " + m[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
function b64url(s) {                                        // no Buffer/btoa in the sandbox
  const bytes = [];
  for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { c = 65536 + ((c & 1023) << 10) + (s.charCodeAt(++i) & 1023);
      bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; let o = "";
  for (let i = 0; i < bytes.length; i += 3) { const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    o += A[a >> 2] + A[((a & 3) << 4) | ((b || 0) >> 4)];
    if (i + 1 < bytes.length) o += A[(((b || 0) & 15) << 2) | ((c || 0) >> 6)];
    if (i + 2 < bytes.length) o += A[(c || 0) & 63]; }
  return o;
}
