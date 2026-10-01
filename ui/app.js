/* ============================================================
   MEHFOOZ — statutory case-accountability infrastructure
   React 18 + htm (no build step, no CDN at runtime)
   ============================================================ */
const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = React;
const html = htm.bind(React.createElement);

/* ------------------------------------------------------------
   CONFIG — paste the Fastn webhook trigger URL here
   ------------------------------------------------------------ */
const CONFIG = {
  /* Fastn webhook trigger bound to the workflow "mehfooz-intake" (Fastn -> Triggers -> copy the URL).
     Left empty in this public repository: the app then runs as a faithful LOCAL SIMULATION - nothing leaves
     the browser. Paste your own trigger URL to go live. */
  WEBHOOK_URL: "",
  /* Fastn's embeddable connect widget (Fastn -> Widgets -> Mehfooz -> Embed code). Served with
     `frame-ancestors *`, so it renders inline on the Employers page when the app is served over http(s).
     Production mints one tenant-scoped token per employer. Never commit a real token. */
  EMBED_URL: "",
  /* Optional fallback: a one-time Fastn setup link (createSetupLink). These live about 15 minutes. */
  SETUP_URL: "",
  SETUP_EXPIRES: "",
  DEADLINE_DAYS: 30,        // statutory inquiry window (Act 2010)
  WARN_DAY: 23,             // committee warning
  DEMO_SECONDS_PER_DAY: 1,  // demo clock: 1 real second == 1 statutory day
};

const LS_CASES = "mehfooz.cases.v2";
const LS_THEME = "mehfooz.theme";

/* Deep links: ?view=board  ?seed=1  ?theme=dark  ?still=1 — handy for the demo and for screenshots */
const PARAMS = new URLSearchParams(location.search);

/* ============================================================
   TOAST BUS
   kinds: ok · warn · fault (a delivery/system failure) · breach (statutory breach — the only red)
   ============================================================ */
let _tid = 0;
const _subs = new Set();
const toast = (title, body, kind = "ok") => {
  const t = { id: ++_tid, title, body, kind };
  _subs.forEach((fn) => fn(t));
};

/* ============================================================
   UTIL
   ============================================================ */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const caseNumber = () => {
  const n = String(1 + Math.floor(Math.random() * 9999)).padStart(4, "0");
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // no I or O — unambiguous when read aloud
  const pick = () => L[Math.floor(Math.random() * L.length)];
  return `MHF-${n}-${pick()}${pick()}`;
};

const loadCases = () => {
  try { const r = localStorage.getItem(LS_CASES); if (r) return JSON.parse(r); } catch (e) {}
  return [];
};
const saveCases = (c) => { try { localStorage.setItem(LS_CASES, JSON.stringify(c)); } catch (e) {} };

/* ---------- THE CLOCK (the product) ---------- */
const elapsedDays = (c, demo) => {
  const ms = Date.now() - c.reportedAt;
  return demo ? ms / 1000 / CONFIG.DEMO_SECONDS_PER_DAY : ms / 86400000;
};
const daysLeft = (c, demo) => CONFIG.DEADLINE_DAYS - elapsedDays(c, demo);
const phaseOf = (c, demo) => {
  if (c.status === "Closed") return "closed";
  const left = daysLeft(c, demo);
  if (left <= 0) return "breach";
  if (elapsedDays(c, demo) >= CONFIG.WARN_DAY) return "warn";
  return "ok";
};
const isPartial = (c) => Object.values(c.delivery).includes("FAILED");

/* ============================================================
   MOTION PREFERENCES
   ============================================================ */
const STILL = document.documentElement.classList.contains("still");
const REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
const CALM = STILL || REDUCED;

/* ============================================================
   HOOKS
   ============================================================ */
