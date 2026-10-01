/* MEHFOOZ - escalation settings
   action "get": returns the effective setting.  action "set": validates and saves it.
   mode "demo"   -> breach notices go to demoEmail, marked [DEMO]
   mode "fospah" -> breach notices go to fospahEmail (the real Ombudsman address)
   Bound to NO public trigger on purpose. */
export default async function (ctx) {
  const KEY = "mehfoozEscalation";
  const DEFAULTS = { mode: "demo", demoEmail: "demo-inbox@example.com", fospahEmail: "" };
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const inp = ctx.input || {};
  const action = inp.action === "set" ? "set" : "get";

  let stored = null;
  try { stored = await fastn.envConfig.get(KEY); } catch (e) { stored = null; }
  const current = Object.assign({}, DEFAULTS, stored && typeof stored === "object" ? stored : {});
  const view = (c, source) => ({ mode: c.mode, demoEmail: c.demoEmail, fospahEmail: c.fospahEmail, source,
    activeRecipient: c.mode === "fospah" ? c.fospahEmail : c.demoEmail });

  if (action === "get") return { ok: true, action, setting: view(current, stored ? "envConfig" : "defaults") };

  const next = Object.assign({}, current);
  const bad = [];
  if (inp.mode !== undefined) { if (inp.mode === "demo" || inp.mode === "fospah") next.mode = inp.mode; else bad.push("mode"); }
  if (inp.demoEmail !== undefined) { const v = String(inp.demoEmail).trim(); if (EMAIL_RE.test(v)) next.demoEmail = v; else bad.push("demoEmail"); }
  if (inp.fospahEmail !== undefined) { const v = String(inp.fospahEmail).trim(); if (v === "" || EMAIL_RE.test(v)) next.fospahEmail = v; else bad.push("fospahEmail"); }
  if (bad.length) return { ok: false, reason: "invalid_input", fields: bad, setting: view(current, stored ? "envConfig" : "defaults") };
  if (next.mode === "fospah" && !EMAIL_RE.test(next.fospahEmail))
    return { ok: false, reason: "fospah_email_required", setting: view(current, stored ? "envConfig" : "defaults") };

  next.updatedAt = new Date().toISOString();
  await fastn.envConfig.set(KEY, next);
  return { ok: true, action, setting: view(next, "envConfig") };
}
