"use client";

import { useEffect, useRef, useState } from "react";
import { Duck } from "./Duck";

type AgentState = "busy" | "idle" | "wait";

/* ── live dashboard recreation ── */

const AGENTS: {
  name: string;
  meta: string;
  badge: string;
  state: AgentState;
}[] = [
  {
    name: "api-refactor",
    meta: "checkout-service · 31 ev",
    badge: "WATCHED",
    state: "busy",
  },
  {
    name: "auth-migration",
    meta: "checkout-service · 14 ev",
    badge: "WATCHED",
    state: "wait",
  },
  {
    name: "release-notes",
    meta: "docs · 9 ev",
    badge: "LAUNCHED",
    state: "idle",
  },
  {
    name: "search-feature",
    meta: "forked · api-refactor · 6 ev",
    badge: "WATCHED",
    state: "busy",
  },
  {
    name: "dep-upgrade",
    meta: "checkout-service · 22 ev",
    badge: "LAUNCHED",
    state: "busy",
  },
];

// The pool the live Pulse feed cycles through, newest pushed on top every tick.
const FEED: { name: string; line: string; ok?: boolean }[] = [
  { name: "api-refactor", line: "Bash · npm run test -- checkout", ok: true },
  { name: "api-refactor", line: "Edit · src/checkout/idempotency.ts" },
  { name: "dep-upgrade", line: "Bash · npm outdated --json", ok: true },
  { name: "auth-migration", line: "Grep · refund · src/payments" },
  { name: "search-feature", line: "Read · src/checkout/store.ts", ok: true },
  { name: "api-refactor", line: "Edit · src/checkout/store.ts" },
  { name: "release-notes", line: "prompt · draft the 0.3 release notes" },
  { name: "dep-upgrade", line: "Bash · npm install && npm test", ok: true },
  { name: "auth-migration", line: "Read · src/payments/refund.ts" },
  { name: "search-feature", line: "Bash · rg 'searchIndex' src", ok: true },
  { name: "api-refactor", line: "Edit · src/checkout/types.ts" },
  { name: "dep-upgrade", line: "Bash · npm audit fix", ok: true },
];

interface PulseItem {
  id: number;
  time: string;
  name: string;
  line: string;
  ok?: boolean;
}

