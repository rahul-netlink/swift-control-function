import { useEffect, useState } from "react";
import type { MonitorStatus, Party } from "../types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { formatTime } from "../util";

interface SanctionsMonitorProps {
  monitor: MonitorStatus | undefined;
  listEpoch: number;
  busy: boolean;
  connected: boolean;
  parties: Party[];
  onFreeze: (role: string) => void;
  onUnfreeze: (role: string) => void;
  onSanction: (role: string) => void;
  onDelist: (role: string) => void;
  onOffboard: (role: string) => void;
  onRebind: (role: string) => void;
}

/**
 * The Sanctions List Monitor: a screening utility over an upstream consolidated feed
 * (OFAC SDN / EU CFSP). Re-screening runs on demand — an operator sanction/delist (or a
 * scripted poll) drives a feed delta, which fires one on-chain advanceListEpoch
 * (invalidating every stale clearance at once, I3) and re-screens the network. Rendered
 * bare inside the feed card's "Sanctions" tab.
 */
export function SanctionsMonitor({ monitor, listEpoch, busy, connected, parties, onFreeze, onUnfreeze, onSanction, onDelist, onOffboard, onRebind }: SanctionsMonitorProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = Boolean(monitor?.running && connected);
  const provider = monitor?.provider ?? "Sanctions feed";
  const nextIn = monitor?.nextPollTs ? Math.max(0, Math.round((monitor.nextPollTs - now) / 1000)) : null;
  const recent = monitor?.recent ?? [];
  const disabled = busy || !connected;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 pt-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-success" : "bg-muted-foreground/50")} />
          <Badge variant={live ? "success" : "muted"} className="text-[10px] uppercase">{live ? "live" : "idle"}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-xs sm:grid-cols-4">
        <Stat label="Provider" value={provider} mono={false} />
        <Stat label="On-chain list floor" value={`epoch ${listEpoch}`} />
        <Stat label="Re-screen" value={nextIn == null ? "On demand" : `${nextIn}s`} mono={false} />
        <Stat
          label="Last delta"
          value={
            monitor?.lastDelta
              ? `${monitor.lastDelta.entity} ${monitor.lastDelta.action === "add" ? "listed" : "delisted"}`
              : "none yet"
          }
          mono={false}
          tone={monitor?.lastDelta ? (monitor.lastDelta.action === "add" ? "warn" : "ok") : undefined}
        />
      </div>

      {parties.length > 0 && (
        <div className="border-t px-5 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Parties</div>
          <ul className="flex flex-col gap-1.5">
            {parties.map((p) => (
              <li key={p.role} className="flex items-center gap-2 text-xs">
                <span className="truncate text-foreground/90">{p.name}</span>
                {p.frozen && <Badge variant="destructive" className="text-[9px] uppercase">Frozen</Badge>}
                {p.sanctioned && <Badge variant="warning" className="text-[9px] uppercase">Sanctioned</Badge>}
                {p.binding?.revoked && <Badge variant="destructive" className="text-[9px] uppercase">Binding revoked</Badge>}
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={disabled}
                    onClick={() => (p.frozen ? onUnfreeze(p.role) : onFreeze(p.role))}
                  >
                    {p.frozen ? "Unfreeze" : "Freeze"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    data-tour={`sanction-${p.role}`}
                    disabled={disabled}
                    onClick={() => (p.sanctioned ? onDelist(p.role) : onSanction(p.role))}
                  >
                    {p.sanctioned ? "Delist" : "Sanction"}
                  </Button>
                  {p.bic && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      data-tour={`bind-${p.role}`}
                      disabled={disabled}
                      title={p.binding?.revoked ? "Institution re-signs the wallet→BIC binding (governed)" : "Offboard the controlling institution — sticky binding revocation (BND13)"}
                      onClick={() => (p.binding?.revoked ? onRebind(p.role) : onOffboard(p.role))}
                    >
                      {p.binding?.revoked ? "Re-bind" : "Offboard"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="border-t px-5 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Recent activity</div>
          <ul className="flex flex-col gap-1">
            {recent.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className={cn("size-1.5 shrink-0 rounded-full", t.kind === "delta" ? "bg-warning" : "bg-muted-foreground/40")} />
                <span className="font-mono text-[10px] text-muted-foreground">{formatTime(t.ts)}</span>
                <span className="truncate text-foreground/90">{t.message}</span>
                {t.listEpoch != null && <span className="ml-auto font-mono text-[10px] text-muted-foreground">e{t.listEpoch}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono = true, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("truncate text-foreground", mono && "font-mono", tone === "warn" && "text-warning", tone === "ok" && "text-success")} title={value}>
        {value}
      </span>
    </div>
  );
}
