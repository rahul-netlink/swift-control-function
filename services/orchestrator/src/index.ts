import express from "express";
import {PORTS, loadScenario} from "@swift-cf/shared";
import {read, walletOf} from "./chain.js";
import {hub, startFeeds} from "./feeds.js";
import {buildState} from "./state.js";
import {
  ensureSeed,
  freezeParty,
  offboardInstitution,
  rebindInstitution,
  reset,
  runTransfer,
  setAssetClassAct,
  unfreezeParty,
  type TransferInput
} from "./acts.js";
import {publishPolicy, ruleCatalog, type PublishPolicySpec} from "./policy.js";
import {getMonitorStatus, pollFeed, startSanctionsMonitor} from "./monitor.js";
import type {SanctionsFeedDelta} from "@swift-cf/shared";
import type {AssetClass} from "./chain.js";

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") res.sendStatus(204);
  else next();
});
app.use(express.json());

const handle = (fn: (body: any) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
  try {
    res.json(await fn(req.body ?? {}));
  } catch (err) {
    console.error(err);
    res.status(500).json({error: (err as Error).message});
  }
};

app.get("/api/health", (_req, res) => res.json({ok: true}));
app.get("/api/events", hub.handler);
app.get("/api/scenario", (_req, res) => res.json(loadScenario()));
app.get("/api/state", handle(buildState));

app.post("/api/seed", handle(async () => {
  await ensureSeed(true);
  return buildState();
}));
app.post("/api/reset", handle(async () => {
  await reset();
  return buildState();
}));

app.post("/api/transfer", handle((body) => runTransfer(body as TransferInput)));

const ASSET_CLASSES: AssetClass[] = ["bond", "deposit", "equity", "fund"];
app.post("/api/asset", handle((body) => {
  const requested = (body as {assetClass?: string}).assetClass;
  const cls = ASSET_CLASSES.find((c) => c === requested) ?? "bond";
  return setAssetClassAct(cls);
}));

app.get("/api/policy/catalog", (_req, res) => res.json(ruleCatalog()));
app.post("/api/policy/publish", handle((body) => publishPolicy(body as PublishPolicySpec)));

app.get("/api/monitor", (_req, res) => res.json(getMonitorStatus()));
app.post("/api/monitor/poll", handle((body) => {
  const d = body as Partial<SanctionsFeedDelta>;
  return pollFeed(d.action ? (d as SanctionsFeedDelta) : undefined);
}));

app.post("/api/party/freeze", handle((body) => freezeParty(String((body as {role?: string}).role ?? ""))));
app.post("/api/party/unfreeze", handle((body) => unfreezeParty(String((body as {role?: string}).role ?? ""))));
app.post("/api/party/offboard", handle((body) => offboardInstitution(String((body as {role?: string}).role ?? ""))));
app.post("/api/party/rebind", handle((body) => rebindInstitution(String((body as {role?: string}).role ?? ""))));
app.post("/api/party/sanction", handle(async (body) => {
  const role = String((body as {role?: string}).role ?? "");
  const w = walletOf(role);
  const {listEpoch} = await pollFeed({action: "add", role, entity: w.name ?? role});
  return {ok: true, role, sanctioned: true, listEpoch: listEpoch ?? Number(await read.listRegistry.listEpoch())};
}));
app.post("/api/party/delist", handle(async (body) => {
  const role = String((body as {role?: string}).role ?? "");
  const w = walletOf(role);
  const {listEpoch} = await pollFeed({action: "remove", role, entity: w.name ?? role});
  return {ok: true, role, sanctioned: false, listEpoch: listEpoch ?? Number(await read.listRegistry.listEpoch())};
}));

const start = async () => {
  startFeeds();
  await ensureSeed(true);
  await read.controlFunction.getAddress();
  startSanctionsMonitor();
  app.listen(PORTS.orchestrator, () => console.log(`orchestrator listening on :${PORTS.orchestrator}`));
};

start().catch((err) => {
  console.error("orchestrator failed to start", err);
  process.exit(1);
});
