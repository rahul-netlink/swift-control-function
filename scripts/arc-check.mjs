import {spawn, spawnSync} from "node:child_process";
import {existsSync, appendFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {deploy} from "./deploy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN = process.env.CHAIN ?? "anvil";
const ANVIL_PORT = new URL(RPC_URL).port || "8545";
const ORCH_PORT = process.env.ORCHESTRATOR_PORT ?? "4000";
const SIGNER_PORT = process.env.SIGNER_PORT ?? "4001";
const REGISTRY_PORT = process.env.REGISTRY_PORT ?? "4002";
const SCREENING_PORT = process.env.SCREENING_PORT ?? "4003";
const API = `http://127.0.0.1:${ORCH_PORT}`;
const children = [];
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let beat = 0;
const heart = setInterval(() => process.stdout.write(`  …booting (${++beat * 2}s)\n`), 2000);
const stopHeart = () => clearInterval(heart);
const run = (name, cmd, args) => {
  const c = spawn(cmd, args, {cwd: ROOT, env: process.env, detached: true});
  c.stdout.on("data", () => {});
  c.stderr.on("data", (d) => process.env.VERBOSE && process.stderr.write(`[${name}] ${d}`));
  children.push(c);
  return c;
};
const shutdown = (code) => {
  for (const c of children) {
    try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} }
  }
  setTimeout(() => process.exit(code), 300);
};

