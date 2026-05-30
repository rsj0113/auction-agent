"""
[설계 초안 — 구현 전 확인 필요]

헤르메스 → 에이더 간 태스크 전달 채널.
파일시스템 기반 IPC: agent_inbox/aider/ 에 JSON 태스크 파일을 드롭하면
Aider가 watchdog으로 감지해 자동 처리하는 구조.

사용 전 결정 필요:
  1. Aider의 --watch 플래그 또는 외부 watchdog 스크립트 중 어느 쪽을 쓸지
  2. Aider가 커밋할 브랜치 격리 규칙 (main 직접 커밋 금지 — night/dev 브랜치 전용)
  3. 야간 루프 최대 반복 횟수·비용 상한 설정

현재 이 파일은 헤르메스 에이전트가 태스크를 드롭할 때 쓰는 헬퍼만 구현한다.
Aider 쪽 리시버는 Aider CLI + 외부 스크립트로 처리 예정.
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

_PROJECT_ROOT = Path(__file__).parent.parent
_HERMES_INBOX = _PROJECT_ROOT / "agent_inbox" / "hermes"
_AIDER_INBOX  = _PROJECT_ROOT / "agent_inbox" / "aider"

TaskPriority = Literal["critical", "high", "normal"]


def drop_aider_task(
    title: str,
    description: str,
    error_log_path: Optional[str] = None,
    priority: TaskPriority = "normal",
    test_command: str = "python -m pytest tests/ -v",
) -> Path:
    """
    헤르메스가 에이더에게 디버깅 태스크를 전달할 때 호출한다.

    Args:
        title:           태스크 요약 (한 줄)
        description:     에러 상황 상세 설명 및 수정 지시
        error_log_path:  관련 에러 로그 파일 경로 (있으면 Aider가 읽어 맥락 파악)
        priority:        "critical" | "high" | "normal"
        test_command:    Aider가 성공 판정에 쓸 pytest 명령

    Returns:
        생성된 태스크 파일 경로
    """
    task_id = uuid.uuid4().hex[:8]
    task = {
        "task_id": task_id,
        "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "priority": priority,
        "title": title,
        "description": description,
        "error_log_path": error_log_path,
        "test_command": test_command,
        "status": "pending",
    }

    _AIDER_INBOX.mkdir(parents=True, exist_ok=True)
    task_file = _AIDER_INBOX / f"task_{task_id}.json"
    task_file.write_text(json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8")
    return task_file


def drop_hermes_report(
    event_type: Literal["crawl_blocked", "parse_error", "api_error", "daily_summary"],
    message: str,
    context: Optional[dict] = None,
) -> Path:
    """
    크롤러/분석기가 헤르메스에게 이벤트를 리포팅할 때 호출한다.
    헤르메스는 이 파일을 폴링해 슬랙 #ops-hermes에 포워딩한다.

    실제 슬랙 연동은 헤르메스 에이전트가 담당 — 여기서는 파일 드롭만 수행.
    """
    report_id = uuid.uuid4().hex[:8]
    report = {
        "report_id": report_id,
        "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event_type": event_type,
        "message": message,
        "context": context or {},
        "read": False,
    }

    _HERMES_INBOX.mkdir(parents=True, exist_ok=True)
    report_file = _HERMES_INBOX / f"report_{report_id}.json"
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_file
