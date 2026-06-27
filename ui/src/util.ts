export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatValidUntil(validUntil: number): string | null {
  if (!validUntil || validUntil <= 0) return null;
  const ms = validUntil < 1e12 ? validUntil * 1000 : validUntil;
  return new Date(ms).toLocaleString("en-US", {
    hour12: false,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
