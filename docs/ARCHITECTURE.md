# Architecture

One asset-agnostic control function, reached through one interface (`IControlFunction`),
deciding every operation across token types. Work is split across a hybrid on-chain /
off-chain topology aligned to the PEP / PDP / PIP / PAP reference model.

```
            TOKEN LAYER (PEP — enforcement)
  ┌────────────────┬──────────────────────┬──────────────────────────┐
  │  ERC20Adapter  │ PermissionedToken    │ MockExternalLedgerAdapter │
  │  (plain ERC20) │ Adapter (ERC-3643)   │ (off-EVM projection)      │
  └───────┬────────┴──────────┬───────────┴─────────────┬────────────┘
          │   identical ControlRequest, identical Decision
          ▼                   ▼                         ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                ControlFunction  (PDP — decision)                  │
  │            rules combined deny-overrides, short-circuit           │
  └───┬───────────────┬────────────────┬───────────────────┬─────────┘
      ▼               ▼                ▼                   ▼
  RuleRegistry   FreezeRegistry    ClaimCache       AttestationVerifier
  (PAP: policy)  (PIP: live        (PIP: standing   (trust anchor for
   per asset      freeze/caps)      claims — HOT)     the SWIFT signer — COLD)
   class)        ListRegistry (PIP: sanctions-list / registry epoch floors — I3 freshness)
      ────────────────────────────────────────────────────────  on-chain (EVM / Besu)
      ════════════════════════════════════════════════════════  off-chain (SWIFT)
                                          ▲                ▲
                                          │ publish/revoke │ EIP-712 attestation
                                          │   claims       │ (2-of-3 quorum)
  ┌──────────────┐   feeds    ┌───────────┴────┐   ┌───────┴────────┐
  │ KYC Registry │──────────▶ │  Orchestrator  │──▶│ Threshold Signer│
  │ (PIP)        │            │  (reacts,      │   │ (group key)     │
  ├──────────────┤  LIST_UPD  │   publishes,   │   └─────────────────┘
  │  Screening + │──────────▶ │   emits ISO    │
  │  List Monitor│            │   20022)       │
  └──────────────┘            └───────┬────────┘
                                      │ pacs.002 / camt.054 (+ IVMS101)
                                      ▼
                               Demo console (React)
```

## On-chain / off-chain split

| Concern | Where | Why |
|---------|-------|-----|
| Operation gating (PEP) | on-chain adapters | Enforcement must be atomic with value movement |
| Decision (PDP) | on-chain `ControlFunction` | Deterministic, auditable, identical across tokens |
| Policy (PAP) | on-chain `RuleRegistry` | Rules-as-data, governed, versioned |
| Live state (PIP) | on-chain `FreezeRegistry`, `ClaimCache`, `ListRegistry` | Break-glass + hot-path claims + epoch floors read cheaply |
| Identity / KYC | off-chain KYC Registry | Institutional, BIC-keyed; only references/hashes go on chain |
| Sanctions screening | off-chain Screening + List Monitor | Large, fast-changing data; pushes revocations |
| Decision signing | off-chain Threshold Signer | M-of-N quorum; chain verifies one `ecrecover` |
| Standards messaging | off-chain Orchestrator | Emits ISO 20022 (`pacs.002`, `camt.054`) + IVMS101 |

## Two paths to a KYC + sanctions decision

- **Cold** — caller supplies a SWIFT-signed `OPERATION_BOUND` attestation as `evidence`.
  The verifier does one `ecrecover`, checks the trusted-issuer set, time window and
  subject binding, and burns a one-shot nonce. Higher gas; needed before a standing claim
  exists.
- **Hot** — the orchestrator has published a `PARTY_STANDING` claim into `ClaimCache`.
  The decision is a couple of storage reads. Far cheaper, reusable in-window.

A live freeze or a revoked claim denies under deny-overrides regardless of any attestation
presented — live on-chain state always wins.

## The wallet→BIC binding (the one new primitive)

An institution that holds KYC in the SWIFT KYC Registry signs an assertion that an on-chain
identity is controlled by its BIC. The orchestrator publishes that as a `StandingClaim` in
`ClaimCache`: `walletRef → BIC → vetted institution`, backed by the registry record hash.
This is how institutional KYC becomes an on-chain claim **without putting PII on chain** —
the record carries a BIC and hashes only. Deanonymisation is institution-level by design,
never wallet-level.

The binding has a full lifecycle, kept deliberately separate from the screened standing it
backs (invariant I9). The standing is a transient screening result that a re-screen refreshes;
the binding is the institution's identity assertion, and it can fail for reasons screening
never sees — the institution is offboarded, its 3SKey/PKI credential is revoked, or it loses
key control. `ClaimCache.revokeBinding` is therefore a **sticky** kill: the PDP denies `BND13`
for any leg of a revoked binding (hot *and* cold path, dominating like a freeze), and a
re-screen — which would re-publish standing — **cannot** resurrect it. Only a governed
`rebind` (the institution re-signing at a strictly higher `bindingEpoch`) clears it. This
closes the binding-revocation gap in the one new primitive, and is the deliberate mirror of
the epoch-freshness path: there a re-screen *heals* a stale clear; here it must not.

## Epoch-bound freshness (I3) — the centrepiece

A cached/attested "clear" carries the **sanctions-list epoch** it was screened at. The PIP
`ListRegistry` holds a single monotonic `listEpoch` counter that doubles as the network-wide
freshness **floor**. A clear is usable only while `stampedEpoch ≥ listEpoch`.

When the Sanctions List Monitor reports a change, the orchestrator fires **one** on-chain
`advanceListEpoch` transaction. The floor rises; every clearance stamped at the prior epoch
is now stale and is forced back to a re-screen (`STL08`) — with no expiry timer and no
per-party message. One write invalidates every stale clearance on the network. A re-screen
re-publishes standing at the new epoch and clearances go green again. `registryEpoch` is the
analogous floor for KYC-registry standing.

## Asset-agnostic by configuration

The engine is fixed; the ruleset is data. `RuleRegistry` holds one `Policy` per asset class
with an active-rule bitmap. The **bond** class runs the full MiFID security-token ruleset;
the **deposit** class uses a policy whose bitmap omits the holder-cap and lock-up bits. The
same `ControlFunction.evaluate` produces a different (smaller) trace for deposit — no engine
change, only the policy the request points at. `test_I8` and demo step 6 prove the same
request flips behaviour purely by swapping the policy.
