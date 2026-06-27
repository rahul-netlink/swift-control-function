import { useEffect, useRef, useState } from "react";
import type { AssetClass, Policy, PolicyBand, PolicyCondition, PolicyVelocity, PublishPolicySpec } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";

interface PolicyEngineProps {
  policy: Policy | undefined;
  assetClass: AssetClass;
  busy: boolean;
  connected: boolean;
  onPublish: (spec: PublishPolicySpec) => Promise<{ version: string; ruleMask: number; gasUsed: number; txHash: string }>;
}

const MASKABLE: { id: string; label: string; reason: string }[] = [
  { id: "freeze", label: "Freeze", reason: "FRZ06" },
  { id: "kyc", label: "KYC", reason: "BLCK01" },
  { id: "sanctions", label: "Sanctions", reason: "AML02" },
  { id: "jurisdiction", label: "Jurisdiction", reason: "JUR03" },
  { id: "counterparty", label: "Counterparty class", reason: "CTP12" },
  { id: "lockup", label: "Lock-up", reason: "LCK04" },
  { id: "holderCap", label: "Holder cap", reason: "CAP05" },
  { id: "transferLimit", label: "Tiered limit", reason: "LIM07" },
  { id: "velocity", label: "Velocity", reason: "VEL11" },
];
const ACTIONS = ["ALLOW", "REVIEW", "DENY"] as const;

interface DraftBand { upTo: string; action: "ALLOW" | "REVIEW" | "DENY" }
interface Draft {
  version: string;
  activeRules: string[];
  maxHolders: string;
  lockupEnd: string;
  bands: DraftBand[];
  jurisdictions: PolicyCondition[];
  categories: PolicyCondition[];
  velocity: PolicyVelocity | null;
}

function fromPolicy(p: Policy | undefined): Draft {
  const bands = (p?.bands ?? []) as PolicyBand[];
  return {
    version: String(p?.version ?? ""),
    activeRules: (p?.rules ?? []).map((r) => r.id).filter((id) => id !== "edd"),
    maxHolders: String(p?.maxHolders ?? 0),
    lockupEnd: (p?.lockupEnd ?? "").slice(0, 10),
    bands: bands.map((b) => ({ upTo: b.upTo == null ? "" : String(b.upTo), action: b.action })),
    jurisdictions: (p?.jurisdictions ?? []) as PolicyCondition[],
    categories: (p?.categories ?? []) as PolicyCondition[],
    velocity: p?.velocity ?? null,
  };
}

