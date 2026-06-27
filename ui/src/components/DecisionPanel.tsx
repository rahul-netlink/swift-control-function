import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { TraceStep, TransferResult } from "../types";
import { formatValidUntil } from "../util";
import { cn } from "../lib/utils";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Tabs } from "./ui/tabs";

type TabKey = "decision" | "trace" | "iso" | "quorum";

const ASSET_NAME: Record<string, string> = {
  bond: "Tokenized Bond",
  deposit: "Tokenized Deposit",
  equity: "Tokenized Equity",
  fund: "Tokenized Fund Unit",
};

/**
 * The decision record, rendered inline as the workbench's focal panel (no
 * modal). Shows an empty state until the first transfer is submitted; clicking
 * a row in the Transaction Log loads that record back into the same panel.
 */
interface DecisionPanelProps {
  result: TransferResult | null;
  onEscalate?: () => void;
  escalating?: boolean;
  escalatedFrom?: string;
}

const VERDICT = {
  PERMITTED: { label: "PERMITTED", variant: "success", bg: "bg-success-muted", text: "text-success", chip: "bg-success/15 text-success", arrow: "text-success" },
  REVIEW: { label: "HELD FOR REVIEW", variant: "warning", bg: "bg-warning-muted", text: "text-warning", chip: "bg-warning/15 text-warning", arrow: "text-warning" },
  BLOCKED: { label: "BLOCKED", variant: "destructive", bg: "bg-destructive-muted", text: "text-destructive", chip: "bg-destructive/15 text-destructive", arrow: "text-destructive" },
} as const;

