import {readFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";
import {FIXTURES_DIR} from "./config.js";

const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), "utf8")) as T;

export interface DevKeys {
  roles: Record<string, {address: string; privateKey: string; note?: string}>;
  thresholdApprovers: {id: string; privateKey: string}[];
}

export interface Institution {
  bic: string;
  legalName: string;
  jurisdiction: string;
  kycStatus: string;
  validUntil: string;
  registryRef: string;
}

export interface WalletFixture {
  role: string;
  address: string;
  privateKey: string;
  bic: string | null;
  jurisdiction: string;
  category?: string;
  ref?: string;
  name?: string;
  holdings?: string;
}

export interface Deployments {
  controlFunction: string;
  ruleRegistry: string;
  claimCache: string;
  freezeRegistry: string;
  attestationVerifier: string;
  listRegistry: string;
  velocityRegistry: string;
  erc20: string;
  erc20Adapter: string;
  permissionedToken: string;
  permissionedTokenAdapter: string;
  externalLedgerAdapter: string;
  assetId: string;
  policyId: string;
  policyVersion: string;
  depositErc20: string;
  depositAdapter: string;
  depositAssetId: string;
  depositPolicyId: string;
  depositPolicyVersion: string;
  equityErc20: string;
  equityAdapter: string;
  equityAssetId: string;
  equityPolicyId: string;
  equityPolicyVersion: string;
  fundErc20: string;
  fundAdapter: string;
  fundAssetId: string;
  fundPolicyId: string;
  fundPolicyVersion: string;
}

export type AssetClass = "bond" | "deposit" | "equity" | "fund";

export const loadDevKeys = (): DevKeys => read<DevKeys>("dev-keys.json");
export const loadRegistry = (): {institutions: Institution[]} => read("registry.json");
export const loadWallets = (): {wallets: WalletFixture[]} => read("wallets.json");
export const loadPolicy = (): Record<string, unknown> => read("policy.json");
export const loadDepositPolicy = (): Record<string, unknown> => read("policy.deposit.json");
const POLICY_FILE: Record<AssetClass, string> = {
  bond: "policy.json",
  deposit: "policy.deposit.json",
  equity: "policy.equity.json",
  fund: "policy.fund.json"
};
export const loadPolicyFor = (assetClass: AssetClass): Record<string, unknown> =>
  read(POLICY_FILE[assetClass]);
export const loadScenario = (): Record<string, unknown> => read("scenario.json");
export const loadSanctions = (): {listVersion: string; parties: string[]} => read("sanctions-list.json");

export interface SanctionsFeedDelta {
  action: "add" | "remove" | "none";
  role?: string;
  entity?: string;
  program?: string;
  listRef?: string;
}
export interface SanctionsFeed {
  provider: string;
  pollIntervalMs: number;
  deltas: SanctionsFeedDelta[];
}
export const loadSanctionsFeed = (): SanctionsFeed => read<SanctionsFeed>("sanctions-feed.json");

export const deploymentsPath = resolve(FIXTURES_DIR, "deployments.json");
export const hasDeployments = (): boolean => existsSync(deploymentsPath);
export const loadDeployments = (): Deployments => read<Deployments>("deployments.json");
