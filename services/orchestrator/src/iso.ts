import {mkdirSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {buildPacs002, type Party} from "@swift-cf/iso20022";
import {OUT_DIR, type Outcome} from "@swift-cf/shared";
import {institutionOf, walletOf} from "./chain.js";

mkdirSync(OUT_DIR, {recursive: true});
let seq = 1;

const partyFor = (role: string): Party => {
  const w = walletOf(role);
  const inst = institutionOf(w);
  return {
    name: inst?.legalName ?? "Unbound Wallet",
    bic: w.bic ?? "NOTPROVIDED",
    account: w.address
  };
};

export interface IsoResult {
  type: string;
  status: "ACSC" | "RJCT" | "PDNG";
  xml: string;
  filename: string;
}

const isoStatusFor = (outcome: Outcome): "ACSC" | "RJCT" | "PDNG" =>
  outcome === "ALLOW" ? "ACSC" : outcome === "REVIEW" ? "PDNG" : "RJCT";

export const emitPacs002 = (params: {
  fromRole: string;
  toRole: string;
  tokens: string;
  outcome: Outcome;
  reasonCode: string;
}): IsoResult => {
  const id = String(seq++).padStart(6, "0");
  const messageId = `SWFTACSPACS${id}`;
  const status = isoStatusFor(params.outcome);

  const {xml, filename} = buildPacs002({
    messageId,
    originalMessageId: `SWFTACSPACS008${id}`,
    originalEndToEndId: `E2E-${id}`,
    status,
    reasonCode: params.reasonCode,
    amount: params.tokens,
    currency: "EUR",
    debtor: partyFor(params.fromRole),
    creditor: partyFor(params.toRole),
    createdAt: new Date()
  });

  writeFileSync(resolve(OUT_DIR, filename), xml);
  return {type: "pacs.002.001.10", status, xml, filename};
};