function useTick(ms = 500) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function useCountUp(value, dur = 520) {
  const [n, setN] = useState(value);
  const cur = useRef(value);           // always the number currently on screen
  useEffect(() => {
    const a = cur.current, b = value;
    if (a === b) return;
    if (CALM) { cur.current = b; setN(b); return; }
    const start = performance.now();
    let raf;
    const step = (t) => {
      const p = clamp((t - start) / dur, 0, 1);
      const v = Math.round(a + (b - a) * (1 - Math.pow(1 - p, 4)));
      cur.current = v; setN(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // If the tab is backgrounded rAF stalls — land on the true value regardless.
    const settle = setTimeout(() => { cur.current = b; setN(b); }, dur + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [value, dur]);
  return n;
}

/* true for `ms` after `on` flips false → true while mounted (drives one-shot moments) */
function useEdge(on, ms = 1900) {
  const prev = useRef(on);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = on;
    if (on && !was && !CALM) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      return () => clearTimeout(t);
    }
  }, [on]);
  return flash;
}

function useTheme() {
  /* index.html resolves the initial theme before first paint; we just read it. */
  const [mode, setMode] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  const isDark = mode === "dark";

  const cycle = () => {
    const next = isDark ? "light" : "dark";
    const r = document.documentElement;
    if (!CALM) r.classList.add("theme-anim");    // cross-fade every surface together
    r.setAttribute("data-theme", next);
    setTimeout(() => r.classList.remove("theme-anim"), 380);
    try { localStorage.setItem(LS_THEME, next); } catch (e) {}
    setMode(next);
  };
  return [mode, isDark, cycle];
}

/* ============================================================
   ICONS — 24px grid, 1.8 stroke, round joins
   ============================================================ */
const svg = (d, sw = 1.8) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const Ico = {
  mark: svg(html`<path d="M12 2.8 4.6 5.9v5.6c0 4.6 3.1 8.1 7.4 9.1 4.3-1 7.4-4.5 7.4-9.1V5.9z"/><path d="M12 8v4l2.6 1.6"/>`, 2),
  sun: svg(html`<circle cx="12" cy="12" r="4"/><path d="M12 2.8v1.9M12 19.3v1.9M2.8 12h1.9M19.3 12h1.9M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M18.5 5.5l-1.3 1.3M6.8 17.2l-1.3 1.3"/>`),
  moon: svg(html`<path d="M20 13.6A8 8 0 0 1 10.4 4a8.2 8.2 0 1 0 9.6 9.6"/>`),
  lock: svg(html`<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>`),
  check: svg(html`<path d="M19.5 7 9.6 16.9 4.5 11.8"/>`, 2.4),
  checkSm: svg(html`<path d="M19 7.5 9.8 16.5 5 11.8"/>`, 2.6),
  x: svg(html`<path d="M7 7l10 10M17 7 7 17"/>`, 2.4),
  minus: svg(html`<path d="M7 12h10"/>`, 2.4),
  inbox: svg(html`<path d="M3.5 13.5h4.6l1.4 2.6h5l1.4-2.6h4.6"/><path d="M5.6 5.5h12.8l2.1 8v4.6a1.9 1.9 0 0 1-1.9 1.9H5.4a1.9 1.9 0 0 1-1.9-1.9v-4.6z"/>`),
  clock: svg(html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.9"/>`),
  alert: svg(html`<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.2M12 17v.1"/>`),
  plug: svg(html`<path d="M9 3.5v4.2M15 3.5v4.2M6.5 7.7h11v3.6a5.5 5.5 0 0 1-11 0zM12 16.8v3.7"/>`),
  search: svg(html`<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>`),
  layers: svg(html`<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>`),
  filter: svg(html`<path d="M4 6h16M7 12h10M10 18h4"/>`),
  info: svg(html`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>`),
  arrow: svg(html`<path d="M5 12h14M13 6l6 6-6 6"/>`, 2),
};
const TOAST_ICON = { ok: Ico.checkSm, warn: Ico.clock, fault: Ico.plug, err: Ico.plug, breach: Ico.alert };

/* ============================================================
   RING — the countdown
   ============================================================ */
function Ring({ c, demo, size = 58 }) {
  const lg = size >= 80;
  const sw = lg ? 6 : 4;
  const R = size / 2 - sw / 2 - 1;
  const C = 2 * Math.PI * R;
  const left = daysLeft(c, demo);
  const frac = clamp(left / CONFIG.DEADLINE_DAYS, 0, 1);
  const p = phaseOf(c, demo);
  const n = left <= 0 ? Math.max(1, Math.ceil(-left)) : Math.ceil(left);
  const fresh = useEdge(p === "breach");
  const label = left <= 0 ? `${n} days over the statutory limit` : `${n} days left of ${CONFIG.DEADLINE_DAYS}`;

  return html`
    <div className=${"ring" + (lg ? " lg" : "")} data-p=${p} data-fresh=${String(fresh)}
      style=${{ width: size, height: size }} role="img" aria-label=${label}>
      <span className="ring-halo" />
      <svg width=${size} height=${size} aria-hidden="true">
        <circle className="ring-bg" cx=${size / 2} cy=${size / 2} r=${R} fill="none" strokeWidth=${sw} />
        <circle className="ring-fg" cx=${size / 2} cy=${size / 2} r=${R} fill="none" strokeWidth=${sw}
          strokeLinecap="round" strokeDasharray=${C} strokeDashoffset=${C * (1 - frac)} />
      </svg>
      <div className="ring-t" aria-hidden="true">
        <div>
          <div className="ring-n tnum">${left <= 0 ? "+" : ""}${n}</div>
          <div className="ring-u">${left <= 0 ? "over" : n === 1 ? "day" : "days"}</div>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   TIMEBAR — linear view of the same clock (Track view)
   ============================================================ */
function TimeBar({ c, demo }) {
  const el = elapsedDays(c, demo);
  const p = phaseOf(c, demo);
  const D = CONFIG.DEADLINE_DAYS, W = CONFIG.WARN_DAY;
  const pct = clamp(el / D, 0, 1) * 100;
  const day = Math.min(Math.floor(el), 999);
  const warnPct = (W / D) * 100;
  return html`
    <div className="timebar" data-p=${p}>
      <div className="timebar-top">
        <span>${p === "breach"
          ? html`<b className="tnum">Day ${day}</b> · ${day - D} over the statutory limit`
          : html`<b className="tnum">Day ${day}</b> of ${D}`}</span>
        <span className="tnum">${p === "breach" ? "Escalated" : `${Math.max(0, Math.ceil(D - el))} left`}</span>
      </div>
      <div className="timebar-track" role="progressbar" aria-valuemin="0" aria-valuemax=${D} aria-valuenow=${Math.min(day, D)}
        aria-label="Statutory inquiry window">
        <div className="timebar-fill" style=${{ width: pct + "%" }} />
        <span className="timebar-mark" style=${{ left: warnPct + "%" }} />
      </div>
      <div className="timebar-labels tnum">
        <span style=${{ left: 0 }}>Day 0</span>
        <span style=${{ left: warnPct + "%" }} data-hot=${String(el >= W)}>Day ${W}</span>
        <span>Day ${D}</span>
      </div>
    </div>`;
}

/* ============================================================
   SCRAMBLE — the case number resolves in
   ============================================================ */
function Scramble({ text, delay = 240, dur = 720 }) {
  const [out, setOut] = useState(() => (CALM ? text : text.replace(/[A-Z0-9]/g, "0")));
  useEffect(() => {
    if (CALM) { setOut(text); return; }
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    let raf;
    const start = setTimeout(() => {
      const t0 = performance.now();
      const step = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        const fixed = Math.floor(p * text.length);
        setOut(text.split("").map((ch, i) =>
          i < fixed || ch === "-" ? ch : A[Math.floor(Math.random() * A.length)]).join(""));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    const settle = setTimeout(() => setOut(text), delay + dur + 150);
    return () => { clearTimeout(start); clearTimeout(settle); cancelAnimationFrame(raf); };
  }, [text]);
  return html`<${React.Fragment}><span className="sr">${text}</span><span aria-hidden="true">${out}</span><//>`;
}

/* ============================================================
   TOASTS
   ============================================================ */
function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const fn = (t) => {
      setList((l) => [...l, t].slice(-3));       // never stack more than three
      setTimeout(() => setList((l) => l.map(x => x.id === t.id ? { ...x, out: true } : x)), 4400);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4780);
    };
    _subs.add(fn);
    return () => _subs.delete(fn);
  }, []);
  return html`
    <div className="toasts" role="status" aria-live="polite">
      ${list.map((t) => html`
        <div key=${t.id} className=${"toast-w" + (t.out ? " out" : "")}>
          <div>
            <div className="toast" data-k=${t.kind}>
              <span className="toast-ic">${TOAST_ICON[t.kind] || Ico.info}</span>
              <div><b>${t.title}</b><p>${t.body}</p></div>
            </div>
          </div>
        </div>`)}
    </div>`;
}

/* ============================================================
   TOP BAR
   ============================================================ */
const TABS = [
  { id: "report", label: "Report" },
  { id: "track", label: "Track" },
  { id: "board", label: "Committee" },
  { id: "employers", label: "Employers" },
];

