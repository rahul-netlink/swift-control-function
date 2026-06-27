import {SERVICE_URLS, loadSanctionsFeed, type SanctionsFeed, type SanctionsFeedDelta} from "@swift-cf/shared";
import {walletOf} from "./chain.js";
import {advanceListEpoch} from "./acts.js";
import {hub} from "./feeds.js";


interface RecentTick {
  ts: number;
  kind: "poll" | "delta";
  message: string;
  listEpoch?: number;
}

interface MonitorState {
  provider: string;
  intervalMs: number;
  running: boolean;
  lastPollTs: number | null;
  nextPollTs: number | null;
  lastDelta: {ts: number; action: "add" | "remove"; entity: string; program?: string; listEpoch: number} | null;
  recent: RecentTick[];
}

let feed: SanctionsFeed = {provider: "Sanctions feed", pollIntervalMs: 45000, deltas: [{action: "none"}]};
let pointer = 0;

const state: MonitorState = {
  provider: feed.provider,
  intervalMs: feed.pollIntervalMs,
  running: false,
  lastPollTs: null,
  nextPollTs: null,
  lastDelta: null,
  recent: []
};

const record = (tick: RecentTick): void => {
  state.recent = [tick, ...state.recent].slice(0, 8);
};

const applyToList = async (delta: SanctionsFeedDelta): Promise<boolean> => {
  if (!delta.role) return false;
  let w: ReturnType<typeof walletOf>;
  try {
    w = walletOf(delta.role);
  } catch {
    return false;
  }
  const path = delta.action === "add" ? "/list/add" : "/list/remove";
  const res = await fetch(`${SERVICE_URLS.screening}${path}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({wallet: w.address, bic: w.bic, name: delta.entity ?? w.name ?? w.ref})
  }).catch(() => undefined);
  return Boolean(res?.ok);
};

export const pollFeed = async (
  forced?: SanctionsFeedDelta
): Promise<{changed: boolean; action: SanctionsFeedDelta["action"]; listEpoch?: number}> => {
  const delta = forced ?? feed.deltas[pointer++ % feed.deltas.length] ?? {action: "none"};
  state.lastPollTs = Date.now();
  state.nextPollTs = null;

  if (delta.action === "none") {
    record({ts: state.lastPollTs, kind: "poll", message: `Polled ${feed.provider}, no list change`});
    return {changed: false, action: "none"};
  }

  const verb = delta.action === "add" ? "added to" : "removed from";
  const mutated = await applyToList(delta);
  if (!mutated) {
    record({
      ts: state.lastPollTs,
      kind: "delta",
      message: `Sanctions feed delta for ${delta.entity ?? delta.role ?? "unknown party"} could not be resolved; list unchanged`
    });
    return {changed: false, action: delta.action};
  }

  hub.emit(
    "FEED_DELTA",
    `Sanctions feed update: ${delta.entity ?? delta.role} ${verb} ${delta.program ?? "the consolidated list"}`,
    {provider: feed.provider, action: delta.action, entity: delta.entity, program: delta.program}
  );

  const {listEpoch} = await advanceListEpoch();
  state.lastDelta = {
    ts: state.lastPollTs,
    action: delta.action,
    entity: delta.entity ?? delta.role ?? "",
    program: delta.program,
    listEpoch
  };
  record({ts: state.lastPollTs, kind: "delta", message: `${delta.entity ?? delta.role} ${verb} list`, listEpoch});
  return {changed: true, action: delta.action, listEpoch};
};

export const startSanctionsMonitor = (): void => {
  if (state.running) return;
  feed = loadSanctionsFeed();
  pointer = 0;
  state.provider = feed.provider;
  const envMs = Number(process.env.SANCTIONS_POLL_MS);
  state.intervalMs = Number.isFinite(envMs) && envMs > 0 ? envMs : feed.pollIntervalMs;
  state.running = true;
  state.nextPollTs = null;
  hub.emit(
    "MONITOR_START",
    `Sanctions list monitor active. Re-screening runs on demand when the upstream feed reports a delta.`,
    {provider: feed.provider}
  );
};

export const getMonitorStatus = (): MonitorState => ({...state, recent: [...state.recent]});
