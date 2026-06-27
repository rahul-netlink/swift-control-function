import {AbiCoder, keccak256, toUtf8Bytes, encodeBytes32String, decodeBytes32String, hexlify, zeroPadBytes} from "ethers";
import type {Wallet} from "ethers";
import {ATTESTATION_TUPLE, CONTROL_REQUEST_TUPLE} from "./abi.js";
import type {Attestation, ControlRequest} from "./types.js";

const coder = AbiCoder.defaultAbiCoder();

export const buildDomain = (chainId: number, verifyingContract: string) => ({
  name: "SwiftControlFunction",
  version: "1",
  chainId,
  verifyingContract
});

export const ATTESTATION_TYPES = {
  Attestation: [
    {name: "assetId", type: "bytes32"},
    {name: "policyVersion", type: "bytes32"},
    {name: "scope", type: "uint8"},
    {name: "subject", type: "bytes32"},
    {name: "allowed", type: "bool"},
    {name: "reasonCode", type: "bytes32"},
    {name: "notBefore", type: "uint64"},
    {name: "validUntil", type: "uint64"},
    {name: "listEpoch", type: "uint64"},
    {name: "registryEpoch", type: "uint64"},
    {name: "edd", type: "bool"},
    {name: "nonce", type: "uint256"}
  ]
} as const;

export const operationCode = (op: string): string => keccak256(toUtf8Bytes(op));
export const reasonToBytes32 = (code: string): string => encodeBytes32String(code);
export const jurisdictionToBytes32 = (jur: string): string => encodeBytes32String(jur);
export const categoryToBytes32 = (category: string): string => encodeBytes32String(category);

export const encodeContext = (policyId: string, jurisdiction: string): string =>
  coder.encode(["bytes32", "bytes32"], [policyId, jurisdictionToBytes32(jurisdiction)]);

export const canonicalRequestHash = (req: ControlRequest): string => {
  const encoded = coder.encode(
    ["bytes32", "bytes32", "address", "address", "uint256", "bytes32"],
    [req.assetId, req.operation, req.from, req.to, req.amount, keccak256(req.context)]
  );
  return keccak256(encoded);
};

export const bicToBytes11 = (bic: string): string => zeroPadBytes(hexlify(toUtf8Bytes(bic)), 11);
export const bytes11ToBic = (raw: string): string => Buffer.from(raw.slice(2), "hex").toString("ascii").replace(/\0+$/, "");
export const bytes32ToText = (raw: string): string => {
  try {
    return decodeBytes32String(raw);
  } catch {
    return raw;
  }
};

export const signAttestation = async (
  wallet: Wallet,
  domain: ReturnType<typeof buildDomain>,
  att: Attestation
): Promise<string> => wallet.signTypedData(domain, ATTESTATION_TYPES as never, att);

export const encodeEvidence = (att: Attestation, signature: string): string =>
  coder.encode(
    [ATTESTATION_TUPLE, "bytes"],
    [
      [att.assetId, att.policyVersion, att.scope, att.subject, att.allowed, att.reasonCode, att.notBefore, att.validUntil, att.listEpoch, att.registryEpoch, att.edd, att.nonce],
      signature
    ]
  );

export const encodeRequestTuple = (req: ControlRequest) =>
  [req.assetId, req.operation, req.from, req.to, req.amount, req.context];

export {CONTROL_REQUEST_TUPLE};
