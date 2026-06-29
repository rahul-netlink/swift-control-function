# syntax=docker/dockerfile:1

# One image for the whole stack. It carries both toolchains the demo needs:
#   - Node 20  → the SWIFT services (tsx) and the Vite console
#   - Foundry  → anvil (the dev chain) and forge (the deploy)
# Every container in docker-compose.yml runs this same image with a different
# command, so the build happens once and is shared.
FROM node:20-bookworm-slim

# curl + git for the Foundry installer and pnpm; ca-certificates for TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Foundry toolchain — puts anvil, forge and cast on PATH.
ENV PATH="/root/.foundry/bin:${PATH}"
RUN curl -L https://foundry.paradigm.xyz | bash && foundryup

# pnpm via corepack (matches the workspace's package manager).
RUN corepack enable && corepack prepare pnpm@9 --activate

# Caddy — single static binary, the one public front door on Railway's $PORT
# (see scripts/railway-start.sh). linux/amd64; bump arch/version if Railway changes.
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin caddy

WORKDIR /app

# Compile the contracts FIRST, off only the contracts/ tree. via_ir is required
# (the decision core overflows the legacy stack), and that pipeline is slow, so we
# isolate it: this layer is reused on every rebuild that doesn't touch contracts/,
# and the BuildKit cache mount keeps the downloaded solc binary across builds so it
# is never re-fetched. .dockerignore keeps out/cache/broadcast out of the context.
COPY contracts ./contracts
RUN forge build --root contracts

# Install workspace dependencies, then bring in the source. Splitting the COPYs
# lets Docker cache the (slow) install layer across source-only changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services ./services
COPY ui ./ui
RUN pnpm install --frozen-lockfile

COPY . .

# Pre-build the console to static assets (relative /api URLs → same-origin via
# Caddy). Baked at image-build so Railway boots fast; dev compose ignores it and
# runs Vite instead.
RUN VITE_API_URL="" pnpm --filter ui build

EXPOSE 4000 4001 4002 4003 5173 8545

# Railway: one container runs the whole stack behind Caddy on $PORT. The dev
# docker-compose overrides this per-service, so it's Railway-only.
CMD ["bash", "scripts/railway-start.sh"]
