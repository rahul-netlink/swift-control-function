# Judging map

How each part answers *"Cracking the control conundrum"* — a reusable, standards-based
control function that works across digital-asset platforms regardless of asset type. The
control function is a **decision component**: given an operation it returns PERMIT/DENY
with a reason code and an evidence commitment. **It never holds or moves value** — the
token does. That separation is the thesis; the code and UI keep the gate and the move
visibly distinct.

## Invariants → test → demo step

Each invariant has exactly one test, named after it, in `contracts/test/Invariants.t.sol`.
`pnpm test` runs the nine; `pnpm conformance` and `pnpm gas` run the two measurement
harnesses.

| Inv | Property | Test | Demo step |
|-----|----------|------|-----------|
| **I1** | Fail-closed / safety — any missing input ⇒ DENY; PERMIT needs every check to pass | `test_I1_failClosed` | 2 (PERMIT reachable) |
| **I2** | Authenticity — attestation accepted only if it recovers to the active SWIFT key (one `ecrecover`) | `test_I2_authenticity` | 2 |
| **I3** | Freshness (epoch floors) — one `advanceListEpoch` invalidates every stale clear | `test_I3_epochFloors` | **3 (centrepiece)** |
| **I4** | Non-replay / domain separation — one-shot nonce; replay + expiry denied | `test_I4_nonReplay` | 2, 7 |
| **I5** | Freeze dominance — a live freeze denies even a fresh, valid clear | `test_I5_freezeDominance` | 3 |
| **I6** | Evidence — every PERMIT commits to a deterministic evidence hash; no PII on-chain | `test_I6_evidence` | 7 |
| **I7** | Asset-agnostic determinism — byte-identical Decision across ERC-20, ERC-3643 and a non-token book-entry ledger | `test_I7_conformance` | 2, 8 |
| **I8** | Quantity correctness + asset-agnostic — holder cap cannot be breached under bond; the same request passes under the deposit policy that omits the cap | `test_I8_holderCapAndAssetAgnostic` | 6, 8 |
| **I9** | Binding revocation — a revoked wallet→BIC binding denies `BND13` (hot + cold), sticky against re-screen; only a governed re-bind restores it | `test_I9_bindingRevocation` | **5** |

## Challenge dimension → where

| Dimension | What we show | Where |
|-----------|--------------|-------|
| **Reusable across asset types** | One `ControlFunction` reached by ERC-20, ERC-3643 and a non-token book-entry ledger; identical `Decision` byte-for-byte; bond / deposit / equity / fund swap changes only `RuleRegistry` data | `ControlFunction.sol`, `test_I7`, `test_I8`, step 6/8 |
| **Standards-based interface** | One stable `IControlFunction` (`evaluate` / `evaluateAndConsume`); rules-as-data | `IControlFunction.sol`, `RuleRegistry.sol` |
| **Reference-model alignment** | Explicit PEP / PDP / PIP / PAP separation, deny-overrides | all `src/`, `ARCHITECTURE.md` |
| **SWIFT-native data** | KYC Registry (BIC-keyed) surfaced on-chain via a signed wallet→BIC binding; Screening + automatic Sanctions List Monitor | `kyc-registry`, `screening`, `monitor.ts`, steps 1,3,4 |
| **Epoch-bound freshness** | One on-chain `advanceListEpoch` invalidates every cached/attested clear network-wide — no expiry timer, no per-party message | `ListRegistry.sol`, `test_I3`, step 3 |
| **Hybrid on/off-chain trust** | Off-chain 2-of-3 threshold-signed attestation (cold) vs on-chain cached claim (hot); chain verifies one `ecrecover` | `signer`, `AttestationVerifier.sol`, `ClaimCache.sol` |
| **Standards messaging** | ISO 20022 `pacs.002` carrying an IVMS101 Travel-Rule payload on every decision | `iso20022`, every transfer |
| **Operational control** | A conditional ruleset authored in the policy engine and published on-chain re-decides the next transfer; an upstream sanctions-feed delta automatically re-screens the network | `policy.ts`, `RuleRegistry.sol`, `monitor.ts`, steps 4,9 |
| **Binding lifecycle** | The one new primitive (wallet→BIC binding) has a sticky on-chain revocation that survives a re-screen; only a governed re-bind restores it | `ClaimCache.sol`, `test_I9`, step 5 |
| **Operator accountability** | Sequencing is committed by a QBFT validator super-majority, not the operator — no unilateral reorder/censor; freeze cannot be out-ordered (deterministic finality) | `whitepaper.tex` §4.4, `test_I5` |
| **Graph confidentiality** | Explicit posture: permissioned ledger hides the graph from the public (not validators); walletRef rotation + Besu privacy groups + ZK on the roadmap | `whitepaper.tex` §5.5 |
| **Efficiency** | Decision-isolated hot ≈ 26k vs cold ≈ 93k gas (binding-liveness adds two reads/leg) | `GasReport.t.sol` (`pnpm gas`) |

