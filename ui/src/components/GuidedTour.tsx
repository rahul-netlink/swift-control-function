import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DemoState, TransferResult } from "../types";
import type { TransferFormValues } from "./TransferForm";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

type FeedTab = "activity" | "sanctions" | "policy";

/**
 * What the guided tour is allowed to do. The judge clicks the real controls;
 * the tour only sets the stage — reset to a clean ledger, pre-fill the transfer
 * form, switch the live-feed tab — and waits out the asynchronous re-screen so a
 * "should clear now" retry does not race the epoch-floor window.
 */
export interface TourController {
  reset: () => Promise<void>;
  setForm: (f: TransferFormValues) => void;
  setFeedTab: (t: FeedTab) => void;
  awaitRescreen: (roles: string[]) => Promise<void>;
}

const REASONS: Record<string, string> = {
  OK00: "Cleared. Every rule passed and the transfer settled.",
  AML02: "Sanctions hit. This party matches the consolidated screening list.",
  STL08: "Stale clearance. The last clearance sits behind the network freshness line, so a fresh check is forced before this can settle.",
  BND13: "Link revoked. The wallet's link to its institution was pulled. It is sticky, so a re-screen cannot restore it.",
  EDD10: "Held for review. A transfer of this size needs a three-of-three approval before it can settle.",
  LIM07: "Above the top threshold. The amount is refused outright.",
  CAP05: "Holder cap reached for this instrument.",
  FRZ06: "Party frozen.",
  JUR03: "Destination jurisdiction not permitted.",
  CTP12: "Counterparty type not eligible for this instrument.",
  LCK04: "Lock-up period has not elapsed.",
  VEL11: "Too many transfers inside the rolling time window.",
  BLCK01: "KYC standing missing or invalid.",
};

type Sel = string | string[];

type Watch = "transfer" | "manual" | ((s: DemoState) => boolean);

interface Cue {
  section: string;
  title: string;
  body: ReactNode;
  /** What the judge should click, in their own words. */
  instruct: string;
  /** Real element to spotlight before the action. */
  spotlight: Sel;
  /** Real element to spotlight once the action is detected (defaults to spotlight). */
  spotlightDone?: Sel;
  /** Stage-setting only — no result is produced by this call. */
  prep?: (c: TourController) => void;
  watch: Watch;
  /** After a state cue completes, wait for the re-screen to refresh these roles. */
  afterSettle?: string[];
  /** Extra context shown under a transfer outcome. */
  note?: ReactNode;
  /** Confirmation shown when a state cue completes. */
  doneNote?: ReactNode;
  /** Show the asset-agnostic representations from the decision. */
  showAgnostic?: boolean;
}

const form = (over: Partial<TransferFormValues> = {}): TransferFormValues => ({
  from: "debtco",
  to: "fundmgr",
  amount: "250000",
  asset: "erc3643",
  assetClass: "bond",
  path: "hot",
  ...over,
});

const party = (s: DemoState, role: string) => s.parties.find((p) => p.role === role);

