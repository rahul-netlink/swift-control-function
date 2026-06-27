import { cn } from "../../lib/utils";

type Variant = "default" | "secondary" | "outline" | "success" | "destructive" | "warning" | "muted";

const VARIANTS: Record<Variant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "border-border text-foreground",
  muted: "border-transparent bg-muted text-muted-foreground",
  success: "border-success-border bg-success-muted text-success",
  destructive: "border-destructive-border bg-destructive-muted text-destructive",
  warning: "border-warning-border bg-warning-muted text-warning",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