function TopBar({ view, setView, demo, setDemo, isDark, cycleTheme }) {
  const wrap = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const measure = () => {
      const w = wrap.current; if (!w) return;
      const el = w.querySelector(`[data-tab="${view}"]`); if (!el) return;
      setPill((p) => ({ left: el.offsetLeft, width: el.offsetWidth, ready: p.width > 0 }));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && wrap.current) ro.observe(wrap.current);
    return () => { window.removeEventListener("resize", measure); if (ro) ro.disconnect(); };
  }, [view]);

  const onKey = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === view);
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setView(n.id);
    const b = wrap.current && wrap.current.querySelector(`[data-tab="${n.id}"]`);
    if (b) b.focus();
  };

  return html`
    <header className="topbar">
      <div className="shell topbar-in">
        <button className="brand" onClick=${() => setView("home")} aria-label="Mehfooz — back to the start page">
          <div className="mark">${Ico.mark}</div>
          <div style=${{ textAlign: "left" }}>
            <div className="brand-name">Mehfooz</div>
            <div className="brand-sub">The 30-day clock that doesn't stop</div>
          </div>
        </button>

        <nav className="tabs" ref=${wrap} role="tablist" aria-label="Views" onKeyDown=${onKey}>
          <div className="tabs-pill" data-ready=${String(pill.ready)} aria-hidden="true"
            style=${{ transform: `translateX(${pill.left}px)`, width: pill.width }} />
          ${TABS.map((t) => html`
            <button key=${t.id} className="tab" data-tab=${t.id} role="tab" tabIndex=${view === t.id ? 0 : -1}
              aria-selected=${view === t.id} onClick=${() => setView(t.id)}><span className="tab-l">${t.label}</span></button>`)}
        </nav>

        <div className="clockbox" data-on=${String(demo)}>
          <span className="clock-dot" aria-hidden="true" />
          <span className="clockbox-l">Demo clock<small>${demo ? "1 s = 1 day" : "Real days"}</small></span>
          <button className="switch" role="switch" aria-checked=${demo}
            aria-label="Compress the statutory clock for demonstration"
            onClick=${() => {
              setDemo(!demo);
              toast(demo ? "Real clock" : "Demo clock",
                demo ? "Deadlines now run in real calendar days."
                     : `1 second = 1 statutory day. A case breaches in ${CONFIG.DEADLINE_DAYS} seconds.`,
                demo ? "ok" : "warn");
            }} />
        </div>

        <button className="ibtn" onClick=${cycleTheme}
          aria-label=${isDark ? "Switch to light mode" : "Switch to dark mode"}>
          <span className="theme-stack">
            <span className="theme-ico" data-on=${String(!isDark)}>${Ico.sun}</span>
            <span className="theme-ico" data-on=${String(isDark)}>${Ico.moon}</span>
          </span>
        </button>
      </div>
    </header>`;
}

/* ============================================================
   BACKEND CALL  (falls back to a faithful local simulation)
   ============================================================ */
async function submitToFastn(payload) {
  const fallbackNo = caseNumber();

  if (!CONFIG.WEBHOOK_URL) {
    await new Promise((r) => setTimeout(r, 850));
    // 1 in 4 demo submissions fails the Slack leg on purpose — this is what
    // makes the PARTIAL → retry → escalate path visible on stage.
    const slackFails = Math.random() < 0.25;
    return {
      caseNo: fallbackNo, live: false,
      delivery: {
        notion: "OK",
        gmail: payload.reporterEmail ? "OK" : "SKIPPED",
        slack: slackFails ? "FAILED" : "OK",
      },
    };
  }

  /* Fastn webhook triggers are fire-and-forget (202, async), so the case number is minted HERE and
     sent with the report. Server-side it doubles as the idempotency key: a double-click or a webhook
     redelivery with the same number is dropped instead of creating a second case.
     Sent as a CORS "simple request" (text/plain + no-cors): the webhook host answers preflights without
     Access-Control-Allow-Origin, and we never needed to read the response anyway. Fastn parses the body
     as JSON regardless of the content type. */
  try {
    await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ ...payload, caseNo: fallbackNo }),
    });
    return {
      caseNo: fallbackNo,
      live: true,
      delivery: { notion: "OK", gmail: payload.reporterEmail ? "OK" : "SKIPPED", slack: "OK" },
    };
  } catch (err) {
    toast("Webhook unreachable", "Fell back to local simulation. Check CONFIG.WEBHOOK_URL and CORS.", "fault");
    return { caseNo: fallbackNo, live: false, delivery: { notion: "FAILED", gmail: "FAILED", slack: "FAILED" } };
  }
}

/* ============================================================
   SHARED BITS
   ============================================================ */
const SEV_N = { Low: 1, Medium: 2, High: 3 };
const Bars = ({ s }) => html`<span className="bars" data-n=${SEV_N[s] || 0} aria-hidden="true"><i /><i /><i /></span>`;
const Sev = ({ s, short }) => html`<span className="sev" title=${`${s} severity`}><${Bars} s=${s} />${s}${short ? "" : " severity"}</span>`;

const STATE_ICON = { OK: Ico.checkSm, FAILED: Ico.x, SKIPPED: Ico.minus };

/* ============================================================
   REPORT VIEW
   ============================================================ */
/* Employers onboarded to Mehfooz — read from the registry in orgs.js, which onboarding appends to.
   An employer's own report link (?org=Their+Name) carries the organization instead: the form is locked
   to it, so a newly onboarded employer works the moment they share their link — no redeploy, no list. */
const LINK_ORG = (PARAMS.get("org") || "").replace(/\s+/g, " ").trim().slice(0, 80);
const ORGS = LINK_ORG ? [LINK_ORG]
  : (Array.isArray(window.MEHFOOZ_ORGS) && window.MEHFOOZ_ORGS.length ? window.MEHFOOZ_ORGS : ["Acme Textiles"]);
const CATEGORIES = [
  "Verbal harassment",
  "Unwelcome physical conduct",
  "Abuse of authority / quid pro quo",
  "Retaliation for a prior complaint",
  "Hostile work environment",
];
const DELIV_LABEL = { notion: "Case record", gmail: "Acknowledgement", slack: "Committee alert" };
/* What happens after submit — the whole product in four beats */
const STEPS = [
  ["Case number", "Issued instantly. No login, no name."],
  ["Committee alerted", "A case link only — never your details."],
  [`Day ${CONFIG.WARN_DAY} warning`, "7 days left to finish the inquiry."],
  [`Day ${CONFIG.DEADLINE_DAYS} escalation`, "Automatic, to the Competent Authority."],
];
const DELIV_SYS = { notion: "Notion", gmail: "Gmail", slack: "Slack" };