const CUES: Cue[] = [
  {
    section: "The baseline",
    title: "Start with a payment that should go through",
    body: (
      <>
        Here is an ordinary settlement, already filled in for you: EUR 250,000 of a tokenized bond moving from
        DebtCo to FundMgr. When you submit it, the control function runs the whole rulebook in a single pass,
        checking identity, sanctions, jurisdiction, the counterparty, lock-ups, holding limits, the size of the
        trade and recent velocity. It clears the transfer only if every rule passes. A single failure anywhere
        blocks the entire transfer.
      </>
    ),
    instruct: "Click Submit transfer on the form",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=trace-tab]",
    prep: (c) => c.setForm(form({ path: "auto" })),
    watch: "transfer",
    note: (
      <>
        Open the highlighted <b>Compliance trace</b> tab to see each rule it checked. The Decision tab's
        Validity row shows how fresh this clearance is, which turns out to be the whole story of the next
        chapter.
      </>
    ),
  },
  {
    section: "A sanctions event",
    title: "A name lands on the sanctions list",
    body: (
      <>
        Now something changes in the outside world. The monitor watches a consolidated sanctions feed, and
        LuxClear has just been listed. Listing a party makes one change on-chain: it moves a network-wide
        freshness line, the moment that every clearance must now be newer than. In a single step, every
        clearance taken before this point is treated as out of date. No timers, no message sent to each party:
        one line moves and the whole network is affected at once.
      </>
    ),
    instruct: "Click Sanction on LuxClear's row",
    spotlight: "[data-tour=sanction-luxclear]",
    spotlightDone: "[data-tour=feed]",
    prep: (c) => c.setFeedTab("sanctions"),
    watch: (s) => Boolean(party(s, "luxclear")?.sanctioned),
    doneNote: "The freshness line has moved. Every earlier clearance is now considered stale, and not one per-party message was sent.",
  },
  {
    section: "A sanctions event",
    title: "The same payment, two different answers",
    body: (
      <>
        Try the clean payment again, between two parties who are on no list at all. If you are quick, it is
        refused: their last clearance now sits behind the freshness line, so the engine forces a fresh check
        before it will settle. The monitor re-screens everyone automatically in the background. Wait a moment,
        submit once more, and the very same payment clears.
      </>
    ),
    instruct: "Click Submit (try it twice, a few seconds apart)",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form()),
    watch: "transfer",
    note: "Two different answers to one unchanged payment. The freshness line did the work, not a notice sent to each party. If you only ever saw it clear, the background re-screen had already brought these two parties up to date.",
  },
  {
    section: "A sanctions event",
    title: "The listed party stays blocked",
    body: (
      <>
        Re-screening lets clean parties recover, but it must never wave through the party that was actually
        listed. Send the payment to LuxClear itself. This one stays refused, because it is a genuine sanctions
        hit, not just a stale clearance.
      </>
    ),
    instruct: "Click Submit",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form({ to: "luxclear" })),
    watch: "transfer",
  },
  {
    section: "A sanctions event",
    title: "Clear the listing",
    body: (
      <>
        Suppose the screening provider clears LuxClear. Delisting it moves the freshness line forward once more
        and re-screens everyone back to a clean footing, ready for the next chapter.
      </>
    ),
    instruct: "Click Delist on LuxClear's row",
    spotlight: "[data-tour=sanction-luxclear]",
    spotlightDone: "[data-tour=feed]",
    prep: (c) => c.setFeedTab("sanctions"),
    watch: (s) => !party(s, "luxclear")?.sanctioned,
    afterSettle: ["debtco", "fundmgr"],
    doneNote: "LuxClear is delisted and the network has re-screened back to clean.",
  },
  {
    section: "Offboarding an institution",
    title: "Every wallet answers to a real institution",
    body: (
      <>
        Each wallet on this network is vouched for by a known institution. The institution holds its KYC record
        in the SWIFT registry and signs a statement that the wallet belongs to its BIC, its bank identifier.
        That signed link is what lets the wallet settle at all. Offboarding the institution revokes the link.
        And unlike a sanction, this cannot be undone by the automatic re-screen: a re-screen heals a clean
        party, but it can never quietly restore a revoked link.
      </>
    ),
    instruct: "Click Offboard on DebtCo's row",
    spotlight: "[data-tour=bind-debtco]",
    spotlightDone: "[data-tour=feed]",
    prep: (c) => c.setFeedTab("sanctions"),
    watch: (s) => Boolean(party(s, "debtco")?.binding?.revoked),
    doneNote: "The link is revoked. This one is sticky: the background re-screen will not bring it back.",
  },
  {
    section: "Offboarding an institution",
    title: "A wallet with no institution cannot move funds",
    body: (
      <>
        Try the original payment from DebtCo again. With its institutional link revoked, DebtCo is blocked
        outright, the same way a frozen party would be, whether the transfer takes the fast path or the fully
        on-chain path.
      </>
    ),
    instruct: "Click Submit",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form()),
    watch: "transfer",
  },
  {
    section: "Offboarding an institution",
    title: "Only a fresh signature reinstates it",
    body: (
      <>
        There is exactly one way back. The institution itself has to sign a new statement reinstating the
        wallet, and it must be newer than the signature that was revoked. Re-bind DebtCo to put it back in good
        standing.
      </>
    ),
    instruct: "Click Re-bind on DebtCo's row",
    spotlight: "[data-tour=bind-debtco]",
    spotlightDone: "[data-tour=feed]",
    prep: (c) => c.setFeedTab("sanctions"),
    watch: (s) => !party(s, "debtco")?.binding?.revoked,
    afterSettle: ["debtco", "fundmgr"],
    doneNote: "The link is restored, on a fresh signature.",
  },
  {
    section: "Offboarding an institution",
    title: "And the payment goes through again",
    body: <>With the institutional link reinstated, DebtCo is back to normal. Send the original payment once more to confirm it now clears.</>,
    instruct: "Click Submit",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form()),
    watch: "transfer",
  },
  {
    section: "A different asset",
    title: "Same engine, a completely different instrument",
    body: (
      <>
        Everything so far has involved a tokenized bond. Now switch to a tokenized cash deposit that settles on
        a plain book-entry ledger, with no token underneath it at all (already filled in). The deposit follows a
        leaner rulebook, with no counterparty, lock-up or holding-limit checks, so its trace is shorter. But the
        decision is reached in exactly the same way, and it comes out identical across all three rails. The
        control function does not care what the asset is.
      </>
    ),
    instruct: "Click Submit",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form({ asset: "ledger", assetClass: "deposit", path: "auto" })),
    watch: "transfer",
    showAgnostic: true,
  },
  {
    section: "A second pair of eyes",
    title: "A large transfer is held for review",
    body: (
      <>
        The size of a transfer matters too. The rulebook sets two thresholds: below the first, transfers clear automatically; above
        the second, they are refused outright; in between sits a review band that needs a human to look. This
        transfer is EUR 2,500,000 of bonds, which lands in that middle band. Instead of settling, it is held for
        enhanced due diligence.
      </>
    ),
    instruct: "Click Submit",
    spotlight: "[data-tour=submit]",
    spotlightDone: "[data-tour=decision]",
    prep: (c) => c.setForm(form({ amount: "2500000", path: "auto" })),
    watch: "transfer",
  },
  {
    section: "A second pair of eyes",
    title: "Three approvers sign it off",
    body: (
      <>
        A held transfer can still proceed. Escalating it sends the transfer to an off-chain panel of approvers,
        and only when all three sign does it clear for settlement. Use the Escalate button on the decision
        panel.
      </>
    ),
    instruct: "Click Escalate on the decision panel",
    spotlight: "[data-tour=escalate]",
    spotlightDone: "[data-tour=decision]",
    watch: "transfer",
  },
  {
    section: "Over to you",
    title: "The rulebook is data you can edit",
    body: (
      <>
        One last point, and then the demo is yours to explore. None of these rules are hard-coded. The Policy engine tab is open
        in front of you: switch rules on or off, move the review thresholds, change which jurisdictions are
        allowed, and publish. The change goes on-chain, and the very next decision reads it. That is the tour.
        Everything here is live, so compose your own transfers, freeze or sanction parties, and watch the
        decision, the compliance trace and the ISO 20022 message all move together.
      </>
    ),
    instruct: "Open the Policy engine tab and explore",
    spotlight: "[data-tour=policy-tab]",
    prep: (c) => c.setFeedTab("policy"),
    watch: "manual",
  },
];