export function DecisionPanel({ result, onEscalate, escalating, escalatedFrom }: DecisionPanelProps) {
  const [tab, setTab] = useState<TabKey>("decision");
  useEffect(() => setTab("decision"), [result?.decisionId]);

  if (!result) return <EmptyDecision />;

  const review = result.status === "REVIEW";
  const blocked = result.status === "BLOCKED";
  const r = result.request;
  const assetName = ASSET_NAME[r.assetClass ?? "bond"] ?? "Tokenized Bond";
  const v = VERDICT[result.status];

  const enforceLine =
    result.status === "PERMITTED"
      ? `control.evaluateAndConsume() permitted → OK00 · ${result.gas.total.toLocaleString()} gas`
      : review
        ? `control.evaluate() held for review → ${result.decision.reasonCode} · ${result.gas.total.toLocaleString()} gas`
        : `control.evaluate() denied → ${result.decision.reasonCode} · ${result.gas.total.toLocaleString()} gas`;

  const failing = result.trace.filter((s) => s.status === "fail" || s.status === "review").length;

  return (
    <Card data-tour="decision" className="flex flex-col overflow-hidden">
      {}
      <div className={cn("flex items-center gap-3 border-b px-5 py-4", v.bg)}>
        <span className={cn("flex size-7 items-center justify-center rounded-full text-sm font-bold", v.chip)}>
          {blocked ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          ) : review ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          )}
        </span>
        <h2 className={cn("text-lg font-bold tracking-tight", v.text)}>{v.label}</h2>
        <Badge variant={v.variant} className="font-mono">
          {result.iso20022.type.split(".").slice(0, 2).join(".")} · {result.iso20022.status}
        </Badge>
        <div className="ml-auto flex min-w-0 flex-col items-end">
          <span className="max-w-full truncate font-mono text-xs text-muted-foreground">{result.decisionId}</span>
          {escalatedFrom && (
            <span className="max-w-full truncate font-mono text-xs text-muted-foreground" title={`Escalated from ${escalatedFrom}`}>
              ← escalated from {escalatedFrom}
            </span>
          )}
        </div>
      </div>

      {}
      <div className="border-b bg-muted/40 px-5 py-3">
        <code className="flex items-start gap-2 font-mono text-xs leading-relaxed text-muted-foreground">
          <span className={v.arrow}>›</span>
          <span className="break-all">
            <span className="text-foreground">On-chain enforce [SETTLEMENT]</span> {enforceLine}
          </span>
        </code>
      </div>

      {}
      {review && onEscalate && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-warning-muted/40 px-5 py-2.5">
          <span className="text-xs text-warning">Enhanced due diligence required before settlement.</span>
          <button
            data-tour="escalate"
            onClick={onEscalate}
            disabled={escalating}
            className="inline-flex items-center gap-1.5 rounded-md border border-warning-border bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning-muted/70 disabled:opacity-60"
          >
            {escalating ? "Escalating…" : "Escalate — obtain EDD approval"}
          </button>
        </div>
      )}

      {}
      <div className="border-b px-5 py-3">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          tabs={[
            { value: "decision", label: "Decision" },
            { value: "trace", label: "Compliance trace", tourId: "trace-tab", badge: failing ? String(failing) : undefined },
            { value: "iso", label: "ISO 20022" },
            { value: "quorum", label: "Quorum" },
          ]}
        />
      </div>

      {}
      <div className="max-h-[440px] overflow-y-auto px-5 py-5">
        {tab === "decision" && (
          <dl className="divide-y divide-border/70">
            <Row k="Transfer" v={`${r.fromRef} → ${r.toRef}`} />
            <Row k="Amount" v={`${Number(r.amount).toLocaleString()} EUR · ${assetName}`} />
            <Row k="Route" v={result.route} />
            <Row
              k="Path"
              v={result.path.label}
              mono
              after={
                <span
                  className="shrink-0 cursor-help text-muted-foreground/60"
                  title={
                    "HOT = resolved from a cached standing claim (party standing).\n" +
                    "COLD = fresh operation-bound attestation.\n" +
                    "Scope: PARTY_STANDING = reusable claim about the party · OPERATION_BOUND = tied to this single operation."
                  }
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
                </span>
              }
            />
            <Row
              k="Gas"
              v={`${result.gas.total.toLocaleString()} gas`}
              mono
              after={
                <Badge variant="muted" className="font-mono text-[10px]">{result.path.basis}</Badge>
              }
            />
            <Row k="Tx hash" v={result.txHash ?? "— not settled"} mono copy={result.txHash ?? undefined} />
            <Row
              k="Evidence"
              v={result.hashes.evidence ?? "— none · party standing (hot path)"}
              mono
              copy={result.hashes.evidence ?? undefined}
            />
            <Row k="Request" v={result.hashes.request} mono copy={result.hashes.request} />
            <ValidityRow result={result} />
          </dl>
        )}

        {tab === "trace" && <TraceView steps={result.trace} />}

        {tab === "iso" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">{result.iso20022.type}</Badge>
                <Badge variant={v.variant} className="font-mono">{result.iso20022.status}</Badge>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{result.iso20022.filename}</span>
            </div>
            <CodeBlock text={result.iso20022.xml} />
          </div>
        )}

        {tab === "quorum" && <QuorumView result={result} />}
      </div>

      {}
      <div className="border-t px-5 py-3">
        <span className="font-mono text-xs text-muted-foreground">{result.decision.reasonText}</span>
      </div>
    </Card>
  );
}

function EmptyDecision() {
  return (
    <Card data-tour="decision" className="flex min-h-[340px] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-dashed text-muted-foreground/60">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="m9 14 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="text-sm font-medium text-foreground">No decision yet</p>
    </Card>
  );
}

function Row({ k, v, mono, copy, after }: { k: string; v: string; mono?: boolean; copy?: string; after?: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-4 py-2.5">
      <dt className="pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className={cn("flex items-center gap-2 text-sm text-foreground", mono && "font-mono text-[13px]")}>
        <span className="min-w-0 break-all">{v}</span>
        {copy && <CopyButton value={copy} />}
        {after}
      </dd>
    </div>
  );
}