function ReportView({ addCase, goTrack }) {
  const [org, setOrg] = useState(ORGS[0]);
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [sev, setSev] = useState("Medium");
  const [desc, setDesc] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  /* ?demo=1 reveals a presenter-only control: file a report as if it were N days old, so the day-23
     warning and the day-30 breach can be shown live instead of waiting a month. */
  const DEMO = PARAMS.get("demo") === "1";
  const [back, setBack] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = {
      tenant: org, category: cat, severity: sev,
      description: desc.trim(),
      reporterEmail: email.trim() || null,   // transient — never persisted to the case record
      reportedAt: new Date().toISOString(),
      deadlineDays: CONFIG.DEADLINE_DAYS,
      ...(DEMO && back > 0 ? { backdateDays: back } : {}),
    };
    const res = await submitToFastn(payload);
    const c = {
      caseNo: res.caseNo, tenant: org, category: cat, severity: sev,
      status: "Received", reportedAt: Date.now(),
      warnNotified: false, breachNotified: false,
      delivery: res.delivery,
    };
    addCase(c);
    setReceipt({ c, live: res.live });
    setBusy(false);

    const failed = Object.entries(res.delivery).filter(([, v]) => v === "FAILED");
    setTimeout(() => {
      if (failed.length) toast("Partial delivery", `${failed.length} step failed. Case marked PARTIAL, queued for retry, escalation armed.`, "fault");
      else toast("Case recorded", res.live
        ? `${res.caseNo} — accepted by Fastn. Case record, committee alert and acknowledgement are being delivered.`
        : `${res.caseNo} — the 30-day statutory clock has started.`, "ok");
    }, 1100);
    if (!res.live) setTimeout(() => toast("Simulation mode", "No webhook wired yet — data is stored locally.", "warn"), 2000);
  };

  if (receipt) {
    const { c, live } = receipt;
    const deadline = new Date(c.reportedAt + CONFIG.DEADLINE_DAYS * 86400000);
    const failed = Object.values(c.delivery).filter((v) => v === "FAILED").length;
    const rows = [
      ["Organization", c.tenant],
      ["Severity", c.severity],
      ["Statutory deadline", deadline.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })],
      ["Inquiry window", `${CONFIG.DEADLINE_DAYS} days`],
    ];
    return html`
      <div className="view center">
        <div className="card narrow" style=${{ margin: "0 auto" }}>
          <div className="receipt">
            <div className="seal">${Ico.check}</div>
            <p className="receipt-lead">Your report has been received and recorded.</p>
            <div className="caseno"><${Scramble} text=${c.caseNo} /></div>
            <p className="receipt-keep">Keep this number. It is the only way to check your case.</p>

            <div className="rows">
              ${rows.map(([k, v], i) => html`
                <div key=${k} className="rrow" style=${{ animationDelay: `${420 + i * 70}ms` }}>
                  <span>${k}</span><span>${v}</span>
                </div>`)}
            </div>

            <div className="pips" aria-label="Delivery status">
              ${Object.entries(c.delivery).map(([k, v], i) => html`
                <div key=${k} className="pip" style=${{ animationDelay: `${700 + i * 90}ms` }}>
                  <span className="pip-k">${DELIV_LABEL[k]} <span className="pip-sys">· ${DELIV_SYS[k]}</span></span>
                  <span className="state" data-v=${v}>${STATE_ICON[v]}${v === "SKIPPED" ? "Not requested" : v === "OK" ? "Delivered" : "Failed"}</span>
                </div>`)}
            </div>

            ${failed ? html`
              <div className="partial" role="note">
                ${Ico.plug}
                <p><b>Partial delivery.</b> ${failed} step${failed > 1 ? "s" : ""} did not complete. Your report is safely recorded and the clock is running — the failed step is queued for retry, and escalation is armed if it stays unresolved.</p>
              </div>` : null}

            <div className="receipt-actions">
              <button className="btn" onClick=${() => goTrack(c.caseNo)}>Track this case ${Ico.arrow}</button>
              <button className="btn ghost" onClick=${() => { setReceipt(null); setDesc(""); setEmail(""); }}>File another</button>
            </div>
            <div className="mode-tag" data-live=${String(live)}><i />${live ? "Delivered via Fastn" : "Local simulation"}</div>
          </div>
        </div>
      </div>`;
  }

  return html`
    <div className="view center">
      <div className="head">
        <div className="eyebrow"><i />Anonymous intake</div>
        <h1>File a report</h1>
        <p className="sub">Your report is received under the Protection Against Harassment of Women at the Workplace Act 2010. You will be given a case number, and the statutory 30-day inquiry clock starts the moment you submit.</p>
      </div>

      <ol className="steps" aria-label="What happens after you submit">
        ${STEPS.map(([t, s], i) => html`
          <li key=${t} className="step" style=${{ "--i": i }}>
            <div className="step-n">${i + 1}</div>
            <b>${t}</b><span>${s}</span>
          </li>`)}
      </ol>

      <div className="card pad narrow" data-busy=${String(busy)} aria-busy=${busy}>
        <div className="busybar" aria-hidden="true" />
        <div className="notice">
          <span className="notice-ic">${Ico.lock}</span>
          <p><b>No name required.</b> Nothing identifying you is written to the case record. The inquiry committee is alerted with a case link only — never your details. Your email, if you give one, is used once to send your case number and is not stored.</p>
        </div>

        <form onSubmit=${submit}>
          <fieldset disabled=${busy}>
            <div className="row2">
              <div className="field">
                <label className="lab" htmlFor="f-org">Organization</label>
                <select className="sel" id="f-org" value=${org} onChange=${(e) => setOrg(e.target.value)}>
                  ${ORGS.map((x) => html`<option key=${x}>${x}</option>`)}
                </select>
              </div>
              <div className="field">
                <label className="lab" htmlFor="f-cat">Category</label>
                <select className="sel" id="f-cat" value=${cat} onChange=${(e) => setCat(e.target.value)}>
                  ${CATEGORIES.map((x) => html`<option key=${x}>${x}</option>`)}
                </select>
              </div>
            </div>

            <div className="field" role="group" aria-labelledby="f-sev">
              <span className="lab" id="f-sev">Severity</span>
              <div className="seg">
                ${["Low", "Medium", "High"].map((s) => html`
                  <button key=${s} type="button" data-sev=${s} aria-pressed=${sev === s}
                    onClick=${() => setSev(s)}><${Bars} s=${s} />${s}</button>`)}
              </div>
            </div>

            <div className="field">
              <label className="lab" htmlFor="f-desc">What happened</label>
              <textarea className="ta" id="f-desc" value=${desc} onChange=${(e) => setDesc(e.target.value)}
                aria-describedby="f-desc-h"
                placeholder="Describe the incident. Include dates and locations if you can — you do not have to name yourself." />
              <span className="hint" id="f-desc-h">Written to the case record. Visible only to the three-member inquiry committee.</span>
            </div>

            <div className="field">
              <label className="lab" htmlFor="f-email">Email for your case number <em>optional</em></label>
              <input className="inp" id="f-email" type="email" autoComplete="off" inputMode="email" value=${email}
                aria-describedby="f-email-h"
                onChange=${(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <span className="hint" id="f-email-h">Used once to send your acknowledgement, then discarded. Leave blank to stay fully anonymous — you can still track by case number.</span>
            </div>

            ${DEMO ? html`
              <div className="field">
                <label className="lab" htmlFor="f-back">Presenter control — report date <em>demo only</em></label>
                <select className="sel" id="f-back" value=${back} onChange=${(e) => setBack(Number(e.target.value))}>
                  <option value="0">Today — the 30-day clock starts now</option>
                  <option value="24">24 days ago — the clock sends the day-23 warning</option>
                  <option value="31">31 days ago — the clock breaches and escalates</option>
                </select>
                <span className="hint">Files this report as if it were older, so the statutory clock can be shown acting on it within minutes. Hidden unless the page is opened with ?demo=1.</span>
              </div>` : null}
          </fieldset>

          <div className="form-foot">
            <button className="btn submit" type="submit" disabled=${busy}>
              ${busy ? html`<span className="spin" aria-hidden="true" />` : null}
              ${busy ? "Recording…" : "Submit report"}
            </button>
            <span className="hint">The 30-day statutory clock starts on submit.</span>
          </div>
        </form>
      </div>
    </div>`;
}

/* ============================================================
   TRACK VIEW
   ============================================================ */
