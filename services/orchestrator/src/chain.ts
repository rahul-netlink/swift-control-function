import {MaxUint256, NonceManager, parseEther} from "ethers";
import {
  canonicalRequestHash,
  contracts,
  encodeContext,
  encodeEvidence,
  encodeRequestTuple,
  loadDeployments,
  loadDevKeys,
  loadPolicyFor,
  loadRegistry,
  loadWallets,
  operationCode,
  reasonToBytes32,
  bicToBytes11,
  provider,
  wallet,
  SCOPE_OPERATION_BOUND,
  type Attestation,
  type ControlRequest,
  type Institution,
  type WalletFixture
} from "@swift-cf/shared";

export const deployments = loadDeployments();
const devKeys = loadDevKeys();
const walletFixtures = loadWallets().wallets;
const institutions = new Map<string, Institution>(loadRegistry().institutions.map((i) => [i.bic, i]));

export const adminWallet = new NonceManager(wallet(devKeys.roles.deployer.privateKey));
export const orchestratorWallet = new NonceManager(wallet(devKeys.roles.orchestrator.privateKey));
export const operatorWallet = new NonceManager(wallet(devKeys.roles.freezeOperator.privateKey));

const byRole = new Map(walletFixtures.map((w) => [w.role, w]));
const byRef = new Map(walletFixtures.map((w) => [w.ref ?? w.role, w]));
const byAddress = new Map(walletFixtures.map((w) => [w.address.toLowerCase(), w]));

export const countryOf = (w: WalletFixture): string => w.jurisdiction;

export const walletOf = (idOrRef: string): WalletFixture => {
  const w = byRole.get(idOrRef) ?? byRef.get(idOrRef);
  if (!w) throw new Error(`unknown party ${idOrRef}`);
  return w;
};

export const allWallets = (): WalletFixture[] => walletFixtures;

export const institutionOf = (w: WalletFixture): Institution | undefined =>
  w.bic ? institutions.get(w.bic) : undefined;

export const fixtureByAddress = (addr: string): WalletFixture | undefined => byAddress.get(addr.toLowerCase());

export const read = contracts(deployments, provider);
export const asAdmin = contracts(deployments, adminWallet);
export const asOrchestrator = contracts(deployments, orchestratorWallet);
export const asOperator = contracts(deployments, operatorWallet);
const walletContracts = new Map<string, ReturnType<typeof contracts>>();
export const asWallet = (role: string) => {
  let bound = walletContracts.get(role);
  if (!bound) {
    bound = contracts(deployments, new NonceManager(wallet(walletOf(role).privateKey)));
    walletContracts.set(role, bound);
  }
  return bound;
};

export const TRANSFER = operationCode("TRANSFER");

export type {AssetClass} from "@swift-cf/shared";
import type {AssetClass} from "@swift-cf/shared";

interface ClassConfig {
  assetClass: AssetClass;
  assetId: string;
  policyId: string;
  policyVersion: string;
  tokenAddress: string;
  adapterKey: "erc20Adapter" | "depositAdapter" | "equityAdapter" | "fundAdapter";
}

const CLASS_CONFIG: Record<AssetClass, ClassConfig> = {
  bond: {
    assetClass: "bond",
    assetId: deployments.assetId,
    policyId: deployments.policyId,
    policyVersion: deployments.policyVersion,
    tokenAddress: deployments.erc20,
    adapterKey: "erc20Adapter"
  },
  deposit: {
    assetClass: "deposit",
    assetId: deployments.depositAssetId,
    policyId: deployments.depositPolicyId,
    policyVersion: deployments.depositPolicyVersion,
    tokenAddress: deployments.depositErc20,
    adapterKey: "depositAdapter"
  },
  equity: {
    assetClass: "equity",
    assetId: deployments.equityAssetId,
    policyId: deployments.equityPolicyId,
    policyVersion: deployments.equityPolicyVersion,
    tokenAddress: deployments.equityErc20,
    adapterKey: "equityAdapter"
  },
  fund: {
    assetClass: "fund",
    assetId: deployments.fundAssetId,
    policyId: deployments.fundPolicyId,
    policyVersion: deployments.fundPolicyVersion,
    tokenAddress: deployments.fundErc20,
    adapterKey: "fundAdapter"
  }
};

let currentClass: AssetClass = "bond";
export const getAssetClass = (): AssetClass => currentClass;
export const setAssetClass = (cls: AssetClass): void => {
  currentClass = cls;
};
export const classCfg = (): ClassConfig => CLASS_CONFIG[currentClass];

const policyOverride = new Map<AssetClass, Record<string, unknown>>();
export const setPolicyOverride = (cls: AssetClass, policy: Record<string, unknown>): void => {
  policyOverride.set(cls, policy);
};
export const clearPolicyOverride = (cls?: AssetClass): void => {
  if (cls) policyOverride.delete(cls);
  else policyOverride.clear();
};
export const getPolicyData = (cls: AssetClass): Record<string, unknown> =>
  policyOverride.get(cls) ?? loadPolicyFor(cls);

export const currentEpochs = async (): Promise<{list: number; registry: number}> => {
  const [list, registry] = await Promise.all([read.listRegistry.listEpoch(), read.listRegistry.registryEpoch()]);
  return {list: Number(list), registry: Number(registry)};
};

export const buildRequest = (fromRole: string, toRole: string, tokens: string): ControlRequest => {
  const from = walletOf(fromRole);
  const to = walletOf(toRole);
  const cfg = classCfg();
  return {
    assetId: cfg.assetId,
    operation: TRANSFER,
    from: from.address,
    to: to.address,
    amount: parseEther(tokens),
    context: encodeContext(cfg.policyId, countryOf(to))
  };
};

export interface SignedAttestation {
  attestation: Attestation;
  signature: string;
  signer: string;
  acks: {id: string; approved: boolean}[];
  quorum: string;
}

export const coldEvidence = (signed: SignedAttestation): string =>
  encodeEvidence(signed.attestation, signed.signature);

export const attestationDraft = async (req: ControlRequest, listEpoch: number, edd = false) => {
  const cfg = classCfg();
  const [policy, registryEpoch] = await Promise.all([
    read.ruleRegistry.policy(cfg.policyId),
    read.listRegistry.registryEpoch()
  ]);
  return {
    assetId: req.assetId,
    policyVersion: policy.version,
    scope: SCOPE_OPERATION_BOUND,
    subject: canonicalRequestHash(req),
    allowed: true,
    reasonCode: reasonToBytes32("OK00"),
    listEpoch,
    registryEpoch: Number(registryEpoch),
    edd
  };
};

export const reqTuple = encodeRequestTuple;
export {MaxUint256, bicToBytes11};