function ValidityRow({ result }: { result: TransferResult }) {
  const f = result.freshness;
  const stale = f ? f.clearanceEpoch < f.listFloor : false;
  const ttl = formatValidUntil(result.validUntil);
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-4 py-2.5">
      <dt className="pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Validity</dt>
      <dd className="flex flex-col gap-1 text-sm">
        {f ? (
          <span className={cn("flex items-center gap-2 font-mono text-[13px]", stale ? "text-destructive" : "text-foreground")}>
            <span className={cn("inline-block size-1.5 rounded-full", stale ? "bg-destructive" : "bg-success")} />
            Live control · clearance e{f.clearanceEpoch} {stale ? "<" : "≥"} list floor e{f.listFloor}
          </span>
        ) : (
          <span className="font-mono text-[13px] text-muted-foreground">Live control · epoch floor</span>
        )}
        <span className="text-xs text-muted-foreground">
          TTL ceiling · {ttl ?? "—"}
        </span>
      </dd>
    </div>
  );
}

const TIER: Record<string, { label: string; cls: string }> = {
  ONCHAIN: { label: "on-chain", cls: "text-foreground" },
  OFFCHAIN: { label: "off-chain", cls: "text-muted-foreground" },
  HYBRID: { label: "hybrid", cls: "text-foreground/70" },
};

function TraceView({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {steps.map((s) => {
        const tier = TIER[s.tier] ?? { label: s.tier.toLowerCase(), cls: "text-muted-foreground" };
        return (
          <li
            key={s.key}
            className={cn(
              "flex items-center gap-3 rounded-md px-2 py-2",
              s.status === "skip" && "opacity-45",
              s.status === "fail" && "bg-destructive-muted",
              s.status === "review" && "bg-warning-muted",
            )}
          >
            <StatusIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm font-medium", s.status === "fail" ? "text-destructive" : s.status === "review" ? "text-warning" : "text-foreground")}>
                  {s.label}
                </span>
                {s.reasonCode && s.status === "fail" && (
                  <Badge variant="destructive" className="font-mono text-[10px]">{s.reasonCode}</Badge>
                )}
                {s.reasonCode && s.status === "review" && (
                  <Badge variant="warning" className="font-mono text-[10px]">{s.reasonCode}</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{s.detail}</p>
            </div>
            <span className={cn("hidden w-16 shrink-0 text-right font-mono text-[10px] font-semibold uppercase sm:block", tier.cls)}>
              {tier.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StatusIcon({ status }: { status: TraceStep["status"] }) {
  if (status === "pass")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
    );
  if (status === "fail")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </span>
    );
  if (status === "review")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 1.5" /></svg>
      </span>
    );
  return <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground"><span className="h-px w-2 bg-current" /></span>;
}

function QuorumView({ result }: { result: TransferResult }) {
  const { quorum } = result;
  if (!quorum) {
    return (
      <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
        HOT path — resolved from a cached standing claim, no fresh attestation or approver quorum required.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attestation quorum</h4>
      <p className="text-xs text-muted-foreground">
        The off-chain SWIFT signer collects an M-of-N approver quorum and emits a single group EIP-712 signature.
        The on-chain verifier performs one ecrecover — the threshold is invisible to the contract.
      </p>
      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {quorum.acks.map((ack) => (
            <Badge key={ack.id} variant={ack.approved ? "success" : "muted"} className="font-mono text-[11px]">
              {ack.approved ? "Approved" : "Pending"} {ack.id}
            </Badge>
          ))}
        </div>
        <div className="flex items-start gap-2 font-mono text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">signer</span>
          <span className="min-w-0 break-all text-foreground">{quorum.signer}</span>
          <CopyButton value={quorum.signer} />
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={text} />
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {text}
      </pre>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => undefined,
        );
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Copy"
    >
      {done ? (
        <svg viewBox="0 0 24 24" className="size-3.5 text-success" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
      )}
    </button>
  );
}