type Phase = "intro" | "running" | "closed";
type CueStatus = "todo" | "settling" | "done";
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const VERDICT: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  PERMITTED: { label: "PERMITTED", variant: "success" },
  REVIEW: { label: "HELD FOR REVIEW", variant: "warning" },
  BLOCKED: { label: "BLOCKED", variant: "destructive" },
};

function resolveEl(sel: Sel | undefined): HTMLElement | null {
  if (!sel) return null;
  const list = Array.isArray(sel) ? sel : [sel];
  for (const s of list) {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

interface GuidedTourProps {
  phase: Phase;
  setPhase: (p: Phase) => void;
  controller: TourController;
  connected: boolean;
  latestKey: string | null;
  latestResult: TransferResult | null;
  state: DemoState | null;
}

export function GuidedTour({ phase, setPhase, controller, connected, latestKey, latestResult, state }: GuidedTourProps) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<CueStatus>("todo");
  const [captured, setCaptured] = useState<TransferResult | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [panelH, setPanelH] = useState(0);
  const snapshotKey = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const cue = CUES[step];
  const activeSel = status === "done" ? cue?.spotlightDone ?? cue?.spotlight : cue?.spotlight;
  const activeSelKey = JSON.stringify(activeSel ?? null);

  // Dock the panel into whichever half has more room around the spotlight, so it
  // never sits on top of the element the judge is meant to click.
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const dockTop = rect ? rect.top > vh - (rect.top + rect.height) : false;

  // On entering a cue: set the stage, reset status, snapshot the latest decision
  // so we only react to a new one the judge produces.
  useEffect(() => {
    if (phase !== "running") return;
    setStatus("todo");
    setCaptured(null);
    snapshotKey.current = latestKey;
    CUES[step]?.prep?.(controller);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, step]);

  // Detect a transfer the judge submitted (a new decision since the cue began).
  useEffect(() => {
    if (phase !== "running" || status !== "todo") return;
    if (CUES[step]?.watch !== "transfer") return;
    if (latestKey && latestKey !== snapshotKey.current) {
      setCaptured(latestResult);
      setStatus("done");
    }
  }, [phase, step, status, latestKey, latestResult]);

  // Detect a state change the judge made (sanction / delist / offboard / re-bind).
  useEffect(() => {
    if (phase !== "running" || status !== "todo" || !state) return;
    const w = CUES[step]?.watch;
    if (typeof w !== "function" || !w(state)) return;
    const settle = CUES[step]?.afterSettle;
    if (settle) {
      setStatus("settling");
      controller.awaitRescreen(settle).then(() => setStatus("done"));
    } else {
      setStatus("done");
    }
  }, [phase, step, status, state, controller]);

  // Keep the spotlight rectangle pinned to the live element as the layout shifts.
  useEffect(() => {
    if (phase !== "running") {
      setRect(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = resolveEl(activeSel);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      } else {
        setRect((prev) => (prev ? null : prev));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, activeSelKey]);

  // Bring the spotlighted control into view when it changes.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setTimeout(() => resolveEl(activeSel)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [phase, activeSelKey]);

  // Track the docked panel's height as its content (instruction / outcome) changes.
  useEffect(() => {
    if (phase !== "running") {
      setPanelH(0);
      return;
    }
    const measure = () => setPanelH(panelRef.current?.offsetHeight ?? 0);
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [phase, step, status, captured]);

  useEffect(() => {
    const clear = () => {
      document.body.style.paddingTop = "";
      document.body.style.paddingBottom = "";
    };
    if (phase !== "running" || !panelH) {
      clear();
      return clear;
    }
    const gap = `${panelH + 24}px`;
    if (dockTop) {
      document.body.style.paddingTop = gap;
      document.body.style.paddingBottom = "";
    } else {
      document.body.style.paddingBottom = gap;
      document.body.style.paddingTop = "";
    }
    return clear;
  }, [phase, panelH, dockTop]);

  if (phase === "intro" && connected) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
        <Card className="w-full max-w-[560px] shadow-md">
          <div className="border-b px-6 py-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">SWIFT Asset Control</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">A guided tour of the control function</h2>
          </div>
          <div className="space-y-3 px-6 py-5 text-sm leading-relaxed text-muted-foreground">
            <p>
              Every settlement on this network, whether it mints, burns, transfers or freezes an asset, passes
              through one control function first. It checks a single shared rulebook and returns one decision:
              permit, hold, or block. The same engine sits in front of three different rails, a standard token
              (ERC-20), a regulated security token (ERC-3643) and a plain book-entry ledger with no token at
              all, and it reaches the identical decision on each.
            </p>
            <p>
              This tour follows that control function through a working day, one scenario at a time. You will
              clear a clean payment, watch a sanctions listing ripple across the whole network, offboard and
              reinstate an institution, settle the very same rules against a different kind of asset, and sign
              off a large transfer that needs a second look. It takes about three minutes. At each step the tour
              highlights one real control and asks you to click it.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
            <Button variant="ghost" onClick={() => setPhase("closed")}>
              Explore on my own
            </Button>
            <Button
              onClick={async () => {
                setStep(0);
                setStatus("todo");
                setCaptured(null);
                setPhase("running");
                await controller.reset();
              }}
            >
              Start guided tour
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (phase !== "running" || !cue) return null;

  const isLast = step === CUES.length - 1;
  const progress = Math.round(((step + 1) / CUES.length) * 100);

  return (
    <>
      {rect && <Spotlight rect={rect} />}
      <div className={cn("pointer-events-none fixed inset-x-0 z-[60] flex justify-center p-4", dockTop ? "top-0" : "bottom-0")}>
        <Card ref={panelRef} className="pointer-events-auto w-full max-w-[660px] shadow-md">
          {}
          <div className="flex items-center gap-3 border-b px-5 py-2.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{cue.section}</span>
            <span className="text-[10px] text-muted-foreground/70">step {step + 1} of {CUES.length}</span>
            <div className="ml-2 h-1 flex-1 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-foreground/60 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <button
              onClick={() => setPhase("closed")}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Exit tour"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {}
          <div className="px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">{cue.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{cue.body}</p>

            {}
            <div className="mt-3">
              {status === "settling" ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-foreground" />
                  Re-screening. Bringing clean parties back up to the new freshness line.
                </div>
              ) : status === "done" ? (
                cue.watch === "transfer" ? (
                  <Outcome result={captured} showAgnostic={cue.showAgnostic} note={cue.note} />
                ) : (
                  <DoneNote>{cue.doneNote ?? "Done."}</DoneNote>
                )
              ) : (
                cue.watch !== "manual" && (
                  <div className="flex items-center gap-2 rounded-md border border-foreground/30 bg-foreground/5 px-3 py-2 text-xs font-medium text-foreground">
                    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11.5 12 8l3 3.5M12 8v9" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {cue.instruct}
                  </div>
                )
              )}
            </div>
          </div>

          {}
          <div className="flex items-center justify-between border-t px-5 py-3">
            <Button variant="ghost" size="sm" disabled={step === 0 || status === "settling"} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
            {isLast ? (
              <Button size="sm" onClick={() => setPhase("closed")}>
                Finish
              </Button>
            ) : (
              <Button size="sm" disabled={status === "settling" || (cue.watch !== "manual" && status !== "done")} onClick={() => setStep((s) => Math.min(CUES.length - 1, s + 1))}>
                Next
              </Button>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Spotlight({ rect }: { rect: Rect }) {
  const pad = 6;
  const box: React.CSSProperties = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    transition: "top 120ms ease, left 120ms ease, width 120ms ease, height 120ms ease",
  };
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* ponytail: feathered, lighter dim so the area around a big spotlit component stays readable/explorable (clicks already pass through via pointer-events-none). Blur fades the darkness in from the element edge outward. */}
      <div className="absolute rounded-lg" style={{ ...box, boxShadow: "0 0 36px 9999px rgba(0,0,0,0.45)" }} />
      <div
        className="absolute rounded-lg"
        style={{ ...box, outline: "2px solid hsl(0 0% 92% / 0.85)", outlineOffset: "-1px", animation: "tourpulse 1.6s ease-in-out infinite" }}
      />
      <style>{"@keyframes tourpulse{0%,100%{opacity:1}50%{opacity:.45}}"}</style>
    </div>
  );
}

function DoneNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-success-border bg-success-muted px-3 py-2 text-xs text-success">
      <svg viewBox="0 0 24 24" className="mt-0.5 size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function Outcome({ result, showAgnostic, note }: { result: TransferResult | null; showAgnostic?: boolean; note?: ReactNode }) {
  if (!result) {
    return (
      <p className="rounded-md border border-destructive-border bg-destructive-muted px-3 py-2 text-xs text-destructive">
        No decision was captured. Confirm the orchestrator is connected and try the action again.
      </p>
    );
  }
  const v = VERDICT[result.status] ?? VERDICT.BLOCKED;
  const code = result.decision.reasonCode;
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={v.variant} className="font-mono text-[10px]">{v.label}</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">{code}</Badge>
        <span className="font-mono text-[10px] text-muted-foreground">{result.gas.total.toLocaleString()} gas</span>
      </div>
      <p className="mt-1.5 text-muted-foreground">{REASONS[code] ?? result.decision.reasonText}</p>
      {note && <p className="mt-1.5 text-muted-foreground/80">{note}</p>}
      {showAgnostic && result.agnosticism && (
        <div className="mt-2 border-t pt-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Asset-agnostic proof</span>
            <Badge variant={result.agnosticism.identical ? "success" : "destructive"} className="text-[9px] uppercase">
              {result.agnosticism.identical ? "identical" : "diverged"}
            </Badge>
          </div>
          <ul className="flex flex-col gap-0.5">
            {result.agnosticism.representations.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span>{r.label}</span>
                <span className="text-foreground">{r.decision.outcome} ({r.decision.reasonCode})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
