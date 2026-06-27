import {Contract, JsonRpcProvider, Wallet} from "ethers";
import type {ContractRunner} from "ethers";
import {RPC_URL} from "./config.js";
import {
  CLAIM_CACHE_ABI,
  CONTROL_FUNCTION_ABI,
  ERC20_ABI,
  ERC20_ADAPTER_ABI,
  EXTERNAL_LEDGER_ADAPTER_ABI,
  FREEZE_REGISTRY_ABI,
  LIST_REGISTRY_ABI,
  PERMISSIONED_ADAPTER_ABI,
  RULE_REGISTRY_ABI,
  VELOCITY_REGISTRY_ABI,
  VERIFIER_ABI
} from "./abi.js";
import type {Deployments} from "./fixtures.js";

export const provider = new JsonRpcProvider(RPC_URL);
export const wallet = (privateKey: string): Wallet => new Wallet(privateKey, provider);

export const contracts = (d: Deployments, runner: ContractRunner = provider) => ({
  controlFunction: new Contract(d.controlFunction, CONTROL_FUNCTION_ABI, runner),
  claimCache: new Contract(d.claimCache, CLAIM_CACHE_ABI, runner),
  freezeRegistry: new Contract(d.freezeRegistry, FREEZE_REGISTRY_ABI, runner),
  listRegistry: new Contract(d.listRegistry, LIST_REGISTRY_ABI, runner),
  ruleRegistry: new Contract(d.ruleRegistry, RULE_REGISTRY_ABI, runner),
  velocityRegistry: new Contract(d.velocityRegistry, VELOCITY_REGISTRY_ABI, runner),
  verifier: new Contract(d.attestationVerifier, VERIFIER_ABI, runner),
  erc20: new Contract(d.erc20, ERC20_ABI, runner),
  erc20Adapter: new Contract(d.erc20Adapter, ERC20_ADAPTER_ABI, runner),
  permAdapter: new Contract(d.permissionedTokenAdapter, PERMISSIONED_ADAPTER_ABI, runner),
  externalLedgerAdapter: new Contract(d.externalLedgerAdapter, EXTERNAL_LEDGER_ADAPTER_ABI, runner),
  depositErc20: new Contract(d.depositErc20, ERC20_ABI, runner),
  depositAdapter: new Contract(d.depositAdapter, ERC20_ADAPTER_ABI, runner),
  equityErc20: new Contract(d.equityErc20, ERC20_ABI, runner),
  equityAdapter: new Contract(d.equityAdapter, ERC20_ADAPTER_ABI, runner),
  fundErc20: new Contract(d.fundErc20, ERC20_ABI, runner),
  fundAdapter: new Contract(d.fundAdapter, ERC20_ADAPTER_ABI, runner)
});

export type Contracts = ReturnType<typeof contracts>;
