import type { LogEntry } from "../types";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { formatTime } from "../util";

interface TransactionLogProps {
  entries: LogEntry[];
  latestKey: string | null;
  selectedKey: string | null;
  onSelect: (entry: LogEntry) => void;
}

const ASSET_LABEL: Record<string, string> = { erc3643: "ERC-3643", erc20: "ERC-20", ledger: "Ledger" };

export function TransactionLog({ entries, latestKey, selectedKey, onSelect }: TransactionLogProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-tight">Recent decisions</h2>
        <Badge variant="muted">{entries.length}</Badge>
      </div>

      {entries.length === 0 ? (
        <div className="px-5 py-6 text-xs text-muted-foreground">No settlements yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <Th className="pl-5">Time</Th>
                <Th>Route</Th>
                <Th className="text-right">Amount</Th>
                <Th>Standard</Th>
                <Th className="text-right">Gas</Th>
                <Th className="pr-5 text-right">Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const r = e.result;
                const blocked = r.status === "BLOCKED";
                const review = r.status === "REVIEW";
                const flash = blocked ? "animate-flash-red" : review ? "animate-flash-amber" : "animate-flash";
                const dotColor = blocked ? "bg-destructive" : review ? "bg-warning" : "bg-success";
                const badgeVariant = blocked ? "destructive" : review ? "warning" : "success";
                const outcomeLabel = blocked ? r.decision.reasonCode : review ? "HELD" : "PERMITTED";
                return (
                  <tr
                    key={e.key}
                    onClick={() => onSelect(e)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/60",
                      e.key === selectedKey && "bg-accent/50",
                      e.key === latestKey && flash,
                    )}
                  >
                    <td className="py-2.5 pl-5 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatTime(e.ts)}
                    </td>
                    <td className="py-2.5">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="text-foreground">{r.request.fromRef}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground">{r.request.toRef}</span>
                      </span>
                      {e.escalatedFrom && (
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                          ← escalated from {e.escalatedFrom}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums">
                      {Number(r.request.amount).toLocaleString()}{" "}
                      <span className="text-xs text-muted-foreground">EUR</span>
                    </td>
                    <td className="py-2.5">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {ASSET_LABEL[r.request.asset] ?? r.request.asset}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {r.gas.total.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-5 text-right">
                      <Badge variant={badgeVariant}>
                        <span className={cn("size-1.5 rounded-full", dotColor)} />
                        {outcomeLabel}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2.5 font-medium first:pl-5", className)}>{children}</th>;
}