function TrackView({ cases, demo, seed }) {
  const [q, setQ] = useState(seed || "");
  const [hit, setHit] = useState(null);
  const [miss, setMiss] = useState(false);
  const [missQ, setMissQ] = useState("");
  useTick(500);

  const run = useCallback((value) => {
    const v = (value ?? q).trim().toUpperCase();
    const c = cases.find((x) => x.caseNo === v);
    setHit(c || null); setMiss(!c); setMissQ(v);
  }, [q, cases]);

  useEffect(() => { if (seed) { setQ(seed); run(seed); } }, [seed]);

  const live = hit ? cases.find((x) => x.caseNo === hit.caseNo) : null;

  const steps = live ? (() => {
    const el = elapsedDays(live, demo), left = daysLeft(live, demo);
    return [
      { t: "Report received", s: "Case created · statutory clock started", st: "done" },
      { t: "Committee alerted", s: live.delivery.slack === "FAILED" ? "Delivery failed · queued for retry" : "Private channel notified · no identifying details sent", st: live.delivery.slack === "FAILED" ? "fail" : "done" },
      { t: "Inquiry under way", s: "Committee reviewing the case", st: el >= 1 ? "done" : "future" },
      { t: `Day ${CONFIG.WARN_DAY} warning`, s: "Committee warned — 7 days remain", st: el >= CONFIG.WARN_DAY ? "warn" : "future" },
      { t: `Day ${CONFIG.DEADLINE_DAYS} statutory limit`, s: left > 0 ? "Deadline for completing the inquiry" : "BREACHED — escalated to the Competent Authority", st: left <= 0 ? "breach" : "future" },
    ];
  })() : [];
  const STEP_ICON = { done: Ico.checkSm, warn: Ico.clock, breach: Ico.alert, fail: Ico.x, future: null };

  return html`
    <div className="view center">
      <div className="head">
        <div className="eyebrow"><i />Status lookup</div>
        <h1>Track a case</h1>
        <p className="sub">Enter your case number. No login and no name — the number is the credential.</p>
      </div>

      <div className="card pad narrow">
        <label className="lab" htmlFor="f-case" style=${{ marginBottom: "8px" }}>Case number</label>
        <div className="lookup">
          <input className="inp" id="f-case" value=${q} spellCheck="false" autoComplete="off" autoCapitalize="characters"
            placeholder="MHF-0000-AB"
            onChange=${(e) => setQ(e.target.value)}
            onKeyDown=${(e) => { if (e.key === "Enter") run(); }} />
          <button className="btn" onClick=${() => run()}>${Ico.search}Look up</button>
        </div>

        ${miss && !live ? html`
          <div className="empty inline" key=${missQ} role="alert">
            <span className="empty-ic">${Ico.search}</span>
            <b>No case found</b>
            <p>${missQ ? html`Nothing matches <code>${missQ}</code>. ` : null}Check the number on your acknowledgement email — it looks like <code>MHF-0000-AB</code>.</p>
          </div>` : null}

        ${live ? html`
          <div>
            <div className="track-head">
              <${Ring} c=${live} demo=${demo} size=${96} />
              <div style=${{ minWidth: 0 }}>
                <div className="track-id">${live.caseNo}</div>
                <div className="case-meta track-meta">
                  <span>${live.tenant}</span><i className="dot" />
                  <span>${live.category}</span><i className="dot" />
                  <${Sev} s=${live.severity} />
                </div>
                <div style=${{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <${StatusBadge} c=${live} demo=${demo} />
                  ${isPartial(live) ? html`<span className="badge" data-b="partial">Partial</span>` : null}
                </div>
              </div>
            </div>

            <${TimeBar} c=${live} demo=${demo} />

            <div className="tl">
              ${steps.map((s, i) => html`
                <div key=${s.t} className="tl-i" data-s=${s.st} style=${{ "--i": i }}>
                  <span className="tl-dot" aria-hidden="true">${STEP_ICON[s.st]}</span>
                  <div className="tl-t">${s.t}</div>
                  <div className="tl-s">${s.s}</div>
                </div>`)}
            </div>
          </div>` : null}
      </div>
    </div>`;
}

/* ============================================================
   BOARD
   ============================================================ */
function StatusBadge({ c, demo }) {
  const p = phaseOf(c, demo);
  if (p === "breach") return html`<span className="badge" data-b="breach">Breached</span>`;
  if (p === "closed") return html`<span className="badge">Closed</span>`;
  if (p === "warn") return html`<span className="badge" data-b="warn">Due soon</span>`;
  if (c.status === "Under Inquiry") return html`<span className="badge" data-b="inq">Under inquiry</span>`;
  return html`<span className="badge">Received</span>`;
}

function Kpi({ label, value, tone, icon, hot, i }) {
  const n = useCountUp(value);
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (value > prev.current && !CALM && tone !== "brand") setBump((b) => b + 1);
    prev.current = value;
  }, [value]);
  return html`
    <div className="kpi" data-tone=${tone} data-hot=${String(!!hot && value > 0)} style=${{ "--i": i }}>
      ${bump ? html`<span key=${bump} className="kpi-flash" aria-hidden="true" />` : null}
      <div className="kpi-top">
        <span className="kpi-l">${label}</span>
        <span className="kpi-ic">${icon}</span>
      </div>
      <div className="kpi-n tnum"><span key=${bump} className=${bump ? "kpi-bump" : ""}>${n}</span></div>
    </div>`;
}

const DCHIP = { notion: "Notion", gmail: "Gmail", slack: "Slack" };

function CaseCard({ c, demo, i }) {
  const p = phaseOf(c, demo);
  const fresh = useEdge(p === "breach");
  return html`
    <article className="case" data-p=${p} data-fresh=${String(fresh)} style=${{ "--i": i }}>
      <${Ring} c=${c} demo=${demo} size=${60} />
      <div className="case-b">
        <div className="case-top">
          <span className="case-id">${c.caseNo}</span>
          <${StatusBadge} c=${c} demo=${demo} />
        </div>
        <div className="case-meta">
          <span>${c.tenant}</span><i className="dot" />
          <${Sev} s=${c.severity} short=${true} />
        </div>
        <div className="case-cat">${c.category}</div>
        <div className="deliv">
          ${isPartial(c) ? html`<span className="badge" data-b="partial">Partial</span>` : null}
          ${Object.entries(c.delivery).filter(([, v]) => v !== "SKIPPED").map(([k, v]) => html`
            <span key=${k} className=${"dchip " + (v === "OK" ? "ok" : "fail")}
              title=${`${DCHIP[k]}: ${v === "OK" ? "delivered" : "failed — queued for retry"}`}>
              ${v === "OK" ? Ico.checkSm : Ico.x}${DCHIP[k]}
            </span>`)}
        </div>
      </div>
    </article>`;
}

