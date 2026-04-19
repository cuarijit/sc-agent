#!/usr/bin/env bash

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-scp-0312:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-scp-0312}"
APP_PORT="${APP_PORT:-8000}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ui-api-rag.yml}"
UI_PORT="${UI_PORT:-5174}"
API_PORT="${API_PORT:-8000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

help_cmd() {
  cat <<'USAGE'
Usage:
  ./docker_ctl.sh init
  ./docker_ctl.sh start [--memory <limit>]
  ./docker_ctl.sh stop
  ./docker_ctl.sh app-up [--build]
  ./docker_ctl.sh app-down
  ./docker_ctl.sh app-ps
  ./docker_ctl.sh app-logs [service]
  ./docker_ctl.sh help

Commands:
  init       Build the legacy single-container Docker image.
  start      Start the legacy single container (uses existing docker-compose.yml).
  stop       Stop / remove the legacy single container.
  app-up     Start the full UI/API stack via $COMPOSE_FILE.
  app-down   Stop the full UI/API stack.
  app-ps     Show service status.
  app-logs   Tail compose logs (optional service name: scp-api or scp-ui).
  help       Show this help message.

Environment overrides:
  IMAGE_NAME   Docker image tag (default: scp-0312:latest)
  CONTAINER_NAME  Legacy container name (default: scp-0312)
  APP_PORT     Legacy host port (default: 8000)
  COMPOSE_FILE Compose file (default: docker-compose.ui-api-rag.yml)
  UI_PORT      Vite dev server host port (default: 5174)
  API_PORT     FastAPI host port (default: 8000)
USAGE
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not installed or not in PATH." >&2
    exit 1
  fi
}

bump_port_if_in_use() {
  local var_name="$1" port_value="$2" max_attempts="${3:-20}"
  local current="$port_value" attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    if ! lsof -i ":$current" >/dev/null 2>&1; then
      printf -v "$var_name" '%s' "$current"
      return 0
    fi
    current=$((current + 1))
    attempt=$((attempt + 1))
  done
  echo "ERROR: could not find a free port near $port_value." >&2
  return 1
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  init)
    require_docker
    cd "$SCRIPT_DIR"
    docker build -t "$IMAGE_NAME" -f backend/Dockerfile .
    ;;
  start)
    require_docker
    cd "$SCRIPT_DIR"
    docker compose up -d
    ;;
  stop)
    require_docker
    cd "$SCRIPT_DIR"
    docker compose down
    ;;
  app-up)
    require_docker
    cd "$SCRIPT_DIR"
    bump_port_if_in_use API_PORT "$API_PORT"
    bump_port_if_in_use UI_PORT "$UI_PORT"
    echo "Starting $COMPOSE_FILE on API_PORT=$API_PORT UI_PORT=$UI_PORT"
    BUILD_FLAG=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --build) BUILD_FLAG="--build" ;;
        *) ;;
      esac
      shift
    done
    API_PORT="$API_PORT" UI_PORT="$UI_PORT" docker compose -f "$COMPOSE_FILE" up -d $BUILD_FLAG
    echo ""
    echo "Backend API: http://localhost:$API_PORT/api/health"
    echo "Frontend UI: http://localhost:$UI_PORT/"
    echo ""
    echo "Bootstrap login: admin / admin123 (also planner/planner, analyst/analyst)"
    echo "Tail logs:       ./docker_ctl.sh app-logs"
    ;;
  app-down)
    require_docker
    cd "$SCRIPT_DIR"
    docker compose -f "$COMPOSE_FILE" down
    ;;
  app-ps)
    require_docker
    cd "$SCRIPT_DIR"
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  app-logs)
    require_docker
    cd "$SCRIPT_DIR"
    if [ $# -gt 0 ]; then
      docker compose -f "$COMPOSE_FILE" logs -f "$1"
    else
      docker compose -f "$COMPOSE_FILE" logs -f
    fi
    ;;
  help|--help|-h)
    help_cmd
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    help_cmd
    exit 1
    ;;
esac
