import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
export const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
export const OUT_DIR = process.env.OUT_DIR ?? resolve(REPO_ROOT, "out");

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN = (process.env.CHAIN ?? "anvil") as "anvil" | "besu";

export const PORTS = {
  orchestrator: Number(process.env.ORCHESTRATOR_PORT ?? 4000),
  signer: Number(process.env.SIGNER_PORT ?? 4001),
  registry: Number(process.env.REGISTRY_PORT ?? 4002),
  screening: Number(process.env.SCREENING_PORT ?? 4003)
} as const;

export const SERVICE_URLS = {
  signer: process.env.SIGNER_URL ?? `http://127.0.0.1:${PORTS.signer}`,
  registry: process.env.REGISTRY_URL ?? `http://127.0.0.1:${PORTS.registry}`,
  screening: process.env.SCREENING_URL ?? `http://127.0.0.1:${PORTS.screening}`
} as const;
