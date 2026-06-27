# SWIFT Asset Control — Asset-Agnostic Control Function

A reusable, standards-based **control function** for digital-asset platforms: one decision
component, reached through one stable interface (`IControlFunction`), that decides whether an
operation (transfer / mint / burn / freeze) is permitted — independently of the token type.

Built for the **SWIFT Hackathon 2026** technical challenge, *"Cracking the control conundrum."*

## Run it

Foundry, Node 20+, and pnpm are required. One command boots the chain, deploys, starts the
SWIFT services and signer, seeds fixtures, and opens the console:

```bash
pnpm install
pnpm demo          # → console at http://localhost:5173, API at http://localhost:4000
```

Contracts and proofs run on their own:

```bash
pnpm test          # Foundry invariant suite — one test per property I1–I9 (9/9)
pnpm conformance   # ASSET-AGNOSTIC CONFORMANCE: PASS (4/4 identical decisions)
pnpm gas           # decision-isolated hot vs cold gas (≈26k vs ≈93k)
```

To run on Hyperledger Besu (the same EVM family as SWIFT's shared-ledger MVP) instead of the
default anvil node:

```bash
docker compose up -d besu
CHAIN=besu pnpm demo
```

## Reference model

| Role | Responsibility | Component |
|------|----------------|-----------|
| **PEP** — Enforcement | Gate an operation at its call site | `adapters/*` |
| **PDP** — Decision | Combine rules deny-overrides, return a `Decision` | `ControlFunction` |
| **PIP** — Information | Live freeze state, cached standing claims, epoch floors | `FreezeRegistry`, `ClaimCache`, `ListRegistry` |
| **PAP** — Administration | Hold policy as data | `RuleRegistry` |
| Trust anchor | Verify the off-chain SWIFT signer (EIP-712) | `AttestationVerifier` |

The one new primitive is a signed **wallet→BIC binding**: an institution holding KYC in the
SWIFT KYC Registry signs an assertion that an on-chain identity is controlled by its BIC,
publishing institutional KYC as an on-chain claim. The binding has a full lifecycle — a
**sticky revocation** (`BND13`) for an offboarded institution or a revoked credential that a
re-screen cannot undo, cleared only by a governed **re-bind** (invariant I9). See
`docs/ARCHITECTURE.md`.

## The console

The console is an interactive **settlement terminal**. Compose a transfer (debtor, creditor,
asset, amount) and **Submit** — the on-chain control function evaluates it live and the
**evaluation trace** shows every rule it ran (adapter ingest → cache → screening → sign → verify
→ freshness → KYC → sanctions → freeze → jurisdiction → lockup → holder cap → transfer limit →
settlement), each tagged on-chain / off-chain / hybrid with its gas or latency. Click the verdict
for the full decision record (decision id, path, gas breakdown, tx / evidence / request hashes).

The **Policy engine** (a tab on the live-feed card) is an authoring surface, not a read-out:
toggle which rules are active in the on-chain bitmap, set the tiered notional bands that drive
allow / review / deny, and the holder-cap and lock-up gates — then **Publish** to the on-chain
`RuleRegistry` (the PAP). The PDP reads it directly, so the very next decision is evaluated under
the new policy. (The jurisdiction / counterparty matrices, velocity window and EDD floor are still
enforced by the PDP — they live in the registry and ship as fixtures, just not browser-authored.)
The transfer form chooses **what you're sending** — the **asset type** (tokenized bond, deposit,
equity or fund unit) and the **settlement rail** (a fungible ERC-20, a permissioned ERC-3643
security token, or a *non-token* book-entry ledger). The rule set changes with the asset type
(cap and lock-up drop out for a deposit, the fund refuses any non-eligible-investor counterparty),
because policy is data in the `RuleRegistry`, not code; and the same control function decides
identically whichever rail you pick. Every decision carries an asset-agnostic strip showing the
chosen rail and confirming the decision is byte-identical across the others — independence from
token type, not merely from token standard. (The Policy engine can also swap the active class for
authoring.)

The **Sanctions List Monitor** runs the way it does in production: there is no manual button. A
background poller watches an upstream consolidated feed (OFAC SDN / EU CFSP); on a delta it
fires one on-chain `advanceListEpoch` — the centrepiece: every cached, signed, *unexpired*
clearance on the network goes stale at once (`STL08`) with no expiry timer and no per-party
message — and the screening utility automatically re-screens, refreshing clean parties at the
new epoch and revoking matches (`AML02`). Deny-overrides means live state (sanctions, stale
epoch) wins even over a fresh signed attestation.

The same panel exposes the **binding lifecycle** — the one new primitive's full story.
**Offboard** a party to revoke its wallet→BIC binding (`BND13`): unlike a sanction, this kill
is *sticky*, so the automatic re-screen that heals a stale clear cannot resurrect it — the
failure is in the binding, not the screening. Only **Re-bind** (the institution re-signing at a
higher binding epoch) restores standing. It is the deliberate mirror of the sanctions path.

The demo uses a tokenized-bond DvP between **DebtCo** (DE), **FundMgr** (FR), **LuxClear** (LU)
and a new entrant **NewFund**. `node scripts/arc-check.mjs` drives the whole arc headless
(happy path, automatic re-screen, automatic sanctioning, sticky binding revocation + re-bind,
asset swap, tiered/EDD policy, and an on-chain policy publish) and asserts each transition.
Every decision is proven byte-identical across the ERC-20 and ERC-3643 adapters.

## Real vs simulated

| Real | Simulated |
|------|-----------|
| Solidity contracts, deny-overrides engine | KYC Registry (in-memory, BIC-keyed) |
| EIP-712 attestation verification (single `ecrecover`) | Transaction Screening + Sanctions List Monitor |
| Nonce + expiry + **epoch-floor** replay / staleness protection | M-of-N threshold quorum (one group key, 2-of-3 acks) |
| Gas measurements, asset-agnostic conformance | — |
| ISO 20022 structure + IVMS101 (message ids illustrative) | — |

No real value moves; everything runs locally.

## Layout

```
contracts/   Foundry project — the control function and adapters
services/    shared · iso20022 · signer · kyc-registry · screening · orchestrator
ui/          React + Vite + Tailwind console
fixtures/    BICs, wallets, policy, sanctions list, dev keys
docs/        ARCHITECTURE.md · JUDGING_MAP.md · API.md
infra/besu/  Besu dev-node genesis + key
```
