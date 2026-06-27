import type { Asset, AssetClass, Party, PathChoice } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";
import { Select } from "./ui/select";

export interface TransferFormValues {
  from: string;
  to: string;
  amount: string;
  asset: Asset;
  assetClass: AssetClass;
  path: PathChoice;
}

interface TransferFormProps {
  parties: Party[];
  form: TransferFormValues;
  setForm: (f: TransferFormValues) => void;
  connected: boolean;
  busy: boolean;
  onSubmit: () => void;
}

const ASSET_TYPES: { label: string; value: AssetClass }[] = [
  { label: "Tokenized Bond", value: "bond" },
  { label: "Tokenized Deposit", value: "deposit" },
  { label: "Tokenized Equity", value: "equity" },
  { label: "Tokenized Fund Unit", value: "fund" },
];

const RAILS: { label: string; asset: Asset }[] = [
  { label: "ERC-3643", asset: "erc3643" },
  { label: "ERC-20", asset: "erc20" },
  { label: "Book-entry ledger", asset: "ledger" },
];

const PATHS: { label: string; value: PathChoice }[] = [
  { label: "Auto", value: "auto" },
  { label: "Hot (cached standing)", value: "hot" },
  { label: "Cold (fresh attestation)", value: "cold" },
];

export function TransferForm({ parties, form, setForm, connected, busy, onSubmit }: TransferFormProps) {
  const sameParty = form.from === form.to;
  const valid = !sameParty && Number(form.amount) > 0;
  const from = parties.find((p) => p.role === form.from);
  const to = parties.find((p) => p.role === form.to);

  return (
    <Card className="shadow-md">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="text-base">Compose a transfer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex flex-col gap-1.5">
          <Label>Debtor — from</Label>
          <Select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
            {parties.map((p) => (
              <option key={p.role} value={p.role}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="-my-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{from?.ref ?? "—"}</span>
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <span className="font-mono text-foreground">{to?.ref ?? "—"}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Creditor — to</Label>
          <Select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
            {parties.map((p) => (
              <option key={p.role} value={p.role}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Asset type</Label>
          <Select value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value as AssetClass })}>
            {ASSET_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Amount (EUR)</Label>
            <div className="relative">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1") })}
                className="pr-12 font-mono tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                EUR
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Settlement rail</Label>
            <Select
              value={form.asset}
              onChange={(e) => setForm({ ...form, asset: e.target.value as Asset })}
            >
              {RAILS.map((n) => (
                <option key={n.asset} value={n.asset}>
                  {n.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Evidence path</Label>
          <Select value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value as PathChoice })}>
            {PATHS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        {sameParty && (
          <p className="text-xs text-destructive">Debtor and creditor must be different parties.</p>
        )}

        <Button data-tour="submit" onClick={onSubmit} disabled={busy || !connected || !valid} className="mt-1 w-full">
          {busy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              Evaluating…
            </>
          ) : (
            "Submit transfer"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