function validate(d: Draft): string | null {
  if (!d.version.trim()) return "Version label is required";
  let prev = -Infinity;
  for (let i = 0; i < d.bands.length; i++) {
    const raw = d.bands[i].upTo.trim();
    if (raw === "") {
      if (i !== d.bands.length - 1) return "A catch-all band (blank limit) must be the last row";
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return "Band limits must be positive numbers";
    if (v <= prev) return "Band limits must be strictly ascending";
    prev = v;
  }
  return null;
}

function toSpec(d: Draft): PublishPolicySpec {
  return {
    version: d.version.trim(),
    activeRules: d.activeRules,
    maxHolders: Number(d.maxHolders) || 0,
    lockupEnd: d.lockupEnd ? new Date(d.lockupEnd).toISOString() : null,
    bands: d.bands.map((b) => ({ upTo: b.upTo.trim() === "" ? null : b.upTo.trim(), action: b.action })),
    jurisdictions: d.jurisdictions,
    categories: d.categories,
    velocity: d.velocity,
  };
}

/**
 * The policy engine, pared to its essentials: pick which rules are active (the on-chain
 * bitmap) and set the amount bands that drive allow / review / deny — plus the two scalar
 * gates (holder cap, lock-up). Publishing writes the ruleset to the on-chain RuleRegistry
 * (the PAP); the PDP reads it directly, so the next decision is made under the new policy.
 * Swapping asset class flips between bond and deposit — the cap and lock-up rules visibly
 * drop out, because policy is data in the registry, not code.
 */
export function PolicyEngine({ policy, assetClass, busy, connected, onPublish }: PolicyEngineProps) {
  const [draft, setDraft] = useState<Draft>(() => fromPolicy(policy));
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ version: string; gasUsed: number; txHash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastClass = useRef(assetClass);
  const policyVersion = String(policy?.version ?? "");

  useEffect(() => {
    const classChanged = lastClass.current !== assetClass;
    if (classChanged || !dirty) {
      setDraft(fromPolicy(policy));
      setDirty(false);
      if (classChanged) setResult(null);
    }
    lastClass.current = assetClass;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetClass, policyVersion]);

  const edit = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); setError(null); };
  const toggleRule = (id: string) =>
    edit({ activeRules: draft.activeRules.includes(id) ? draft.activeRules.filter((r) => r !== id) : [...draft.activeRules, id] });
  const editBand = (i: number, patch: Partial<DraftBand>) => edit({ bands: draft.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const validationError = validate(draft);
  const has = (id: string) => draft.activeRules.includes(id);
  const blocked = busy || !connected || publishing;

  const publish = async () => {
    const err = validate(draft);
    if (err) { setError(err); return; }
    setPublishing(true);
    setError(null);
    try {
      const r = await onPublish(toSpec(draft));
      setResult({ version: r.version, gasUsed: r.gasUsed, txHash: r.txHash });
      setDirty(false);
    } catch (e) {
      setError((e as Error).message ?? "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col divide-y divide-border/60">
      {}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">version</span>
          <Input value={draft.version} onChange={(e) => edit({ version: e.target.value })} className="h-7 w-[220px] font-mono text-xs" placeholder="eu-mifid-sec-token-v4@1" />
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">deny-overrides</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex flex-wrap rounded-md border p-0.5">
            {(["bond", "deposit", "equity", "fund"] as AssetClass[]).map((cls) => (
              <span
                key={cls}
                aria-current={assetClass === cls}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium capitalize",
                  assetClass === cls ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground/60",
                )}
              >
                {cls}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">set in transfer form</span>
        </div>
      </div>

      {}
      <div className="px-5 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Active rules</h3>
          <span className="text-[10px] text-muted-foreground">click to enable / disable</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MASKABLE.map((rule) => {
            const on = has(rule.id);
            return (
              <button
                key={rule.id}
                onClick={() => toggleRule(rule.id)}
                disabled={blocked}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                  on ? "border-border bg-secondary text-foreground" : "border-dashed border-border bg-transparent text-muted-foreground/60 line-through",
                )}
              >
                {rule.label}
                <span className="font-mono text-[10px] opacity-70">{rule.reason}</span>
              </button>
            );
          })}
          <span title="Three-valued gate — driven by review bands and the EDD floor" className="inline-flex items-center gap-1.5 rounded-md border border-warning-border bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
            EDD gate<span className="font-mono text-[10px] opacity-70">EDD10</span>
          </span>
        </div>
      </div>

      {}
      <div className={cn("px-5 py-3", !has("transferLimit") && "opacity-50")}>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            Amount bands
            {!has("transferLimit") && <Badge variant="muted" className="ml-2 text-[9px] uppercase">rule off</Badge>}
          </h3>
          <span className="text-[10px] text-muted-foreground">notional → outcome</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {draft.bands.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={b.upTo}
                onChange={(e) => editBand(i, { upTo: e.target.value })}
                disabled={blocked}
                inputMode="numeric"
                placeholder="≤ amount (blank = top band)"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Select value={b.action} onChange={(e) => editBand(i, { action: e.target.value as DraftBand["action"] })} disabled={blocked} className="h-8 w-28 text-xs">
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" disabled={blocked} onClick={() => edit({ bands: draft.bands.filter((_, j) => j !== i) })} title="Remove band">×</Button>
            </div>
          ))}
          <button className="self-start text-xs text-primary hover:underline disabled:opacity-50" disabled={blocked} onClick={() => edit({ bands: [...draft.bands, { upTo: "", action: "DENY" }] })}>+ add band</button>
        </div>
      </div>

      {}
      <div className="grid grid-cols-2 gap-3 px-5 py-3 text-xs">
        <label className={cn("flex flex-col gap-1", !has("holderCap") && "opacity-50")}>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Max holders</span>
          <Input value={draft.maxHolders} onChange={(e) => edit({ maxHolders: e.target.value })} disabled={blocked} inputMode="numeric" className="h-8 font-mono text-xs" />
        </label>
        <label className={cn("flex flex-col gap-1", !has("lockup") && "opacity-50")}>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Lock-up until</span>
          <Input type="date" value={draft.lockupEnd} onChange={(e) => edit({ lockupEnd: e.target.value })} disabled={blocked} className="h-8 font-mono text-xs" />
        </label>
      </div>

      {}
      <div className="flex flex-col gap-2 px-5 py-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {validationError && !error && <p className="text-xs text-warning">{validationError}</p>}
        {result && !dirty && (
          <p className="text-xs text-success">
            Published <span className="font-mono">{result.version}</span> · gas {result.gasUsed.toLocaleString()} · <span className="font-mono">{result.txHash.slice(0, 10)}…</span>
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{dirty ? "Unpublished edits" : "In sync with RuleRegistry"}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={blocked || Boolean(validationError)} onClick={publish}>
              {publishing ? "Publishing…" : "Publish → RuleRegistry"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