function BoardView({ cases, demo, onSeed }) {
  const [filter, setFilter] = useState("all");
  useTick(500);

  const counts = useMemo(() => {
    const open = cases.filter((c) => ["ok", "warn"].includes(phaseOf(c, demo))).length;
    const warn = cases.filter((c) => phaseOf(c, demo) === "warn").length;
    const breach = cases.filter((c) => phaseOf(c, demo) === "breach").length;
    const fail = cases.filter((c) => Object.values(c.delivery).includes("FAILED")).length;
    return { open, warn, breach, fail, all: cases.length };
  }, [cases, demo, Math.floor(Date.now() / 500)]);

  const match = (c) => {
    const p = phaseOf(c, demo);
    if (filter === "all") return true;
    if (filter === "open") return p === "ok" || p === "warn";
    if (filter === "warn") return p === "warn";
    if (filter === "breach") return p === "breach";
    if (filter === "fail") return Object.values(c.delivery).includes("FAILED");
    return true;
  };
  const list = cases.filter(match);

  const FILTERS = [
    ["all", "All", counts.all],
    ["open", "Open", counts.open],
    ["warn", "Due soon", counts.warn],
    ["breach", "Breached", counts.breach],
    ["fail", "Delivery failed", counts.fail],
  ];
  const activeLabel = (FILTERS.find(([id]) => id === filter) || FILTERS[0])[1];

  return html`
    <div className="view">
      <div className="head">
        <div className="eyebrow"><i />Inquiry committee</div>
        <h1>Case board</h1>
        <p className="sub">Every case carries the statutory inquiry deadline. At day ${CONFIG.WARN_DAY} the committee is warned; at day ${CONFIG.DEADLINE_DAYS} the case breaches and escalates to the Competent Authority automatically.</p>
      </div>

      <div className="kpis">
        <${Kpi} i=${0} label="Open cases" value=${counts.open} tone="brand" icon=${Ico.inbox} />
        <${Kpi} i=${1} label="Due within 7 days" value=${counts.warn} tone="warn" icon=${Ico.clock} hot=${true} />
        <${Kpi} i=${2} label="Statutory breaches" value=${counts.breach} tone="breach" icon=${Ico.alert} hot=${true} />
        <${Kpi} i=${3} label="Delivery failures" value=${counts.fail} tone="fault" icon=${Ico.plug} hot=${true} />
      </div>

      <div className="toolbar">
        <div className="filters-scroll">
          <div className="filters" role="tablist" aria-label="Filter cases">
            ${FILTERS.map(([id, label, n]) => html`
              <button key=${id} className="filt" role="tab" aria-selected=${filter === id}
                data-f=${id} data-n=${String(n > 0)}
                onClick=${() => setFilter(id)}>${label}<b className="tnum">${n}</b></button>`)}
          </div>
        </div>
        <div className="toolbar-sp" />
        <button className="btn ghost sm" onClick=${onSeed}>${Ico.layers}Seed demo cases</button>
      </div>

      <div className="cases">
        ${cases.length === 0 ? html`
          <div className="empty">
            <span className="empty-ic">${Ico.inbox}</span>
            <b>No cases on the board</b>
            <p>Reports filed through the anonymous intake appear here with their statutory clock already running.</p>
            <button className="btn sm" onClick=${onSeed}>${Ico.layers}Seed demo cases</button>
          </div>`
        : list.length === 0 ? html`
          <div className="empty" key=${filter}>
            <span className="empty-ic">${Ico.filter}</span>
            <b>No cases match “${activeLabel}”</b>
            <p>Submit a report, or seed the demo set.</p>
            <button className="btn ghost sm" onClick=${() => setFilter("all")}>Show all ${counts.all} cases</button>
          </div>`
        : list.map((c, i) => html`<${CaseCard} key=${c.caseNo} c=${c} demo=${demo} i=${i} />`)}
      </div>
    </div>`;
}

/* ============================================================
   BACKDROP — an animated gradient, no imagery.
   Four soft colour fields — lace, sage, beige and sapphire — drift slowly over a lace ground and blend
   into one another, like a mesh gradient. Generated in CSS, so it works offline and costs nothing to load.
   ============================================================ */
function Backdrop() {
  return html`
    <div className="backdrop" aria-hidden="true">
      <div className="bd-wash"><i className="w1" /><i className="w2" /><i className="w3" /><i className="w4" /><i className="w5" /></div>
      <div className="bd-grain" />
    </div>`;
}
/* ============================================================
   HOME — the landing card
   ============================================================ */
const HOME_LINKS = [
  { id: "report",    label: "Report an Issue",     sub: "Anonymous. No login, no name.",          icon: "arrow" },
  { id: "track",     label: "Track your Case",     sub: "Your case number is the only key.",      icon: "search" },
  { id: "board",     label: "Committee",           sub: "Every case against its 30-day deadline.", icon: "layers" },
  { id: "employers", label: "Employer onboarding", sub: "Connect Notion, Slack and Gmail — no code.", icon: "plug" },
];

function HomeView({ go, isDark, cycleTheme }) {
  return html`
    <div className="hero">
      <button className="ibtn hero-theme" onClick=${cycleTheme} aria-pressed=${isDark}
        aria-label=${isDark ? "Switch to light theme" : "Switch to dark theme"}>
        <span className="theme-stack">
          <span className="theme-ico" data-on=${String(!isDark)}>${Ico.sun}</span>
          <span className="theme-ico" data-on=${String(isDark)}>${Ico.moon}</span>
        </span>
      </button>

      <main className="hero-card" id="main" tabIndex="-1">
        <header className="hero-head">
          <h1 className="hero-title">Mehfooz</h1>
          <p className="hero-tag">The 30-day clock that doesn't stop. Report workplace harassment safely — and make sure it is acted on.</p>
        </header>

        <nav className="hero-links" aria-label="What would you like to do?">
          ${HOME_LINKS.map((l, i) => html`
            <button key=${l.id} className="hlink" style=${{ "--i": i }} onClick=${() => go(l.id)}>
              <span className="hlink-t"><b>${l.label}</b><small>${l.sub}</small></span>
              <span className="hlink-i">${Ico[l.icon]}</span>
            </button>`)}
        </nav>
      </main>

      <p className="hero-foot">Protection Against Harassment of Women at the Workplace Act 2010<span> · </span>No login<span> · </span>No name required</p>
    </div>`;
}

/* ============================================================
   EMPLOYERS — no-code onboarding through the Fastn embed widget
   ============================================================ */
const ONBOARD = [
  ["Sign up", "We create a private tenant for your organization."],
  ["Connect your apps", "Notion, Slack and Gmail — sign in to your own accounts."],
  ["Choose where cases go", "Your case database, committee and authority channels."],
  ["Share your report link", "Staff can report anonymously from day one."],
];
const APPS = [
  ["Notion", "Your private case register. Reporter identity is never written to it."],
  ["Slack", "Alerts your inquiry committee with a case link only, and escalates breaches to your Competent Authority."],
  ["Gmail", "Sends the reporter's acknowledgement and the statutory notice to the Ombudsman."],
];

/* Step 4 of onboarding. The employer's report link carries their organization (?org=), so the form is
   locked to it — staff never pick their employer from a list, and a new employer needs no redeploy. */
