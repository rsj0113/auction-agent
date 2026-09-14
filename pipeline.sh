#!/usr/bin/env bash
# 파이프라인 시작/종료/상태 확인 스크립트
# 사용법:
#   ./pipeline.sh start    — Hermes + Aider Watchdog 데몬 시작
#   ./pipeline.sh stop     — 두 데몬 종료
#   ./pipeline.sh status   — 실행 여부 확인
#   ./pipeline.sh logs     — 최근 로그 출력
#   ./pipeline.sh summary  — Hermes 일일 요약을 Slack에 전송

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"
mkdir -p "$PID_DIR"

HERMES_PID="$PID_DIR/hermes.pid"
AIDER_PID="$PID_DIR/aider_watchdog.pid"

_is_running() {
    local pid_file="$1"
    [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

cmd_start() {
    if _is_running "$HERMES_PID"; then
        echo "[pipeline] Hermes 이미 실행 중 (PID $(cat "$HERMES_PID"))"
    else
        python -u "$SCRIPT_DIR/hermes_agent.py" >> "$SCRIPT_DIR/logs/hermes.log" 2>&1 &
        echo $! > "$HERMES_PID"
        echo "[pipeline] Hermes 시작 (PID $!)"
    fi

    if _is_running "$AIDER_PID"; then
        echo "[pipeline] Aider Watchdog 이미 실행 중 (PID $(cat "$AIDER_PID"))"
    else
        python -u "$SCRIPT_DIR/aider_watchdog.py" >> "$SCRIPT_DIR/logs/aider.log" 2>&1 &
        echo $! > "$AIDER_PID"
        echo "[pipeline] Aider Watchdog 시작 (PID $!)"
    fi

    echo "[pipeline] 완료. 로그: logs/hermes.log | logs/aider.log"
}

cmd_stop() {
    for entry in hermes:"$HERMES_PID" aider_watchdog:"$AIDER_PID"; do
        name="${entry%%:*}"
        pid_file="${entry##*:}"
        if _is_running "$pid_file"; then
            kill "$(cat "$pid_file")" && echo "[pipeline] $name 종료 (PID $(cat "$pid_file"))"
            rm -f "$pid_file"
        else
            echo "[pipeline] $name 실행 중이 아님"
        fi
    done
}

cmd_status() {
    for entry in hermes:"$HERMES_PID" aider_watchdog:"$AIDER_PID"; do
        name="${entry%%:*}"
        pid_file="${entry##*:}"
        if _is_running "$pid_file"; then
            echo "[pipeline] $name  ✅ 실행 중 (PID $(cat "$pid_file"))"
        else
            echo "[pipeline] $name  ⛔ 정지"
        fi
    done
}

cmd_logs() {
    echo "=== Hermes (최근 30줄) ==="
    tail -30 "$SCRIPT_DIR/logs/hermes.log" 2>/dev/null || echo "(로그 없음)"
    echo ""
    echo "=== Aider Watchdog (최근 30줄) ==="
    tail -30 "$SCRIPT_DIR/logs/aider.log" 2>/dev/null || echo "(로그 없음)"
}

cmd_summary() {
    python "$SCRIPT_DIR/hermes_agent.py" --summary
}

case "${1:-}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    summary) cmd_summary ;;
    *)
        echo "사용법: $0 {start|stop|status|logs|summary}"
        exit 1
        ;;
esac
