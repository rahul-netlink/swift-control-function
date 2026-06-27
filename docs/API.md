# Orchestrator API (UI ↔ backend contract)

The orchestrator (`http://localhost:4000`) is the settlement terminal's backend. It owns the
chain connection, coordinates the simulated SWIFT services + signer, and produces ISO 20022
messages. All responses are JSON. CORS is open.

## Reason-code dictionary

| code | meaning | ISO 20022 status |
|------|---------|------------------|
| `OK00`   | permitted | `ACSC` |
| `BLCK01` | no KYC / wallet→BIC binding (deny by default) | `RJCT` |
| `AML02`  | sanctions hit / screening not clear | `RJCT` |
| `JUR03`  | destination jurisdiction not allowed | `RJCT` |
| `LCK04`  | lock-up period not elapsed | `RJCT` |
| `CAP05`  | holder cap reached | `RJCT` |
| `FRZ06`  | party or holding frozen | `RJCT` |
| `LIM07`  | amount exceeds the per-operation limit | `RJCT` |
| `STL08`  | sanctions-list epoch below floor — re-screen forced | `RJCT` |
| `REG09`  | KYC-registry epoch below floor — re-vet forced | `RJCT` |
| `VEL11`  | rolling-window velocity cap exceeded | `RJCT` |
| `CTP12`  | counterparty category not permitted | `RJCT` |
| `EDD10`  | held for enhanced due diligence (review) | `PDNG` |
| `BND13`  | wallet→BIC binding revoked — sticky, re-bind required | `RJCT` |

## Queries

- `GET /api/health` → `{ ok: true }`
- `GET /api/state` → full demo state: `{ chain, addresses, assetClass, policy, parties[],
  bindings[], sanctions, holderCount, epoch: { list, registry }, monitor }`. Each party carries
  `{ role, ref, name, bic, country, kycValid, sanctioned, frozen,
  binding: { revoked, epoch, reason }, holdings, isHolder,
  claim: { exists, revoked, bic, validUntil, listEpoch, registryEpoch, revocationReason } }`.
  `binding` is the wallet→BIC binding lifecycle (the one new primitive), distinct from the
  screened `claim`: `revoked` is a sticky identity kill (`BND13`) cleared only by a re-bind.
  `monitor` is the Sanctions List Monitor status
  `{ provider, intervalMs, running, lastPollTs, nextPollTs, lastDelta, recent[] }`.
- `GET /api/scenario` → `fixtures/scenario.json`.
- `GET /api/events` → **SSE** stream; each frame is
  `{ ts, source, type, message, data? }` (sources: `chain`, `registry`, `screening`,
  `signer`, `orchestrator`).
- `GET /api/policy/catalog` → the maskable rule catalogue `{ rules[], gate }` the policy
  builder uses to compose a ruleset.
- `GET /api/monitor` → the Sanctions List Monitor status (same shape as `state.monitor`).

## Settlement

- `POST /api/transfer` — body `{ from, to, amount, asset: "erc20"|"erc3643"|"ledger",
  assetClass?: "bond"|"deposit"|"equity"|"fund", path: "auto"|"cold"|"hot",
  evidence?: "normal"|"expired"|"replay" }`. `assetClass` sets the active instrument for the
  transfer; `asset` is the settlement rail (the `ledger` rail enforces-and-consumes the decision
  on-chain and projects the book-entry off-EVM — no token moves). Settles on PERMIT, and returns the
  full `TransferResult`: `{ decisionId, status, decision, request, route, path, gas, agnosticism,
  trace[], iso20022, txHash, settled, hashes, validUntil, quorum }`. `agnosticism` is the
  asset-agnostic proof — `{ representations[], identical }`, the same decision screened through a
  fungible token, a permissioned security token and a non-token book-entry ledger. The `trace` is the ordered
  pipeline with each step tagged on-chain / off-chain / hybrid and its gas or latency.

## Policy engine (PAP — author & publish)

- `POST /api/policy/publish` — body `{ version, activeRules[], maxHolders, lockupEnd,
  eddFloor, bands[], jurisdictions[], categories[], velocity }`. Writes the full ruleset to
  the on-chain `RuleRegistry` (`upsertPolicy` + `setBands` + `setJurisdictionRule` +
  `setCategoryRule`) for the active asset class and mirrors it into the live policy data.
  Returns `{ ok, version, policyId, ruleMask, gasUsed, txHash }`. The PDP reads the
  RuleRegistry directly, so the next decision is evaluated under the published policy.
- `POST /api/asset` — body `{ assetClass: "bond"|"deposit"|"equity"|"fund" }`; swaps the active
  policy; `{ ok, assetClass }`.
- `POST /api/seed` / `POST /api/reset` — re-seed / clean-slate; both return `/api/state`.

## Party controls (operator)

Each resolves the party by `role` (or institutional ref) and refreshes on-chain state.

- `POST /api/party/freeze` / `POST /api/party/unfreeze` — body `{ role }`; flips the on-chain
  freeze flag (`FRZ06`). `{ ok, role, frozen }`.
- `POST /api/party/sanction` / `POST /api/party/delist` — body `{ role }`; injects a sanctions
  feed delta, advances the on-chain list epoch and dispatches the differential re-screen (a
  sanctioned party then denies `AML02`). `{ ok, role, sanctioned, listEpoch }`.
- `POST /api/party/offboard` — body `{ role }`; revokes the wallet→BIC binding itself (the one
  new primitive). A **sticky** identity kill (`BND13`) that survives the differential re-screen —
  distinct from a sanction/freeze. `{ ok, role, bindingRevoked: true }`.
- `POST /api/party/rebind` — body `{ role }`; the governed re-bind — the institution re-signs at
  a strictly higher binding epoch, the only thing that clears a revocation. `{ ok, role, bindingEpoch }`.

## Sanctions List Monitor (automatic re-screening)

Re-screening is **automatic** — there is no manual "re-screen" or "advance epoch" button. A
background monitor polls an upstream consolidated feed (`fixtures/sanctions-feed.json`); on a
delta it fires one on-chain `advanceListEpoch` (invalidating every stale clearance at once —
invariant I3) and the screening utility re-screens the network: clean parties refresh at the
new epoch, matches are revoked (`AML02`).

- `POST /api/monitor/poll` — drive one poll deterministically (used by automation/tests, not
  the UI). With no body it advances the scripted feed cursor; with `{ action: "add"|"remove",
  role, entity?, program? }` it injects a specific upstream delta. Returns
  `{ changed, action, listEpoch? }`.

The monitor's poll interval is feed-driven; set `SANCTIONS_POLL_MS` to override it (tests pin
it long and drive deltas via `/api/monitor/poll`).
