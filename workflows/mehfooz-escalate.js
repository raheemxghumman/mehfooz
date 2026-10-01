/* MEHFOOZ - escalate to the Ombudsman
   Triggered by the statutory clock when a case breaches the 30-day inquiry window. Sends a formal notice
   to the higher authority (FOSPAH - Federal Ombudsman Secretariat for Protection Against Harassment).
   SAFETY: the recipient is a SETTING, never a literal. In "demo" mode every notice goes to the demo inbox
   and says so in the subject and body. "fospah" mode refuses to send unless an address has been
   deliberately configured - a fabricated case can never reach a real authority by accident.
   No identifying details of the complainant or the accused are ever included. */
export default async function (ctx) {
  const fx = new Fastn({ connectors: { googleGmail: { orgId: "managed" } } });
  const SETTINGS_KEY = "mehfoozEscalation";
  const DEFAULTS = { mode: "demo", demoEmail: "demo-inbox@example.com", fospahEmail: "" };
  const DEADLINE_DAYS = 30, DAY = 86400000;
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

  const inp = ctx.input || {};
  const caseNo = str(inp.caseNo).toUpperCase();
  const tenant = str(inp.tenant).slice(0, 80) || "(unspecified)";
  const severity = str(inp.severity) || "(unspecified)";
  const reported = Date.parse(inp.reportedAt);
  const bad = [];
  if (!/^MHF-\d{4}-[A-Z]{2}$/.test(caseNo)) bad.push("caseNo");
  if (isNaN(reported)) bad.push("reportedAt");
  if (bad.length) return { ok: false, reason: "invalid_input", fields: bad };

  // defence in depth: never notify an authority about a case that has not actually breached
  const now = Date.now();
  const elapsed = (now - reported) / DAY;
  if (elapsed < DEADLINE_DAYS) return { ok: false, reason: "not_breached", caseNo, daysElapsed: Math.floor(elapsed) };
  const overdue = Math.max(1, Math.floor(elapsed - DEADLINE_DAYS) + 1);
  const deadline = reported + DEADLINE_DAYS * DAY;

  // send once per case
  const key = "mehfooz:ombudsman:" + caseNo;
  const already = await fastn.state.get(key);
  if (already && inp.force !== true) return { ok: true, duplicate: true, caseNo, sentAt: already.at, mode: already.mode };

  // settings (editable without touching code) -> fall back to safe defaults
  let cfg = null, cfgSource = "defaults";
  try { cfg = await fastn.envConfig.get(SETTINGS_KEY); if (cfg) cfgSource = "envConfig"; } catch (e) { cfg = null; cfgSource = "defaults (envConfig unavailable: " + msg(e).slice(0, 80) + ")"; }
  cfg = Object.assign({}, DEFAULTS, cfg && typeof cfg === "object" ? cfg : {});
  const mode = cfg.mode === "fospah" ? "fospah" : "demo";
  const to = mode === "fospah" ? str(cfg.fospahEmail) : str(cfg.demoEmail);
  if (!EMAIL_RE.test(to)) return { ok: false, reason: "recipient_not_configured", caseNo, mode, cfgSource };

  const demo = mode === "demo";
  const row = (k, v) => "<tr><td style=\"padding:7px 14px 7px 0;color:#5E6776;white-space:nowrap\">" + k + "</td><td style=\"padding:7px 0;font-weight:600\">" + v + "</td></tr>";
  const html = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0D1320;line-height:1.6;max-width:620px\">" +
    (demo ? "<div style=\"background:#FFF4E0;border:1px solid #E9B65A;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:13px\"><b>DEMONSTRATION ONLY.</b> This case is fabricated and this notice was delivered to a demo inbox. It was <b>not</b> sent to the Federal Ombudsman.</div>" : "") +
    "<p>To: The Federal Ombudsman Secretariat for Protection Against Harassment (FOSPAH)</p>" +
    "<p style=\"font-size:18px;font-weight:700;color:#C01F1A;margin:18px 0 6px\">Statutory breach notice</p>" +
    "<p>This is an automated notice under the <b>Protection Against Harassment of Women at the Workplace Act 2010</b>. A complaint registered with the organization named below has <b>not had its inquiry concluded within the 30-day period</b> the Act prescribes. It is referred to your office for oversight.</p>" +
    "<table style=\"border-collapse:collapse;font-size:14.5px;margin:14px 0\">" +
      row("Case reference", "<span style=\"font-family:Consolas,monospace;letter-spacing:1px;color:#2D3AAE\">" + caseNo + "</span>") +
      row("Organization", esc(tenant)) + row("Severity (as reported)", esc(severity)) +
      row("Complaint registered", fmt(reported)) + row("Statutory deadline", fmt(deadline)) +
      row("Overdue by", "<span style=\"color:#C01F1A\">" + overdue + " day" + (overdue === 1 ? "" : "s") + "</span>") +
      row("Status", "Escalated - no decision recorded") +
    "</table>" +
    "<p style=\"font-size:13.5px;color:#465061\">No identifying details of the complainant or of the accused are included in this notice. The full case record is held by the organization's Competent Authority, which has been notified of this escalation.</p>" +
    "<p style=\"font-size:12.5px;color:#5E6776;border-top:1px solid #E3E6EB;padding-top:10px;margin-top:18px\">Sent automatically by Mehfooz when the statutory clock expired. This is a system-generated notice.</p></div>";
  const subject = (demo ? "[DEMO] " : "") + "Statutory breach notice - case " + caseNo + " - inquiry not completed within 30 days";
  const raw = "To: " + to + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n" + html;

  try {
    const r = await fx.connector.googleGmail.sendMessage({ raw: b64url(raw) });
    await fastn.state.set(key, { at: now, mode, to: mask(to), gmailId: r.output && r.output.id });
    return { ok: true, sent: true, duplicate: false, caseNo, mode, recipient: mask(to), daysOverdue: overdue, gmailId: r.output && r.output.id, cfgSource };
  } catch (e) {                                   // nothing marked sent -> the clock re-attempts next tick
    return { ok: false, reason: "send_failed", caseNo, mode, message: msg(e) };
  }
}

function str(v) { return v == null ? "" : String(v).trim(); }
function msg(e) { return String((e && e.message) || e).slice(0, 300); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function mask(a) { const p = String(a).split("@"); return (p[0] || "").slice(0, 2) + "***@" + (p[1] || ""); }
function fmt(ms) { const d = new Date(ms), m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return d.getUTCDate() + " " + m[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
function b64url(s) {
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
