import express from "express";
import {Wallet, getBytes, hashMessage, recoverAddress} from "ethers";
import {
  EventHub,
  PORTS,
  buildDomain,
  loadDevKeys,
  loadDeployments,
  provider,
  signAttestation,
  type Attestation
} from "@swift-cf/shared";

const keys = loadDevKeys();
const groupKey = new Wallet(keys.roles.swiftSigner.privateKey);
const approvers = keys.thresholdApprovers.map((a) => ({id: a.id, wallet: new Wallet(a.privateKey)}));
const QUORUM = 2;
const QUORUM_EDD = approvers.length;

const hub = new EventHub("signer");
let nonceSeq = 1;

interface AttestationDraft {
  assetId: string;
  policyVersion: string;
  scope: number;
  subject: string;
  allowed: boolean;
  reasonCode: string;
  listEpoch: number;
  registryEpoch: number;
  edd?: boolean;
}

const collectQuorum = (digest: string) => {
  const acks = approvers.map((a) => {
    const signature = a.wallet.signMessageSync(getBytes(digest));
    const recovered = recoverAddress(hashMessage(getBytes(digest)), signature);
    return {id: a.id, approved: recovered === a.wallet.address};
  });
  const approved = acks.filter((a) => a.approved).length;
  return {acks, met: approved >= QUORUM, approved};
};

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") res.sendStatus(204);
  else next();
});
app.use(express.json());

app.get("/health", (_req, res) => res.json({ok: true, service: "signer"}));
app.get("/events", hub.handler);

app.post("/attest", async (req, res) => {
  const draft = req.body.attestation as AttestationDraft;
  const ttlSeconds = Number(req.body.ttlSeconds ?? 3600);

  const edd = Boolean(draft.edd);
  const required = edd ? QUORUM_EDD : QUORUM;
  const quorum = collectQuorum(draft.subject);
  const met = quorum.approved >= required;
  hub.emit(
    "QUORUM",
    `${edd ? "Enhanced due diligence " : ""}approver quorum ${quorum.approved} of ${required} ${met ? "met" : "not met"}.`,
    quorum.acks
  );
  if (!met) {
    return res.status(409).json({error: "quorum_not_met", acks: quorum.acks});
  }

  const network = await provider.getNetwork();
  const deployments = loadDeployments();
  const domain = buildDomain(Number(network.chainId), deployments.attestationVerifier);

  const now = Math.floor(Date.now() / 1000);
  const latest = await provider.getBlock("latest").catch(() => null);
  const chainNow = latest ? Number(latest.timestamp) : now;
  const notBefore = Math.min(now, chainNow) - 300;
  const attestation: Attestation = {
    assetId: draft.assetId,
    policyVersion: draft.policyVersion,
    scope: draft.scope,
    subject: draft.subject,
    allowed: draft.allowed,
    reasonCode: draft.reasonCode,
    notBefore,
    validUntil: now + ttlSeconds,
    listEpoch: Number(draft.listEpoch ?? 1),
    registryEpoch: Number(draft.registryEpoch ?? 1),
    edd,
    nonce: BigInt(nonceSeq++)
  };

  const signature = await signAttestation(groupKey, domain, attestation);
  hub.emit("ATTESTATION", `Issued ${draft.scope === 1 ? "operation-bound" : "party-standing"}${edd ? " enhanced due diligence" : ""} attestation.`, {
    subject: attestation.subject,
    nonce: attestation.nonce.toString()
  });

  res.json({
    attestation: {...attestation, nonce: attestation.nonce.toString()},
    signature,
    signer: groupKey.address,
    acks: quorum.acks,
    quorum: `${quorum.approved}-of-${required}`
  });
});

app.listen(PORTS.signer, () => console.log(`signer listening on :${PORTS.signer}`));
