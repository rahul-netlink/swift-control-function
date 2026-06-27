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

WORKDIR /app

# Compile the contracts FIRST, off only the contracts/ tree. via_ir is required
# (the decision core overflows the legacy stack), and that pipeline is slow, so we
# isolate it: this layer is reused on every rebuild that doesn't touch contracts/,
# and the BuildKit cache mount keeps the downloaded solc binary across builds so it
# is never re-fetched. .dockerignore keeps out/cache/broadcast out of the context.
COPY contracts ./contracts
RUN --mount=type=cache,target=/root/.svm \
    forge build --root contracts

# Install workspace dependencies, then bring in the source. Splitting the COPYs
# lets Docker cache the (slow) install layer across source-only changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services ./services
COPY ui ./ui
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 4000 4001 4002 4003 5173 8545
