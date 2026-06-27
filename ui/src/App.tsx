import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useEvents } from "./useEvents";
import type { AssetClass, DemoState, LogEntry, PublishPolicySpec, TransferInput, TransferResult } from "./types";
import { SanctionsMonitor } from "./components/SanctionsMonitor";
import { TransferForm, type TransferFormValues } from "./components/TransferForm";
import { PolicyEngine } from "./components/PolicyEngine";
import { TransactionLog } from "./components/TransactionLog";
import { ActivityLog } from "./components/ActivityLog";
import { DecisionPanel } from "./components/DecisionPanel";
import { GuidedTour, type TourController } from "./components/GuidedTour";
import { Card } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Tabs } from "./components/ui/tabs";
import { cn } from "./lib/utils";

const DEFAULT_FORM: TransferFormValues = { from: "debtco", to: "fundmgr", amount: "100000", asset: "erc3643", assetClass: "bond", path: "auto" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type FeedTab = "activity" | "sanctions" | "policy";

export default function App() {
  const events = useEvents();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DemoState | null>(null);
  const [form, setForm] = useState<TransferFormValues>(DEFAULT_FORM);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const [feedTab, setFeedTab] = useState<FeedTab>("activity");
  const [tourPhase, setTourPhase] = useState<"intro" | "running" | "closed">("intro");

  const busyRef = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const ok = await api.health();
      if (active) setConnected(ok);
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const refreshState = useCallback(async () => {
    try {
      setState(await api.state());
    } catch {
    }
  }, []);

  useEffect(() => {
    if (connected) refreshState();
  }, [connected, refreshState]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    (async () => {
      try {
        await api.setAssetClass(form.assetClass);
        if (active) await refreshState();
      } catch {
      }
    })();
    return () => {
      active = false;
    };
  }, [form.assetClass, connected, refreshState]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch {
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const record = useCallback((entry: LogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 100));
    setLatestKey(entry.key);
    setSelected(entry);
  }, []);

  const runTransfer = useCallback(
    async (input: TransferInput): Promise<TransferResult | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await api.transfer(input);
        record({ key: `${result.decisionId}-${seq.current++}`, ts: Date.now(), result });
        await refreshState();
        return result;
      } catch {
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [record, refreshState],
  );

  const handleSubmit = useCallback(() => {
    void runTransfer({ ...form });
  }, [runTransfer, form]);

  const handleEscalate = useCallback(
    () =>
      guard(async () => {
        if (!selected) return;
        const r = selected.result.request;
        const result = await api.transfer({ from: r.fromRef, to: r.toRef, amount: r.amount, asset: r.asset, assetClass: r.assetClass, path: "auto", edd: true });
        record({ key: `${result.decisionId}-${seq.current++}`, ts: Date.now(), result, escalatedFrom: selected.result.decisionId });
        await refreshState();
      }),
    [guard, selected, refreshState, record],
  );

  const handleReset = () => guard(async () => { await api.reset(); setLog([]); setLatestKey(null); setSelected(null); await refreshState(); });

  const handleFreeze = (role: string) => guard(async () => { await api.freezeParty(role); await refreshState(); });
  const handleUnfreeze = (role: string) => guard(async () => { await api.unfreezeParty(role); await refreshState(); });
  const handleSanction = (role: string) => guard(async () => { await api.sanctionParty(role); await refreshState(); });
  const handleDelist = (role: string) => guard(async () => { await api.delistParty(role); await refreshState(); });
  const handleOffboard = (role: string) => guard(async () => { await api.offboardParty(role); await refreshState(); });
  const handleRebind = (role: string) => guard(async () => { await api.rebindParty(role); await refreshState(); });

  const handlePublish = useCallback(
    async (spec: PublishPolicySpec) => {
      if (busyRef.current) throw new Error("busy");
      busyRef.current = true;
      setBusy(true);
      try {
        const r = await api.publishPolicy(spec);
        await refreshState();
        return r;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refreshState],
  );

  const tour: TourController = useMemo(
    () => ({
      reset: async () => {
        await api.reset();
        setLog([]);
        setLatestKey(null);
        setSelected(null);
        await refreshState();
      },
      setForm,
      setFeedTab,
      awaitRescreen: async (roles) => {
        for (let i = 0; i < 25; i++) {
          let s: DemoState;
          try {
            s = await api.state();
          } catch {
            await sleep(400);
            continue;
          }
          setState(s);
          const floor = s.epoch?.list ?? 0;
          const ready = roles.every((role) => {
            const p = s.parties.find((x) => x.role === role);
            return p && !p.binding?.revoked && (p.claim?.listEpoch ?? 0) >= floor;
          });
          if (ready) return;
          await sleep(400);
        }
      },
    }),
    [refreshState],
  );

  const listEpoch = state?.epoch?.list ?? 1;
  const assetClass: AssetClass = state?.assetClass ?? "bond";

  return (
    <div className="flex min-h-full flex-col">
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16">
        {}
        <div className="flex items-center justify-between gap-4 pt-8 pb-6">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Control Function Demo</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTourPhase("intro")}
              disabled={!connected}
              title="Walk through the demo step by step"
            >
              Guided tour
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={busy || !connected}
              title="Reset the ledger to its seeded state"
            >
              Reset
            </Button>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
                connected
                  ? "border-success-border bg-success-muted text-success"
                  : "border-destructive-border bg-destructive-muted text-destructive",
              )}
            >
              <span className={cn("size-1.5 rounded-full", connected ? "animate-pulse bg-success" : "bg-destructive")} />
              {connected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>

        {}
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(340px,380px)_1fr]">
          <TransferForm
            parties={state?.parties ?? []}
            form={form}
            setForm={setForm}
            connected={connected}
            busy={busy}
            onSubmit={handleSubmit}
          />

          <div className="flex min-w-0 flex-col gap-6">
            <DecisionPanel result={selected?.result ?? null} onEscalate={handleEscalate} escalating={busy} escalatedFrom={selected?.escalatedFrom} />
            <TransactionLog
              entries={log}
              latestKey={latestKey}
              selectedKey={selected?.key ?? null}
              onSelect={setSelected}
            />
          </div>
        </section>

        {}
        <Card data-tour="feed" className="mt-6 overflow-hidden">
          <div className="border-b px-5 py-3">
            <Tabs
              value={feedTab}
              onChange={(v) => setFeedTab(v as FeedTab)}
              tabs={[
                { value: "activity", label: "Activity" },
                { value: "sanctions", label: "Sanctions monitor", tourId: "sanctions-tab" },
                { value: "policy", label: "Policy engine", tourId: "policy-tab" },
              ]}
            />
          </div>
          {feedTab === "activity" && <ActivityLog events={events} />}
          {feedTab === "sanctions" && (
            <SanctionsMonitor
              monitor={state?.monitor}
              listEpoch={listEpoch}
              busy={busy}
              connected={connected}
              parties={state?.parties ?? []}
              onFreeze={handleFreeze}
              onUnfreeze={handleUnfreeze}
              onSanction={handleSanction}
              onDelist={handleDelist}
              onOffboard={handleOffboard}
              onRebind={handleRebind}
            />
          )}
          {feedTab === "policy" && (
            <PolicyEngine policy={state?.policy} assetClass={assetClass} busy={busy} connected={connected} onPublish={handlePublish} />
          )}
        </Card>
      </main>

      <footer className="mt-8 border-t border-border/70 px-6 py-6 text-center text-xs text-muted-foreground">
        SWIFT Asset Control · control plane <span className="font-mono">{api.baseUrl}</span>
      </footer>

      <GuidedTour
        phase={tourPhase}
        setPhase={setTourPhase}
        controller={tour}
        connected={connected}
        latestKey={latestKey}
        latestResult={log[0]?.result ?? null}
        state={state}
      />
    </div>
  );
}
