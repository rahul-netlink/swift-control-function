import {spawn, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {deploy, ensureFoundryOnPath} from "./deploy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

ensureFoundryOnPath();
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN = process.env.CHAIN ?? "anvil";

const children = [];
const C = {reset: "\x1b[0m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m"};

function run(name, command, args, opts = {}) {
  const child = spawn(command, args, {cwd: ROOT, env: process.env, ...opts});
  children.push(child);
  const tag = `${C.dim}[${name}]${C.reset} `;
  const pipe = (stream, sink) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) sink.write(`${tag}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, check, {timeout = 30000, interval = 400} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const rpcReady = async () => {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: []})
  });
  return res.ok;
};

const httpOk = (url) => async () => (await fetch(url)).ok;

function shutdown(code = 0) {
  for (const child of children) {
    try {
      child.kill("SIGINT");
    } catch {
    }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  if (!existsSync(resolve(ROOT, "node_modules"))) {
    console.log(`${C.cyan}Installing workspace dependencies…${C.reset}`);
    spawnSync("pnpm", ["install"], {cwd: ROOT, stdio: "inherit"});
  }

  if (CHAIN === "anvil") {
    console.log(`${C.cyan}Starting anvil…${C.reset}`);
    run("anvil", "anvil", ["--silent"]);
  } else {
    console.log(`${C.cyan}Using external ${CHAIN} node at ${RPC_URL}${C.reset}`);
  }
  await waitFor("rpc", rpcReady);

  console.log(`${C.cyan}Deploying control function…${C.reset}`);
  deploy();

  const tsx = (file) => ["exec", "tsx", file];
  console.log(`${C.cyan}Starting SWIFT services…${C.reset}`);
  run("signer", "pnpm", tsx("services/signer/src/index.ts"));
  run("registry", "pnpm", tsx("services/kyc-registry/src/index.ts"));
  run("screening", "pnpm", tsx("services/screening/src/index.ts"));
  await Promise.all([
    waitFor("signer", httpOk("http://127.0.0.1:4001/health")),
    waitFor("registry", httpOk("http://127.0.0.1:4002/health")),
    waitFor("screening", httpOk("http://127.0.0.1:4003/health"))
  ]);

  run("orchestrator", "pnpm", tsx("services/orchestrator/src/index.ts"));
  await waitFor("orchestrator", httpOk("http://127.0.0.1:4000/api/health"), {timeout: 45000});

  console.log(`${C.cyan}Starting console…${C.reset}`);
  run("ui", "pnpm", ["--filter", "ui", "dev"]);
  await waitFor("ui", httpOk("http://127.0.0.1:5173"), {timeout: 45000});

  console.log(
    `\n${C.green}Ready.${C.reset} Console: ${C.cyan}http://localhost:5173${C.reset}  ` +
      `API: ${C.dim}http://localhost:4000${C.reset}\n${C.yellow}Ctrl-C to stop.${C.reset}\n`
  );

  let t = 0;
  setInterval(() => process.stdout.write(`${C.dim}[demo] up ${(++t * 3)}s — Ctrl-C to stop${C.reset}\n`), 3000);
}

main().catch((err) => {
  console.error(`${C.yellow}demo failed:${C.reset}`, err.message);
  shutdown(1);
});
