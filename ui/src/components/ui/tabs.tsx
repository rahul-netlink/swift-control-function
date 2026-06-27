import { cn } from "../../lib/utils";

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: string; badge?: string; tourId?: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex h-9 items-center justify-start gap-1 rounded-lg bg-muted p-1", className)}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            data-tour={t.tourId}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.badge && (
              <span className="rounded bg-muted-foreground/15 px-1 text-[10px] font-semibold tabular-nums">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