## The demo arc = the acceptance test (`scripts/arc-check.mjs`)

The headless `scripts/arc-check.mjs` drives the orchestrator API and asserts each step end to end:

1. **Onboarded** — each party shows `walletRef → BIC → vetted institution`; the on-chain record is BIC + hashes, no PII.
2. **Happy path** — bond transfer PERMITs; settles; schema-valid `pacs.002` + IVMS101 emitted.
3. **Automatic re-screen (centrepiece)** — an upstream sanctions-feed delta fires one `advanceListEpoch`; the cached, signed, unexpired clear goes stale → DENY `STL08`; the screening utility automatically refreshes clean parties at the new epoch → PERMIT again (I3).
4. **Automatic sanctioning** — a feed delta lists a party; the auto re-screen revokes its standing → DENY `AML02`; a delisting delta restores it → PERMIT. No operator button.
5. **Binding revocation (I9)** — offboarding the controlling institution revokes the wallet→BIC binding itself → DENY `BND13`. The kill is *sticky*: a full sanctions-feed re-screen cycle cannot resurrect it (still `BND13`, not `STL08`/`AML02`); only a governed **re-bind** (the institution re-signing at a higher epoch) restores PERMIT. The mirror image of step 3 — there a re-screen heals; here it must not.
6. **Asset-agnostic by configuration** — choose the asset type (bond / deposit / equity / fund) and the settlement rail (ERC-20 fungible, ERC-3643 security token, or non-token book-entry ledger) right in the transfer form; the policy panel changes with the asset type (a deposit drops cap + lock-up, a fund refuses non-eligible-investor counterparties), and every decision carries an asset-agnostic strip confirming the same decision across all three rails.
7. **Evidence / audit** — the decision record exposes decision id, path, per-step gas, and the decomposed evidence hash.
8. **Advanced policy** — a mid-size transfer is HELD for EDD (`EDD10`); an enhanced 3-of-3 attestation clears it; above the top band a hard `LIM07`.
9. **On-chain policy builder** — author a ruleset that blocks a jurisdiction and **Publish** it to the `RuleRegistry`; the next decision DENYs `JUR03`; re-publishing the original restores PERMIT.

`pnpm conformance` separately prints `ASSET-AGNOSTIC CONFORMANCE: PASS (4/4 identical decisions across token + non-token PEPs)` — ERC-20, ERC-3643 and a non-token book-entry ledger.

## Real vs simulated boundary

| Real (actually works) | Simulated (labelled "demo stub") |
|---|---|
| Solidity contracts; deny-overrides engine; EIP-712 verify (one `ecrecover`); nonce + expiry + **epoch-floor** freshness; canonical holder counter; gas + conformance proofs; ISO 20022 + IVMS101 structure | KYC Registry (in-memory, BIC-keyed); Transaction Screening + Sanctions List Monitor; M-of-N quorum (one group key, shows 2-of-3 acks) |