function clock(secondsAgo: number): string {
  // A fixed 8:24:xx base so the feed reads like a real session timeline without
  // depending on the visitor's wall clock (and without hydration mismatch).
  const total = 8 * 3600 + 24 * 60 + 8 - secondsAgo;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function Dashboard() {
  const [rows, setRows] = useState<PulseItem[]>(() =>
    FEED.slice(0, 8).map((f, i) => ({ id: i, time: clock(i * 11), ...f })),
  );
  const nextId = useRef(FEED.length);
  const feedIdx = useRef(8 % FEED.length);
  const tick = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;
    const t = setInterval(() => {
      tick.current += 1;
      const f = FEED[feedIdx.current % FEED.length];
      feedIdx.current += 1;
      const id = nextId.current++;
      setRows((prev) => [
        { id, time: clock(-tick.current * 4), ...f },
        ...prev.slice(0, 7),
      ]);
    }, 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-brand">
          <Duck size={18} />
          <span>RubberDuckHQ</span>
          <span className="live-dot" />
          <span className="live-label">Live</span>
        </div>
        <div className="dash-actions">
          <span className="dbtn">Compare</span>
          <span className="dbtn">Snapshots</span>
          <span className="dbtn dbtn-primary">New session</span>
        </div>
      </div>
      <div className="dash-grid">
        {/* agents */}
        <div className="dash-col">
          <div className="col-head">Agents</div>
          <div className="tabs">
            <span className="tab tab-on">Active 4</span>
            <span className="tab">Idle 1</span>
            <span className="tab">Watched 5</span>
            <span className="tab">All 5</span>
          </div>
          {AGENTS.map((a) => (
            <AgentRow key={a.name} {...a} />
          ))}
        </div>
        {/* needs human */}
        <div className="dash-col">
          <div className="col-head">Needs human</div>
          <Hitl name="auth-migration" cmd="psql -c 'DROP TABLE refunds_tmp'" />
          <Hitl name="dep-upgrade" cmd="rm -rf node_modules && npm ci" />
        </div>
        {/* pulse — ticks a new row in on an interval */}
        <div className="dash-col">
          <div className="col-head">
            Pulse <span className="pulse-live">● live</span>
          </div>
          <div className="pulse-feed">
            {rows.map((r) => (
              <PulseRow key={r.id} {...r} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  name,
  meta,
  badge,
  state,
}: {
  name: string;
  meta: string;
  badge: string;
  state: AgentState;
}) {
  const label =
    state === "busy" ? "BUSY" : state === "wait" ? "WAITING" : "IDLE";
  return (
    <div className="arow">
      <div className="arow-main">
        <div className="arow-name">{name}</div>
        <div className="arow-meta">{meta}</div>
      </div>
      <div className="arow-right">
        <span className="arow-badge">{badge}</span>
        <span className={`arow-state st-${state}`}>
          <span className={`dot-${state}`} /> {label}
        </span>
      </div>
    </div>
  );
}

function Hitl({ name, cmd }: { name: string; cmd: string }) {
  return (
    <div className="hitl">
      <div className="hitl-top">
        <span className="hitl-name">
          <span className="dot-wait" /> {name}
        </span>
      </div>
      <div className="hitl-cmd">
        Bash · <code>{cmd}</code>
      </div>
      <div className="hitl-cta">
        <span className="approve">Approve</span>
        <span className="deny">Deny</span>
      </div>
    </div>
  );
}

function PulseRow({ time, name, line, ok }: PulseItem) {
  return (
    <div className="prow">
      <span className="ptime">{time}</span>
      <div className="pbody">
        <span className="pname">{name}</span>
        <span className="pline">
          <span className={ok ? "pmark-ok" : "pmark-run"}>
            {ok ? "✓" : "→"}
          </span>{" "}
          {line}
        </span>
      </div>
    </div>
  );
}

/* ── new-session walkthrough (looping animation) ── */

const STEPS = ["click", "agent", "folder", "landed"] as const;
type Step = (typeof STEPS)[number];

export function Walkthrough() {
  const [step, setStep] = useState<Step>("click");

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setStep("landed");
      return;
    }
    const order: [Step, number][] = [
      ["click", 1400],
      ["agent", 1800],
      ["folder", 1800],
      ["landed", 2200],
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const [s, ms] = order[i % order.length];
      setStep(s);
      i += 1;
      timer = setTimeout(run, ms);
    };
    run();
    return () => clearTimeout(timer);
  }, []);

  const at = (s: Step) => STEPS.indexOf(step) >= STEPS.indexOf(s);

  // Modal is up while choosing; on "landed" it closes so the new row + toast
  // become the focus.
  const modalOpen = step === "agent" || step === "folder";

  return (
    <div className="walk">
      {/* the real dark dashboard (all three panels), as the backdrop */}
      <div className={`dash walk-dash ${modalOpen ? "dimmed" : ""}`}>
        <div className="dash-top">
          <div className="dash-brand">
            <Duck size={18} />
            <span>RubberDuckHQ</span>
            <span className="live-dot" />
            <span className="live-label">Live</span>
          </div>
          <div className="dash-actions">
            <span className="dbtn">Compare</span>
            <span className="dbtn">Snapshots</span>
            <span
              className={`dbtn dbtn-primary ${step === "click" ? "press" : ""}`}
            >
              New session
            </span>
          </div>
        </div>
        <div className="dash-grid">
          {/* agents — the new session slides in at the top when it lands */}
          <div className="dash-col">
            <div className="col-head">Agents</div>
            <div className="tabs">
              <span className="tab tab-on">
                Active {step === "landed" ? 5 : 4}
              </span>
              <span className="tab">Idle 1</span>
              <span className="tab">Watched {step === "landed" ? 6 : 5}</span>
              <span className="tab">All {step === "landed" ? 6 : 5}</span>
            </div>
            <div
              className={`arow walk-newrow ${step === "landed" ? "in" : ""}`}
            >
              <div className="arow-main">
                <div className="arow-name">checkout-service</div>
                <div className="arow-meta">codex · just now</div>
              </div>
              <div className="arow-right">
                <span className="arow-badge">WATCHED</span>
                <span className="arow-state st-busy">
                  <span className="dot-busy" /> BUSY
                </span>
              </div>
            </div>
            {AGENTS.map((a) => (
              <AgentRow key={a.name} {...a} />
            ))}
          </div>
          {/* needs human */}
          <div className="dash-col">
            <div className="col-head">Needs human</div>
            <Hitl
              name="auth-migration"
              cmd="psql -c 'DROP TABLE refunds_tmp'"
            />
            <Hitl name="dep-upgrade" cmd="rm -rf node_modules && npm ci" />
          </div>
          {/* pulse */}
          <div className="dash-col">
            <div className="col-head">
              Pulse <span className="pulse-live">● live</span>
            </div>
            <div className="pulse-feed">
              {FEED.slice(0, 7).map((f, i) => (
                <PulseRow key={i} id={i} time={clock(i * 11)} {...f} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* the New session modal, floating over the dashboard */}
      <div className={`walk-overlay ${modalOpen ? "show" : ""}`}>
        <div className="walk-modal">
          <div className="walk-modal-head">New session</div>

          <div className="walk-field">
            <span className="walk-label">Agent</span>
            <div className="walk-pills">
              {["Claude Code", "Codex", "Copilot"].map((a) => (
                <span
                  key={a}
                  className={`walk-pill ${
                    at("agent") && a === "Codex" ? "sel" : ""
                  }`}
                >
                  {a}
                </span>
              ))}
            </div>
          </div>

          <div className={`walk-field ${at("folder") ? "" : "dim"}`}>
            <span className="walk-label">Folder</span>
            <div className={`walk-folder ${at("folder") ? "sel" : ""}`}>
              📁 ~/code/checkout-service
            </div>
          </div>

          <button className={`walk-launch ${at("folder") ? "ready" : ""}`}>
            Launch
          </button>
        </div>
      </div>

      {/* confirmation toast, after it lands */}
      <div className={`walk-toast ${step === "landed" ? "show" : ""}`}>
        <span className="walk-check">✓</span> Added to RubberDuckHQ — now
        watching <strong>checkout-service</strong>
      </div>
    </div>
  );
}
