type ClassValue = string | number | null | false | undefined | ClassValue[];

/**
 * Minimal `cn` — joins truthy class values (clsx-style) without the
 * tailwind-merge dependency. Our component overrides are controlled, so we
 * rely on Tailwind source order for the rare conflict.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v && v !== 0) return;
    if (Array.isArray(v)) v.forEach(walk);
    else out.push(String(v));
  };
  inputs.forEach(walk);
  return out.join(" ");
}
