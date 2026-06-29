#!/usr/bin/env bash
# Railway entrypoint: boot the whole stack in one container, then hand the single
# public port ($PORT) to Caddy (static console + /api → orchestrator). Railway
# terminates TLS at its edge, so we serve plain HTTP on $PORT.
#
# ponytail: no process supervisor — if a backend daemon dies, Caddy stays up and
# /api starts 502'ing. Fine for a demo; add a supervisor (or Railway healthcheck
# on /api/health) if this ever needs to self-heal.
set -euo pipefail
cd /app
export PATH="/root/.foundry/bin:$PATH"
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

echo "starting anvil…"
anvil --host 0.0.0.0 --silent &
until cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; do sleep 0.3; done

echo "deploying control function…"
node scripts/deploy.mjs

echo "starting services…"
pnpm exec tsx services/signer/src/index.ts &
pnpm exec tsx services/kyc-registry/src/index.ts &
pnpm exec tsx services/screening/src/index.ts &
for hp in 4001/health 4002/health 4003/health; do
  until curl -fsS "http://127.0.0.1:${hp}" >/dev/null 2>&1; do sleep 0.4; done
done

pnpm exec tsx services/orchestrator/src/index.ts &
until curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; do sleep 0.4; done

echo "stack up — handing ${PORT:-8080} to Caddy"
exec caddy run --config /app/infra/Caddyfile.railway --adapter caddyfile