async function waitFor(label, check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${label}`);
}
const httpOk = (url) => async () => (await fetch(url)).ok;
const post = async (path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body ?? {})
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`POST ${path} → ${r.status} ${t}`); }
  return r.json();
};
const getState = async () => (await fetch(`${API}/api/state`)).json();
const poll = (delta) => post("/api/monitor/poll", delta);
const partyClaim = async (role) => {
  const st = await getState();
  const p = st.parties.find((x) => x.role === role);
  return p ? {...p.claim, floor: st.epoch.list} : null;
};
const freshAtFloor = async (role) => {
  const c = await partyClaim(role);
  return Boolean(c && c.exists && !c.revoked && (c.listEpoch ?? 0) >= c.floor);
};
const revokedAtFloor = async (role) => {
  const c = await partyClaim(role);
  return Boolean(c && c.exists && c.revoked && (c.listEpoch ?? 0) >= c.floor);
};

const LOG = "/tmp/arc-result.log";
try { writeFileSync(LOG, ""); } catch {}
const out = (line) => { console.log(line); try { appendFileSync(LOG, line.replace(/\x1b\[[0-9]*m/g, "") + "\n"); } catch {} };
const C = {g: "\x1b[32m", r: "\x1b[31m", d: "\x1b[2m", x: "\x1b[0m", c: "\x1b[36m"};
const check = (label, cond, detail = "") => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  out(`${ok ? C.g + "PASS" : C.r + "FAIL"}${C.x} ${label}${detail ? `  ${C.d}${detail}${C.x}` : ""}`);
};
const transfer = (over = {}) =>
  post("/api/transfer", {from: "debtco", to: "fundmgr", amount: "100000", asset: "erc3643", path: "auto", ...over});

async function main() {
  if (!existsSync(resolve(ROOT, "node_modules"))) spawnSync("pnpm", ["install"], {cwd: ROOT, stdio: "inherit"});
  if (CHAIN === "anvil") run("anvil", "anvil", ["--silent", "--port", ANVIL_PORT]);
  await waitFor("rpc", async () => (await fetch(RPC_URL, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []})
  })).ok);
  deploy();

  const tsx = (f) => ["exec", "tsx", f];
  run("signer", "pnpm", tsx("services/signer/src/index.ts"));
  run("registry", "pnpm", tsx("services/kyc-registry/src/index.ts"));
  run("screening", "pnpm", tsx("services/screening/src/index.ts"));
  await Promise.all([
    waitFor("signer", httpOk(`http://127.0.0.1:${SIGNER_PORT}/health`)),
    waitFor("registry", httpOk(`http://127.0.0.1:${REGISTRY_PORT}/health`)),
    waitFor("screening", httpOk(`http://127.0.0.1:${SCREENING_PORT}/health`))
  ]);
  process.env.SANCTIONS_POLL_MS = "3600000";
  process.env.OUT_DIR = process.env.OUT_DIR ?? resolve(ROOT, ".arc-out");
  run("orchestrator", "pnpm", tsx("services/orchestrator/src/index.ts"));
  await waitFor("orchestrator", httpOk(`${API}/api/health`));
  stopHeart();

  out(`\n=== §2 demo arc ===`);

  let st = await getState();
  check("1 onboarded: list floor epoch = 1", st.epoch?.list === 1, `epoch=${JSON.stringify(st.epoch)}`);
  const fundmgr = () => (async () => (await getState()).parties.find((p) => p.role === "fundmgr"))();
  check("1 onboarded: parties carry standing claims", st.parties.filter((p) => p.claim.exists).length >= 3);

  let r = await transfer();
  check("2 happy path: debtco→fundmgr PERMITTED", r.status === "PERMITTED", `${r.decision.reasonCode}`);
  check("2 happy path: settled on-chain", r.settled === true && r.txHash, r.txHash ?? "");
  check("2 happy path: pacs.002 emitted ACSC", r.iso20022?.status === "ACSC", r.iso20022?.type);

  const bump = await poll({action: "add", role: "newfund", entity: "NewFund Capital SA", program: "ARC-TEST"});
  st = await getState();
  check("3 feed delta: on-chain list floor advanced 1→2", st.epoch?.list === 2, `epoch=${st.epoch?.list} listEpoch=${bump.listEpoch}`);
  const fm1 = await fundmgr();
  check("3 feed delta: fundmgr clearance now stale", (fm1.claim.listEpoch ?? 0) < st.epoch.list, `claim e${fm1.claim.listEpoch} < floor e${st.epoch.list}`);
  r = await transfer();
  check("3 feed delta: cached unexpired clear → DENY STL08", r.status === "BLOCKED" && r.decision.reasonCode === "STL08", r.decision.reasonCode);
  const freshStep = r.trace.find((s) => s.key === "freshness");
  check("3 feed delta: trace shows freshness step failing", freshStep?.status === "fail", freshStep?.detail);
  await waitFor("auto re-screen", async () => (await freshAtFloor("debtco")) && (await freshAtFloor("fundmgr")));
  r = await transfer();
  check("3 auto re-screen: clearance refreshed → PERMITTED", r.status === "PERMITTED", r.decision.reasonCode);

  await poll({action: "add", role: "fundmgr", entity: "FundMgr Asset Management SA", program: "ARC-SANCTION"});
  await waitFor("auto revoke", async () => (await freshAtFloor("debtco")) && (await revokedAtFloor("fundmgr")));
  r = await transfer();
  check("4 auto-sanction: feed delta → DENY AML02", r.status === "BLOCKED" && r.decision.reasonCode === "AML02", r.decision.reasonCode);
  await poll({action: "remove", role: "fundmgr", entity: "FundMgr Asset Management SA"});
  await poll({action: "remove", role: "newfund", entity: "NewFund Capital SA"});
  await waitFor("auto restore", async () => (await freshAtFloor("debtco")) && (await freshAtFloor("fundmgr")));
  r = await transfer();
  check("4 delisting: auto re-screen restores standing → PERMITTED", r.status === "PERMITTED", r.decision.reasonCode);

  out(`\n=== §5 binding revocation (I9) ===`);
  await post("/api/party/offboard", {role: "fundmgr"});
  let bnd = (await getState()).parties.find((p) => p.role === "fundmgr");
  check("5 offboard: fundmgr wallet→BIC binding revoked", bnd?.binding?.revoked === true, `epoch=${bnd?.binding?.epoch}`);
  r = await transfer();
  check("5 offboard: transfer → DENY BND13", r.status === "BLOCKED" && r.decision.reasonCode === "BND13", r.decision.reasonCode);
  const bindStep = r.trace.find((s) => s.key === "binding");
  check("5 offboard: trace shows wallet→BIC binding step failing", bindStep?.status === "fail", bindStep?.detail);
  await poll({action: "add", role: "newfund", entity: "NewFund Capital SA", program: "ARC-STICKY"});
  await waitFor("re-screen after offboard", async () => (await freshAtFloor("debtco")) && (await freshAtFloor("fundmgr")));
  await poll({action: "remove", role: "newfund", entity: "NewFund Capital SA"});
  await waitFor("re-screen settle", async () => (await freshAtFloor("debtco")) && (await freshAtFloor("fundmgr")));
  r = await transfer();
  check("5 sticky: re-screen cannot revive a dead binding → still BND13", r.status === "BLOCKED" && r.decision.reasonCode === "BND13", r.decision.reasonCode);
  await post("/api/party/rebind", {role: "fundmgr"});
  bnd = (await getState()).parties.find((p) => p.role === "fundmgr");
  check("5 re-bind: binding restored at higher epoch", bnd?.binding?.revoked === false && (bnd?.binding?.epoch ?? 0) >= 2, `epoch=${bnd?.binding?.epoch}`);
  r = await transfer();
  check("5 re-bind: standing restored → PERMITTED", r.status === "PERMITTED", r.decision.reasonCode);

  await post("/api/asset", {assetClass: "deposit"});
  st = await getState();
  check("6 swap: state asset class = deposit", st.assetClass === "deposit", st.policy?.assetName);
  const depRules = new Set((st.policy?.rules ?? []).map((x) => x.id));
  check("6 swap: deposit policy drops cap + lock-up", !depRules.has("lockup") && !depRules.has("holderCap"), `rules=${[...depRules].join(",")}`);
  r = await transfer({amount: "100000"});
  check("6 deposit transfer PERMITTED under smaller ruleset", r.status === "PERMITTED", `${r.request.assetClass} ${r.decision.reasonCode}`);
  check("6 deposit trace omits cap/lock-up steps", !r.trace.some((s) => s.key === "lockup" || s.key === "holderCap"));
  await post("/api/asset", {assetClass: "bond"});
  st = await getState();
  check("6 swap back: bond policy restores cap + lock-up", st.policy?.rules?.some((x) => x.id === "holderCap"), st.assetClass);
  r = await transfer();
  check("6 swap back: bond transfer PERMITTED", r.status === "PERMITTED", r.decision.reasonCode);

  r = await transfer({path: "cold"});
  check("7 audit: cold settlement records request + evidence hash", Boolean(r.decisionId && r.hashes?.request && r.hashes?.evidence), `${r.decisionId} ev=${r.hashes?.evidence ? "set" : "null"}`);
  check("7 audit: final gas total in record", r.gas?.total > 0, `gas=${r.gas?.total}`);

  out(`\n=== §8 advanced policy ===`);
  r = await transfer({amount: "5000000"});
  check("8 tiered: 5m bond → REVIEW EDD10", r.status === "REVIEW" && r.decision.reasonCode === "EDD10", `${r.status} ${r.decision.reasonCode}`);
  check("8 review: held, not settled", r.settled === false, `settled=${r.settled}`);
  check("8 review: pacs.002 status PDNG", r.iso20022?.status === "PDNG", r.iso20022?.status);
  const eddStep = r.trace.find((s) => s.key === "edd");
  check("8 review: trace EDD gate is 'review'", eddStep?.status === "review", eddStep?.detail);
  r = await transfer({amount: "5000000", edd: true});
  check("8 EDD escalate: enhanced approval → PERMITTED + settled", r.status === "PERMITTED" && r.settled === true, `${r.status} ${r.decision.reasonCode}`);
  r = await transfer({amount: "11000000"});
  check("8 tiered: 11m bond → DENY LIM16", r.status === "BLOCKED" && r.decision.reasonCode === "LIM16", r.decision.reasonCode);
  r = await transfer({amount: "5000000", asset: "erc20"});
  const reps = r.agnosticism?.representations ?? [];
  const hasLedger = reps.some((x) => x.kind === "ledger");
  check("8 agnostic: REVIEW identical across all representations", r.status === "REVIEW" && r.agnosticism?.identical === true, `identical=${r.agnosticism?.identical}`);
  check("8 agnostic: proof spans a non-token ledger", hasLedger && reps.length >= 3, `kinds=${reps.map((x) => x.kind).join(",")}`);

  out(`\n=== §9 policy builder ===`);
  st = await getState();
  const base = st.policy;
  const activeRules = (base.rules ?? []).map((x) => x.id).filter((id) => id !== "edd");
  const spec = (over) => ({
    version: "eu-mifid-sec-token-arc",
    activeRules,
    maxHolders: base.maxHolders,
    lockupEnd: base.lockupEnd ?? null,
    bands: base.bands,
    jurisdictions: base.jurisdictions ?? [],
    categories: base.categories ?? [],
    velocity: base.velocity ?? null,
    ...over,
  });
  const pub = await post("/api/policy/publish", spec({
    version: "eu-mifid-sec-token-arc@block-fr",
    jurisdictions: (base.jurisdictions ?? []).map((j) => (j.code === "FR" ? {...j, allowed: false} : j)),
  }));
  check("9 publish: RuleRegistry write returns gas + tx", pub.ok && pub.gasUsed > 0 && Boolean(pub.txHash), `gas=${pub.gasUsed} v=${pub.version}`);
  r = await transfer();
  check("9 published policy enforced on-chain: FR destination → DENY JUR03", r.status === "BLOCKED" && r.decision.reasonCode === "JUR03", r.decision.reasonCode);
  await post("/api/policy/publish", spec({version: "eu-mifid-sec-token-arc@restore"}));
  r = await transfer();
  check("9 republish: FR restored → PERMITTED", r.status === "PERMITTED", r.decision.reasonCode);

  out(`\n${failures === 0 ? "ARC OK" : failures + " FAILURE(S)"}`);
  shutdown(failures === 0 ? 0 : 1);
}

main().catch((e) => { stopHeart(); console.error(`${C.r}arc-check failed:${C.x}`, e.message); shutdown(1); });
