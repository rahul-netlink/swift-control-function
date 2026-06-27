import express from "express";
import {EventHub, PORTS, loadSanctions} from "@swift-cf/shared";

interface Party {
  wallet: string;
  bic?: string;
  name?: string;
}

const seed = loadSanctions();
let listVersion = seed.listVersion;
let listEpoch = 1;
const list = new Map<string, Party>();
for (const p of seed.parties) list.set(p.toLowerCase(), {wallet: p});

const hub = new EventHub("screening");
const key = (addr: string) => addr.toLowerCase();
const onList = (addr?: string) => (addr ? list.has(key(addr)) : false);

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") res.sendStatus(204);
  else next();
});
app.use(express.json());

app.get("/health", (_req, res) => res.json({ok: true, service: "screening"}));
app.get("/events", hub.handler);
app.get("/list", (_req, res) => res.json({listVersion, listEpoch, parties: [...list.values()]}));

app.post("/screen", (req, res) => {
  const {from, to} = req.body as {from: string; to: string};
  const hit = onList(from) || onList(to);
  res.json({result: hit ? "hit" : "clear", listVersion, listEpoch, ts: Date.now()});
});

app.post("/list/update", (_req, res) => {
  listEpoch += 1;
  listVersion = new Date().toISOString();
  hub.emit("LIST_EPOCH_BUMPED", `Sanctions list updated. Epoch advanced to ${listEpoch}.`, {listEpoch});
  res.json({ok: true, listEpoch, listVersion});
});

app.post("/list/add", (req, res) => {
  const party = req.body as Party;
  list.set(key(party.wallet), party);
  listVersion = new Date().toISOString();
  hub.emit("LIST_UPDATED", `Sanctions list updated. ${party.name ?? party.wallet} added.`, party);
  res.json({ok: true, listVersion, party});
});

app.post("/list/remove", (req, res) => {
  const {wallet, name} = req.body as {wallet: string; name?: string};
  const existed = list.delete(key(wallet));
  if (existed) {
    listVersion = new Date().toISOString();
    hub.emit("LIST_CLEARED", `Sanctions list updated. ${name ?? wallet} removed.`, {wallet, name});
  }
  res.json({ok: true, listVersion, removed: existed});
});

app.listen(PORTS.screening, () => console.log(`screening listening on :${PORTS.screening}`));