function ReportLink() {
  const [name, setName] = useState(LINK_ORG);
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
  const link = clean ? location.href.split(/[?#]/)[0] + "?view=report&org=" + encodeURIComponent(clean) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast("Report link copied", "Share it with your staff — intranet, posters, a QR code.", "ok"); }
    catch (e) { toast("Couldn't copy", "Select the link and copy it manually.", "warn"); }
  };
  return html`
    <div className="card pad narrow" style=${{ marginTop: "var(--s5)" }}>
      <div className="field">
        <label className="lab" htmlFor="e-org">Your organization's report link</label>
        <input className="inp" id="e-org" value=${name} maxLength="80" autoComplete="organization"
          placeholder="Organization name, e.g. Karakoram Bank" onChange=${(e) => setName(e.target.value)} />
        <span className="hint">Once your workspace is connected, this is the link you share with staff. It opens the report form locked to your organization — every case is filed under it and reaches only your committee.</span>
      </div>
      ${link ? html`
        <div className="field">
          <input className="inp mono" readOnly value=${link} aria-label="Report link" onFocus=${(e) => e.target.select()} />
        </div>
        <div className="form-foot">
          <button type="button" className="btn submit" onClick=${copy}>Copy report link</button>
          <button type="button" className="btn submit ghost" onClick=${() => window.open(link, "_blank", "noopener")}>Preview the form</button>
        </div>` : null}
    </div>`;
}

/* The embed takes its look from query params: a title and a theme ({primary}) — set to Mehfooz's ink. */
const EMBED_ORIGIN = CONFIG.EMBED_URL ? new URL(CONFIG.EMBED_URL).origin : "";
const EMBED_SRC = CONFIG.EMBED_URL
  ? CONFIG.EMBED_URL + "&title=" + encodeURIComponent("Connect your workspace") +
    "&theme=" + encodeURIComponent(JSON.stringify({ primary: "#111111" }))
  : "";
/* Fastn allows any http(s) site to frame the widget (`frame-ancestors *`), but `*` never matches file://.
   Opened straight from disk, the page falls back to launching the same widget in its own window. */
const CAN_EMBED = !!EMBED_SRC && location.protocol !== "file:";

function EmployersView() {
  /* Fastn setup links are deliberately short-lived (about 15 minutes) and single-purpose. The page knows
     when its link lapses and says so, instead of sending an employer to a dead "session expired" screen. */
  useTick(1000);
  const expires = CONFIG.SETUP_EXPIRES ? Date.parse(CONFIG.SETUP_EXPIRES) : NaN;
  const msLeft = isNaN(expires) ? Infinity : expires - Date.now();
  const ready = !!CONFIG.SETUP_URL && msLeft > 0;
  const lapsed = !!CONFIG.SETUP_URL && msLeft <= 0;
  const mm = Math.max(0, Math.floor(msLeft / 60000)), ss = Math.max(0, Math.floor((msLeft % 60000) / 1000));
  /* Fastn's connect widget lives INLINE on this page (the embed endpoint allows framing; the OAuth consent
     screens it launches open in their own window, as Notion / Slack / Google require). The widget tells us
     when it has rendered via postMessage, which is when the loading veil comes off. The one-time setup link
     stays as a fallback: the same flow in a separate window. */
  const [hubReady, setHubReady] = useState(false);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== EMBED_ORIGIN || !e.data) return;
      if (e.data.type === "fastn:hub-ready") setHubReady(true);   // "fastn:ready" fires earlier, before it has rendered
    };
    window.addEventListener("message", onMsg);
    const t = setTimeout(() => setHubReady(true), 12000);  // never leave the veil up if the message is missed
    return () => { window.removeEventListener("message", onMsg); clearTimeout(t); };
  }, []);
  const [phase, setPhase] = useState(PARAMS.get("connect") || "idle");   // idle → open (fallback window) → done
  const launch = () => {
    const w = 540, h = 780;
    const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || w) - w) / 2));
    const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || h) - h) / 2));
    const win = window.open(CONFIG.SETUP_URL, "mehfoozConnect", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!win) { toast("Pop-up blocked", "Allow pop-ups for this page, then press Connect again.", "warn"); return; }
    try { win.focus(); } catch (e) {}
    setPhase("open");
  };
  const finish = () => {
    setPhase("done");
    setTimeout(() => {
      const el = document.getElementById("e-org");
      if (el) { el.scrollIntoView({ behavior: CALM ? "auto" : "smooth", block: "center" }); el.focus({ preventScroll: true }); }
    }, 60);
  };

  return html`
    <div className="view center">
      <div className="head">
        <div className="eyebrow"><i />For employers</div>
        <h1>Bring Mehfooz to your organization</h1>
        <p className="sub">The Act already requires you to run an inquiry committee and finish every inquiry within 30 days. Mehfooz keeps that clock for you — connect the tools you already use, with no code and no IT project.</p>
      </div>

      <ol className="steps" aria-label="How onboarding works">
        ${ONBOARD.map(([t, s], i) => html`
          <li key=${t} className="step" style=${{ "--i": i }}>
            <div className="step-n">${i + 1}</div>
            <b>${t}</b><span>${s}</span>
          </li>`)}
      </ol>

      <div className="card pad narrow">
        <ul className="apps">
          ${APPS.map(([n, d], i) => html`
            <li key=${n} className="app" style=${{ "--i": i }}>
              <span className="app-ic">${Ico.plug}</span>
              <span><b>${n}</b><small>${d}</small></span>
            </li>`)}
        </ul>

        ${CAN_EMBED ? html`
          <div className="embed-frame">
            ${hubReady ? null : html`<div className="embed-wait" role="status">Loading Fastn's connect widget…</div>`}
            <iframe title="Connect your workspace — Fastn embedded widget" src=${EMBED_SRC}
              allow="clipboard-write" referrerPolicy="no-referrer" />
          </div>` : null}

        ${phase === "open" ? html`
          <div className="notice" role="status" style=${{ marginTop: "var(--s4)" }}>
            <span className="notice-ic">${Ico.lock}</span>
            <p><b>Fastn's secure connect window is open.</b> Sign in to your own Notion, Slack and Gmail there — Mehfooz never sees a password, and your data stays in your workspace. Come back here when you are done.</p>
          </div>` : null}
        ${phase === "done" ? html`
          <div className="notice" role="status" style=${{ marginTop: "var(--s4)" }}>
            <span className="notice-ic">${Ico.checkSm}</span>
            <p><b>Thank you — one step left.</b> Mehfooz confirms each connection with Fastn before your first case is routed. Create your report link below and share it with your staff.</p>
          </div>` : null}
        <div className="form-foot">
          ${CAN_EMBED ? html`
            ${phase === "done" ? null : html`
              <button className="btn submit" onClick=${finish}>I've finished connecting${Ico.arrow}</button>`}
            ${ready && phase !== "done" ? html`
              <button className="btn submit ghost" onClick=${launch}>Open in a separate window instead</button>` : null}`
          : ready && phase === "open" ? html`
            <button className="btn submit" onClick=${finish}>I've finished connecting${Ico.arrow}</button>
            <button className="btn submit ghost" onClick=${launch}>Reopen the connect window</button>`
          : ready ? html`
            <button className=${"btn submit" + (phase === "done" ? " ghost" : "")} onClick=${launch}>
              ${phase === "done" ? "Connect another app" : "Connect your workspace"}${Ico.arrow}
            </button>` : null}
          <span className="hint">
            ${CAN_EMBED
              ? "This is Fastn's embedded connect widget. You sign in to your own accounts — Mehfooz never sees a password, your tokens are held and refreshed by Fastn, and your data stays in your workspace."
              : ready
                ? "Opens Fastn's connect widget in its own window. You sign in to your own accounts — Mehfooz never sees a password."
                : CONFIG.EMBED_URL
                  ? "Open Mehfooz from http://localhost:5173 (run.bat) to connect your workspace right here on this page."
                  : "No Fastn widget is configured in this copy. Set CONFIG.EMBED_URL in app.js (Fastn -> Widgets -> Embed code) and the connect widget appears right here."}
          </span>
        </div>
      </div>

      <${ReportLink} />
    </div>`;
}

