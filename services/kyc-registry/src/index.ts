import express from "express";
import {EventHub, PORTS, loadRegistry, type Institution} from "@swift-cf/shared";

interface Binding {
  wallet: string;
  bic: string;
  registryRef: string;
  validUntil: number;
}

const institutions = new Map<string, Institution>();
for (const inst of loadRegistry().institutions) institutions.set(inst.bic, inst);

const bindings = new Map<string, Binding>();
const hub = new EventHub("registry");

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") res.sendStatus(204);
  else next();
});
app.use(express.json());

app.get("/health", (_req, res) => res.json({ok: true, service: "kyc-registry"}));
app.get("/events", hub.handler);

app.get("/entity/:bic", (req, res) => {
  const entity = institutions.get(req.params.bic.toUpperCase());
  if (!entity) return res.status(404).json({error: "not_found"});
  res.json(entity);
});

app.post("/binding", (req, res) => {
  const binding = req.body as Binding;
  const entity = institutions.get(binding.bic);
  if (!entity || entity.kycStatus !== "VALID") {
    return res.status(409).json({error: "kyc_invalid"});
  }
  bindings.set(binding.wallet.toLowerCase(), binding);
  hub.emit("KYC_UPDATED", `${binding.bic} bound to ${binding.wallet}`, binding);
  res.json({ok: true, binding, entity});
});

app.get("/binding/:wallet", (req, res) => {
  const binding = bindings.get(req.params.wallet.toLowerCase());
  if (!binding) return res.status(404).json({error: "not_found"});
  res.json(binding);
});

app.get("/bindings", (_req, res) => res.json([...bindings.values()]));

app.delete("/binding/:wallet", (req, res) => {
  const existed = bindings.delete(req.params.wallet.toLowerCase());
  res.json({ok: true, existed});
});

app.post("/withdraw", (req, res) => {
  const {wallet, bic} = req.body as {wallet: string; bic: string};
  bindings.delete(wallet.toLowerCase());
  hub.emit("KYC_WITHDRAWN", `KYC withdrawn for ${bic} (${wallet})`, {wallet, bic});
  res.json({ok: true});
});

app.listen(PORTS.registry, () => console.log(`kyc-registry listening on :${PORTS.registry}`));
