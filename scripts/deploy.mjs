import {spawnSync} from "node:child_process";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve, delimiter} from "node:path";
import {homedir} from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

export function ensureFoundryOnPath() {
  const onPath = (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir && existsSync(resolve(dir, "forge")));
  if (onPath) return;

  const candidate = resolve(homedir(), ".foundry", "bin");
  if (existsSync(resolve(candidate, "forge"))) {
    process.env.PATH = `${candidate}${delimiter}${process.env.PATH ?? ""}`;
  }
}

export function deploy() {
  ensureFoundryOnPath();

  const keys = JSON.parse(readFileSync(resolve(ROOT, "fixtures/dev-keys.json"), "utf8"));
  const env = {
    ...process.env,
    DEPLOYER_PK: keys.roles.deployer.privateKey,
    SWIFT_SIGNER: keys.roles.swiftSigner.address,
    ORCHESTRATOR: keys.roles.orchestrator.address,
    FREEZE_OPERATOR: keys.roles.freezeOperator.address
  };

  const result = spawnSync(
    "forge",
    ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC_URL, "--broadcast", "--silent"],
    {cwd: resolve(ROOT, "contracts"), env, stdio: "inherit"}
  );

  if (result.status !== 0) {
    throw new Error(`deploy failed with status ${result.status}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deploy();
}