/* ============================================================
   APP
   ============================================================ */
function App() {
  const [view, setView] = useState(() =>
    ["home", "report", "track", "board", "employers"].includes(PARAMS.get("view")) ? PARAMS.get("view") : "home");
  const [demo, setDemo] = useState(true);
  const [cases, setCases] = useState(loadCases);
  const [trackSeed, setTrackSeed] = useState("");
  const [, isDark, cycleTheme] = useTheme();

  /* view cross-fade: the outgoing view fades first, then the new one rises in */
  const [shown, setShown] = useState(view);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (view === shown) { setLeaving(false); return; }
    if (CALM) { setShown(view); return; }
    setLeaving(true);
    const t = setTimeout(() => { setShown(view); setLeaving(false); }, 150);
    return () => clearTimeout(t);
  }, [view]);

  useEffect(() => saveCases(cases), [cases]);

  const addCase = (c) => setCases((l) => [c, ...l]);

  /* clock watcher — fires the warning and the breach */
  useEffect(() => {
    const id = setInterval(() => {
      setCases((list) => {
        let dirty = false;
        const next = list.map((c) => {
          const p = phaseOf(c, demo);
          if (p === "warn" && !c.warnNotified) {
            dirty = true;
            toast(`Day ${CONFIG.WARN_DAY} warning`, `${c.caseNo} — 7 days left to complete the inquiry.`, "warn");
            return { ...c, warnNotified: true };
          }
          if (p === "breach" && !c.breachNotified) {
            dirty = true;
            toast("Statutory breach", `${c.caseNo} — ${CONFIG.DEADLINE_DAYS} days elapsed. Escalated to the Competent Authority; breach recorded.`, "breach");
            return { ...c, breachNotified: true, status: "Escalated" };
          }
          return c;
        });
        return dirty ? next : list;
      });
    }, 500);
    return () => clearInterval(id);
  }, [demo]);

  const goTrack = (no) => { setTrackSeed(no); setView("track"); };

  const onSeed = () => {
    const unit = CONFIG.DEMO_SECONDS_PER_DAY * 1000;
    // Thresholds a seeded case has ALREADY crossed are marked notified, so only
    // transitions that happen live on stage raise an alert (day 21 → warning,
    // day 26 → breach). That is the demo beat; a flood at seed time buries it.
    const mk = (tenant, category, severity, agoDays, status, delivery) => ({
      caseNo: caseNumber(), tenant, category, severity,
      status: agoDays >= CONFIG.DEADLINE_DAYS ? "Escalated" : status,
      reportedAt: Date.now() - agoDays * unit,
      warnNotified: agoDays >= CONFIG.WARN_DAY,
      breachNotified: agoDays >= CONFIG.DEADLINE_DAYS,
      delivery,
    });
    setCases((old) => [
      mk("Acme Textiles", "Abuse of authority / quid pro quo", "High", 2, "Under Inquiry", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Acme Textiles", "Verbal harassment", "Medium", 21, "Under Inquiry", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Acme Textiles", "Hostile work environment", "Medium", 26, "Received", { notion: "OK", gmail: "SKIPPED", slack: "FAILED" }),
      mk("Beta Foods", "Retaliation for a prior complaint", "High", 33, "Received", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Beta Foods", "Unwelcome physical conduct", "Low", 6, "Under Inquiry", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Indus Logistics", "Retaliation for a prior complaint", "High", 17, "Under Inquiry", { notion: "OK", gmail: "SKIPPED", slack: "OK" }),
      mk("Karakoram Bank", "Verbal harassment", "Medium", 3, "Received", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Karakoram Bank", "Abuse of authority / quid pro quo", "Low", 12, "Closed", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Margalla Health", "Unwelcome physical conduct", "High", 8, "Under Inquiry", { notion: "OK", gmail: "OK", slack: "OK" }),
      mk("Sialkot Sports Co.", "Hostile work environment", "Medium", 14, "Under Inquiry", { notion: "OK", gmail: "SKIPPED", slack: "OK" }),
      ...old,
    ]);
    toast("Demo cases seeded", "Six organizations, fully isolated. The day-26 case breaches in a few seconds.", "ok");
  };

  useEffect(() => { if (PARAMS.get("seed") === "1") onSeed(); }, []);

  return html`
    <${React.Fragment}>
      <${Backdrop} />
      <a className="skip" href="#main">Skip to content</a>
      ${shown === "home" ? html`
        <div className=${"stage" + (leaving ? " leaving" : "")}>
          <${HomeView} go=${setView} isDark=${isDark} cycleTheme=${cycleTheme} />
        </div>
        <${Toasts} />` : html`<${React.Fragment}>
      <${TopBar} view=${view} setView=${setView} demo=${demo} setDemo=${setDemo}
        isDark=${isDark} cycleTheme=${cycleTheme} />
      <main className="shell" id="main" tabIndex="-1">
        <div className=${"stage" + (leaving ? " leaving" : "")} role="tabpanel">
          ${shown === "report" ? html`<${ReportView} key="r" addCase=${addCase} goTrack=${goTrack} />` : null}
          ${shown === "track" ? html`<${TrackView} key="t" cases=${cases} demo=${demo} seed=${trackSeed} />` : null}
          ${shown === "board" ? html`<${BoardView} key="b" cases=${cases} demo=${demo} onSeed=${onSeed} />` : null}
          ${shown === "employers" ? html`<${EmployersView} key="e" />` : null}
        </div>

        <p className="foot">
          <b>Demo build.</b> Every case shown is fabricated. Mehfooz is a compliance-infrastructure prototype, not a legal service; a real deployment requires security, privacy and legal review before it handles a real report.
          ${" "}${CONFIG.WEBHOOK_URL
            ? html`<${React.Fragment}><b>Wired</b> to the Fastn intake webhook.<//>`
            : html`<${React.Fragment}><b>Not yet wired</b> — running on local simulation until <code>CONFIG.WEBHOOK_URL</code> is set in <code>app.js</code>.<//>`}
        </p>
      </main>
      <${Toasts} />
      <//>`}
    <//>`;
}

ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);