#!/usr/bin/env bash
# UAT supervisor — runs the whole stack natively (no docker) on one container.
#
#   scripts/manage.sh start      # boot chain → deploy → services → console (background)
#   scripts/manage.sh stop       # stop everything
#   scripts/manage.sh restart    # rotate: stop, archive logs, start fresh
#   scripts/manage.sh status     # pid + health for each process
#   scripts/manage.sh logs [svc] # tail logs (all, or one: anvil|signer|registry|screening|orchestrator|ui)
#
# Everything binds 127.0.0.1 inside this container (defaults match fixtures/dev-keys).
# The browser reaches the API directly at :4000 — override the host it sees with:
#   VITE_API_URL=http://uat-host:4000 scripts/manage.sh start
# CHAIN=anvil (default) or point at an external node with RPC_URL=... CHAIN=external.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RUN_DIR="$ROOT/.uat"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

# Foundry (anvil/forge/cast) on PATH for this container.
[ -d "$HOME/.foundry/bin" ] && PATH="$HOME/.foundry/bin:$PATH"

export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:4000}"
CHAIN="${CHAIN:-anvil}"

# name | health-url ("" = no http check, use cast). Boot order top→bottom.
HEALTH_signer="http://127.0.0.1:4001/health"
HEALTH_registry="http://127.0.0.1:4002/health"
HEALTH_screening="http://127.0.0.1:4003/health"
HEALTH_orchestrator="http://127.0.0.1:4000/api/health"
HEALTH_ui="http://127.0.0.1:5173"
DAEMONS="signer registry screening orchestrator ui"

# --- process helpers --------------------------------------------------------
# setsid → child is its own process-group leader (pid == pgid), so we can kill
# the whole tree (pnpm → tsx → node) with one signal to -pid.
spawn() {
  local name=$1; shift
  setsid "$@" >>"$LOG_DIR/$name.log" 2>&1 </dev/null &
  echo $! >"$PID_DIR/$name.pid"
}

pid_of() { [ -f "$PID_DIR/$1.pid" ] && cat "$PID_DIR/$1.pid" || echo ""; }
alive()  { local p; p=$(pid_of "$1"); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

kill_proc() {
  local name=$1 p; p=$(pid_of "$name")
  [ -z "$p" ] && return 0
  if kill -0 "$p" 2>/dev/null; then
    kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "-$p" 2>/dev/null || true
  fi
  rm -f "$PID_DIR/$name.pid"
}

wait_http() {  # name url
  for _ in $(seq 1 100); do
    curl -fsS "$2" >/dev/null 2>&1 && return 0
    alive "$1" || { echo "  $1 died on boot — see $LOG_DIR/$1.log" >&2; return 1; }
    sleep 0.4
  done
  echo "  timed out waiting for $1 ($2)" >&2; return 1
}

# --- commands ---------------------------------------------------------------
cmd_start() {
  if alive orchestrator; then echo "already running (orchestrator up). use restart."; exit 0; fi

  if [ "$CHAIN" = anvil ]; then
    echo "starting anvil…"; spawn anvil anvil --silent
    for _ in $(seq 1 50); do cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 && break; sleep 0.3; done
  else
    echo "using external chain at $RPC_URL"
  fi

  echo "deploying control function…"
  node scripts/deploy.mjs >>"$LOG_DIR/deploy.log" 2>&1

  echo "starting services…"
  spawn signer    pnpm exec tsx services/signer/src/index.ts
  spawn registry  pnpm exec tsx services/kyc-registry/src/index.ts
  spawn screening pnpm exec tsx services/screening/src/index.ts
  wait_http signer    "$HEALTH_signer"
  wait_http registry  "$HEALTH_registry"
  wait_http screening "$HEALTH_screening"

  spawn orchestrator pnpm exec tsx services/orchestrator/src/index.ts
  wait_http orchestrator "$HEALTH_orchestrator"

  echo "starting console…"
  spawn ui pnpm --filter ui dev
  wait_http ui "$HEALTH_ui"

  echo "ready. console http://localhost:5173  api $VITE_API_URL"
}

cmd_stop() {
  echo "stopping…"
  for name in ui orchestrator screening registry signer anvil; do kill_proc "$name"; done
}

cmd_restart() {
  cmd_stop
  if ls "$LOG_DIR"/*.log >/dev/null 2>&1; then
    local arc="$LOG_DIR/archive/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$arc"; mv "$LOG_DIR"/*.log "$arc"/
    echo "rotated logs → $arc"
  fi
  cmd_start
}

cmd_status() {
  printf "%-13s %-8s %s\n" SERVICE PID HEALTH
  for name in anvil $DAEMONS; do
    local p hp=""; p=$(pid_of "$name"); eval "hp=\${HEALTH_$name:-}"
    local state="stopped"
    if alive "$name"; then
      state="up($p)"
      [ -n "$hp" ] && { curl -fsS "$hp" >/dev/null 2>&1 && state="$state ok" || state="$state unhealthy"; }
    fi
    printf "%-13s %-8s %s\n" "$name" "${p:--}" "$state"
  done
}

cmd_logs() {
  if [ "${1:-}" ]; then tail -f "$LOG_DIR/$1.log"; else tail -f "$LOG_DIR"/*.log; fi
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart|rotate) cmd_restart ;;
  status)  cmd_status ;;
  logs)    shift; cmd_logs "${1:-}" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs [svc]}" >&2; exit 2 ;;
esac
