import type { StreamEvent } from "../types";
import { formatTime } from "../util";
import { cn } from "../lib/utils";

/**
 * Quiet severity tone derived from the event type/message — a single status dot,
 * so the feed reads at a glance without a colored badge shouting on every row.
 */
function toneOf(e: StreamEvent): string {
  const s = `${e.type} ${e.message}`.toLowerCase();
  if (/revok|freeze applied|withdraw|deny|block|refus|fail/.test(s)) return "bg-destructive";
  if (/releas|publish|allow|clear|permit/.test(s)) return "bg-success";
  return "bg-muted-foreground/40";
}

/** The live SSE compliance feed, rendered as bare content inside the feed card's "Activity" tab. */
export function ActivityLog({ events }: { events: StreamEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-xs leading-relaxed text-muted-foreground">
        No activity yet — compliance events and sanctions deltas stream here as they happen.
      </div>
    );
  }
  return (
    <ul className="max-h-80 divide-y divide-border/40 overflow-y-auto">
      {events.map((e, i) => (
        <li
          key={`${e.ts}-${i}`}
          className="grid grid-cols-[auto_auto_4.5rem_1fr] items-center gap-3 px-5 py-2.5 text-xs transition-colors hover:bg-accent/30"
        >
          <span className={cn("size-1.5 rounded-full", toneOf(e))} />
          <time className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatTime(e.ts)}</time>
          <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
            {e.source}
          </span>
          <span className="min-w-0 truncate text-foreground" title={e.message}>
            {e.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
