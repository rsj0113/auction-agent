#!/usr/bin/env python3
"""
Aider Watchdog — 야간 자동 디버깅 에이전트.

동작 방식:
  1. agent_inbox/aider/ 를 60초마다 폴링
  2. task_*.json 파일 발견 시 Aider 실행
  3. pytest 100% 통과할 때까지 최대 MAX_ITER 회 반복
  4. 성공 시 night/dev 브랜치에 자동 커밋 (main 커밋 금지)
  5. 완료된 태스크는 agent_inbox/aider/done/ 으로 이동

실행:
  python aider_watchdog.py            # 상시 데몬 모드
  python aider_watchdog.py --once     # 대기 중인 태스크 1개 처리 후 종료

환경변수 (.env):
  AIDER_MODEL   Aider가 사용할 모델 (기본: gpt-4o-mini)
  OPENAI_API_KEY
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────
_ROOT        = Path(__file__).parent
_AIDER_INBOX = _ROOT / "agent_inbox" / "aider"
_DONE_DIR    = _AIDER_INBOX / "done"
_RESULT_LOG  = _ROOT / "logs" / "aider_results.jsonl"

NIGHT_BRANCH  = "night/dev"
MAX_ITER      = 10       # 태스크당 최대 Aider 재시도 횟수 (비용 상한)
POLL_INTERVAL = 60       # seconds
AIDER_MODEL   = os.environ.get("AIDER_MODEL", "gpt-4o-mini")
TEST_CMD      = ["python", "-m", "pytest", "tests/", "-v", "--tb=short"]

PROTECTED_BRANCHES = {"main", "master"}


# ─────────────────────────────────────────────────────────────────────────────
# Git 헬퍼
# ─────────────────────────────────────────────────────────────────────────────
def _run(cmd: list[str], cwd: Path = _ROOT) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def _current_branch() -> str:
    r = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    return r.stdout.strip()


def _ensure_night_branch() -> bool:
    """night/dev 브랜치가 없으면 생성, 이미 있으면 체크아웃. main이면 거부."""
    current = _current_branch()
    if current in PROTECTED_BRANCHES:
        # main에서는 직접 작업하지 않고 night/dev 체크아웃
        r = _run(["git", "checkout", "-B", NIGHT_BRANCH])
        if r.returncode != 0:
            print(f"[Watchdog] 브랜치 생성 실패: {r.stderr}", file=sys.stderr)
            return False
        print(f"[Watchdog] {NIGHT_BRANCH} 브랜치로 전환")
    elif current != NIGHT_BRANCH:
        r = _run(["git", "checkout", "-B", NIGHT_BRANCH])
        if r.returncode != 0:
            print(f"[Watchdog] 브랜치 전환 실패: {r.stderr}", file=sys.stderr)
            return False
    return True


def _git_commit(task_id: str, task_title: str) -> bool:
    """변경 사항을 night/dev 브랜치에 커밋. main이면 거부."""
    branch = _current_branch()
    if branch in PROTECTED_BRANCHES:
        print(f"[Watchdog] 🚫 {branch} 브랜치 커밋 거부 — night/dev 만 허용", file=sys.stderr)
        return False

    _run(["git", "add", "-A"])
    msg = f"[Aider] {task_title}\n\ntask_id: {task_id}\nCo-Authored-By: Aider <aider@noreply>"
    r = _run(["git", "commit", "-m", msg])
    if r.returncode == 0:
        print(f"[Watchdog] ✅ 커밋 완료 ({branch})")
        return True
    if "nothing to commit" in r.stdout + r.stderr:
        print("[Watchdog] 변경 사항 없음 — 커밋 생략")
        return True
    print(f"[Watchdog] 커밋 실패: {r.stderr}", file=sys.stderr)
    return False


# ─────────────────────────────────────────────────────────────────────────────
# 테스트 실행
# ─────────────────────────────────────────────────────────────────────────────
def _run_tests() -> tuple[bool, str]:
    """pytest 실행. (통과 여부, 출력 텍스트) 반환."""
    r = subprocess.run(TEST_CMD, cwd=_ROOT, capture_output=True, text=True)
    output = r.stdout + r.stderr
    passed = r.returncode == 0
    return passed, output


# ─────────────────────────────────────────────────────────────────────────────
# Aider 실행
# ─────────────────────────────────────────────────────────────────────────────
def _run_aider(message: str, error_context: str = "") -> bool:
    """Aider를 non-interactive 모드로 실행. 성공 여부 반환."""
    full_message = message
    if error_context:
        full_message += f"\n\n[테스트 실패 로그]\n{error_context[-3000:]}"  # 마지막 3000자

    cmd = [
        "aider",
        "--yes",                      # 모든 확인 자동 승인
        "--no-auto-commits",          # 커밋은 watchdog이 직접 제어
        "--model", AIDER_MODEL,
        "--message", full_message,
    ]

    print(f"[Watchdog] Aider 실행 중 (모델: {AIDER_MODEL})...")
    r = subprocess.run(cmd, cwd=_ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[Watchdog] Aider 오류:\n{r.stderr[-1000:]}", file=sys.stderr)
        return False
    return True


# ─────────────────────────────────────────────────────────────────────────────
# 결과 로깅
# ─────────────────────────────────────────────────────────────────────────────
def _log_result(task_id: str, success: bool, iterations: int, reason: str) -> None:
    entry = {
        "ts":         datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "task_id":    task_id,
        "success":    success,
        "iterations": iterations,
        "reason":     reason,
    }
    with _RESULT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# 태스크 처리
# ─────────────────────────────────────────────────────────────────────────────
def process_task(task_file: Path) -> None:
    task = json.loads(task_file.read_text(encoding="utf-8"))
    task_id    = task.get("task_id", "unknown")
    title      = task.get("title", "무제 태스크")
    desc       = task.get("description", "")
    test_cmd   = task.get("test_command", "python -m pytest tests/ -v")
    priority   = task.get("priority", "normal")

    print(f"\n[Watchdog] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"[Watchdog] 태스크 시작: {title}")
    print(f"[Watchdog] ID: {task_id} | 우선순위: {priority}")

    if not _ensure_night_branch():
        _log_result(task_id, False, 0, "브랜치 전환 실패")
        return

    # 시작 전 테스트 베이스라인 확인
    passed, output = _run_tests()
    if passed:
        print("[Watchdog] ℹ️  이미 테스트 통과 상태 — Aider 실행 생략")
        _move_to_done(task_file, task, success=True)
        _log_result(task_id, True, 0, "이미 통과 상태")
        return

    error_context = output
    for attempt in range(1, MAX_ITER + 1):
        print(f"[Watchdog] 시도 {attempt}/{MAX_ITER}")

        aider_ok = _run_aider(desc, error_context)
        if not aider_ok:
            print(f"[Watchdog] Aider 실패 — 다음 시도")
            time.sleep(5)
            continue

        passed, output = _run_tests()
        if passed:
            print(f"[Watchdog] ✅ 테스트 통과 (시도 {attempt}회)")
            _git_commit(task_id, title)
            _move_to_done(task_file, task, success=True, iterations=attempt)
            _log_result(task_id, True, attempt, "테스트 통과")
            return

        print(f"[Watchdog] ❌ 테스트 실패 — 재시도")
        error_context = output  # 실패 로그를 다음 Aider 호출에 전달

    # MAX_ITER 소진
    print(f"[Watchdog] ⛔ {MAX_ITER}회 시도 후 실패 — 태스크 포기")
    _move_to_done(task_file, task, success=False, iterations=MAX_ITER)
    _log_result(task_id, False, MAX_ITER, f"{MAX_ITER}회 초과")


def _move_to_done(task_file: Path, task: dict,
                  success: bool, iterations: int = 0) -> None:
    _DONE_DIR.mkdir(exist_ok=True)
    task["status"]          = "done" if success else "failed"
    task["completed_at"]    = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    task["final_iterations"] = iterations
    ((_DONE_DIR) / task_file.name).write_text(
        json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    task_file.unlink()


# ─────────────────────────────────────────────────────────────────────────────
# 엔트리포인트
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Aider Watchdog — 야간 자동 디버깅")
    parser.add_argument("--once", action="store_true", help="대기 태스크 1개 처리 후 종료")
    args = parser.parse_args()

    _AIDER_INBOX.mkdir(parents=True, exist_ok=True)
    _DONE_DIR.mkdir(exist_ok=True)

    # Aider 설치 확인
    if subprocess.run(["which", "aider"], capture_output=True).returncode != 0:
        print("[Watchdog] 오류: aider 가 설치되어 있지 않습니다.")
        print("           pip install aider-chat 으로 설치하세요.")
        sys.exit(1)

    if args.once:
        tasks = sorted(_AIDER_INBOX.glob("task_*.json"))
        if not tasks:
            print("[Watchdog] 대기 중인 태스크 없음")
            return
        process_task(tasks[0])
        return

    print(f"[Watchdog] 데몬 시작 (폴링: {POLL_INTERVAL}초, 최대 {MAX_ITER}회/태스크, 브랜치: {NIGHT_BRANCH})")
    try:
        while True:
            tasks = sorted(_AIDER_INBOX.glob("task_*.json"),
                           key=lambda f: json.loads(f.read_text()).get("priority", "normal"))
            if tasks:
                process_task(tasks[0])
            else:
                time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\n[Watchdog] 종료합니다.")


if __name__ == "__main__":
    main()
