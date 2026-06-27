import {create} from "xmlbuilder2";
import type {XMLBuilder} from "xmlbuilder2/lib/interfaces";

export interface Party {
  name: string;
  bic: string;
  account: string;
}

export interface Pacs002Input {
  messageId: string;
  originalMessageId: string;
  originalEndToEndId: string;
  status: "ACSC" | "RJCT" | "PDNG";
  reasonCode: string;
  amount: string;
  currency: string;
  debtor: Party;
  creditor: Party;
  createdAt: Date;
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, "Z");
const day = (d: Date): string => d.toISOString().slice(0, 10);

const appendIvms101Person = (parent: XMLBuilder, tag: string, p: Party): void => {
  const lp = parent.ele(tag).ele("LegalPerson");
  const name = lp.ele("Name").ele("NameIdentifier").ele("LegalPersonName");
  name.txt(p.name);
  const natId = lp.ele("NationalIdentification");
  natId.ele("NationalIdentifier").txt(p.bic);
  natId.ele("NationalIdentifierType").txt("RAID");
  lp.ele("AccountNumber").txt(p.account);
};

export const buildPacs002 = (input: Pacs002Input): {xml: string; filename: string} => {
  const doc = create({version: "1.0", encoding: "UTF-8"});
  const rpt = doc
    .ele("Document", {xmlns: "urn:iso:std:iso:20022:tech:xsd:pacs.002.001.10"})
    .ele("FIToFIPmtStsRpt");

  const grpHdr = rpt.ele("GrpHdr");
  grpHdr.ele("MsgId").txt(input.messageId);
  grpHdr.ele("CreDtTm").txt(iso(input.createdAt));

  const orgnl = rpt.ele("OrgnlGrpInfAndSts");
  orgnl.ele("OrgnlMsgId").txt(input.originalMessageId);
  orgnl.ele("OrgnlMsgNmId").txt("pacs.008.001.08");

  const tx = rpt.ele("TxInfAndSts");
  tx.ele("StsId").txt(`${input.messageId}-1`);
  tx.ele("OrgnlEndToEndId").txt(input.originalEndToEndId);
  tx.ele("TxSts").txt(input.status);

  if (input.status !== "ACSC") {
    tx.ele("StsRsnInf").ele("Rsn").ele("Cd").txt(input.reasonCode);
  }

  const ref = tx.ele("OrgnlTxRef");
  ref.ele("IntrBkSttlmAmt", {Ccy: input.currency}).txt(input.amount);
  ref.ele("IntrBkSttlmDt").txt(day(input.createdAt));
  ref.ele("Dbtr").ele("FinInstnId").ele("BICFI").txt(input.debtor.bic);
  ref.ele("Cdtr").ele("FinInstnId").ele("BICFI").txt(input.creditor.bic);

  const envlp = tx.ele("SplmtryData").ele("Envlp").ele("Ivms101", {xmlns: "urn:ivms101"});
  appendIvms101Person(envlp, "Originator", input.debtor);
  appendIvms101Person(envlp, "Beneficiary", input.creditor);

  return {xml: doc.end({prettyPrint: true}), filename: `${input.messageId}.xml`};
};

export interface Camt054Input {
  messageId: string;
  account: Party;
  amount: string;
  currency: string;
  creditDebit: "CRDT" | "DBIT";
  createdAt: Date;
}

export const buildCamt054 = (input: Camt054Input): {xml: string; filename: string} => {
  const doc = create({version: "1.0", encoding: "UTF-8"});
  const ntfctn = doc
    .ele("Document", {xmlns: "urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"})
    .ele("BkToCstmrDbtCdtNtfctn");

  const grpHdr = ntfctn.ele("GrpHdr");
  grpHdr.ele("MsgId").txt(input.messageId);
  grpHdr.ele("CreDtTm").txt(iso(input.createdAt));

  const n = ntfctn.ele("Ntfctn");
  n.ele("Id").txt(`${input.messageId}-N1`);
  n.ele("Acct").ele("Id").ele("Othr").ele("Id").txt(input.account.account);

  const entry = n.ele("Ntry");
  entry.ele("Amt", {Ccy: input.currency}).txt(input.amount);
  entry.ele("CdtDbtInd").txt(input.creditDebit);
  entry.ele("Sts").ele("Cd").txt("BOOK");

  return {xml: doc.end({prettyPrint: true}), filename: `${input.messageId}.xml`};
};
