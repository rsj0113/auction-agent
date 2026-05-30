"""
Hermes 에이전트가 모니터링할 수 있는 구조화된 JSON 로깅 시스템.

기존 Rich console.print()를 대체하지 않고 병렬로 동작한다.
에러 이벤트는 logs/events.jsonl (JSONL 포맷)에 머신 리더블로 기록되고,
logs/auction_agent.log에는 사람이 읽기 좋은 텍스트로도 기록된다.
"""

import json
import logging
import re
import sys
from datetime import datetime
from enum import Enum
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, Optional

# 로그 디렉토리는 이 파일 기준 한 단계 위(프로젝트 루트)의 logs/
_PROJECT_ROOT = Path(__file__).parent.parent
_LOGS_DIR = _PROJECT_ROOT / "logs"
_LOGS_DIR.mkdir(exist_ok=True)

_TEXT_LOG_PATH = _LOGS_DIR / "auction_agent.log"
_JSONL_LOG_PATH = _LOGS_DIR / "events.jsonl"


class ErrorCategory(str, Enum):
    IP_BLOCK  = "IP_BLOCK"    # 사이트 접근 차단 또는 봇 탐지
    PARSE_ERROR = "PARSE_ERROR"  # HTML/XHR 파싱 실패
    API_ERROR   = "API_ERROR"    # OpenAI API 오류
    TIMEOUT     = "TIMEOUT"      # 페이지 로드/응답 타임아웃
    DB_ERROR    = "DB_ERROR"     # SQLite 쓰기/읽기 오류
    UNKNOWN     = "UNKNOWN"      # 분류되지 않은 기타 오류


# ─────────────────────────────────────────────────────────────────────────────
# 비밀 마스킹
# ─────────────────────────────────────────────────────────────────────────────
_SECRET_PATTERNS = [
    # OpenAI API 키 형태: sk-... 또는 sk-proj-...
    (re.compile(r'sk-[A-Za-z0-9_-]{20,}'), "sk-***REDACTED***"),
    # 일반 Bearer 토큰
    (re.compile(r'Bearer\s+[A-Za-z0-9_\-\.]{20,}'), "Bearer ***REDACTED***"),
]


def _sanitize(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ─────────────────────────────────────────────────────────────────────────────
# 텍스트 로거 (RotatingFileHandler + StreamHandler)
# ─────────────────────────────────────────────────────────────────────────────
def _build_text_logger() -> logging.Logger:
    logger = logging.getLogger("auction_agent")
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 파일: 최대 5MB × 3개 롤링 (24시간 무인 실행 대비)
    fh = RotatingFileHandler(
        _TEXT_LOG_PATH,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    # 콘솔: WARNING 이상만 (Rich console.print와 중복 방지)
    ch = logging.StreamHandler(sys.stderr)
    ch.setLevel(logging.WARNING)
    ch.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


_text_logger = _build_text_logger()


# ─────────────────────────────────────────────────────────────────────────────
# 공개 API
# ─────────────────────────────────────────────────────────────────────────────
def get_logger() -> logging.Logger:
    """일반 디버그/정보 로그에 사용할 표준 Logger 반환."""
    return _text_logger


def log_error_event(
    category: ErrorCategory,
    message: str,
    context: Optional[Dict[str, Any]] = None,
    exc: Optional[BaseException] = None,
) -> None:
    """
    구조화된 에러 이벤트를 기록한다.

    - logs/auction_agent.log : 텍스트 (사람용)
    - logs/events.jsonl      : JSONL (Hermes 머신 파싱용)

    Args:
        category: ErrorCategory 열거값
        message:  에러 요약 (secrets 자동 마스킹)
        context:  추가 키-값 (법원명, 사건번호, HTTP 상태코드 등)
        exc:      발생한 예외 인스턴스 (있으면 traceback 기록)
    """
    safe_message = _sanitize(message)
    safe_context: Dict[str, Any] = {}
    if context:
        for k, v in context.items():
            safe_context[k] = _sanitize(str(v)) if isinstance(v, str) else v

    # 텍스트 로그
    log_line = f"[{category}] {safe_message}"
    if safe_context:
        log_line += f" | ctx={json.dumps(safe_context, ensure_ascii=False)}"
    _text_logger.error(log_line, exc_info=exc if exc else False)

    # JSONL 이벤트 (Hermes가 tail -f 또는 watchdog으로 읽는 파일)
    event: Dict[str, Any] = {
        "ts": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "category": category.value,
        "message": safe_message,
        "context": safe_context,
    }
    if exc:
        event["exc_type"] = type(exc).__name__
        event["exc_msg"] = _sanitize(str(exc))

    try:
        with _JSONL_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        _text_logger.warning("events.jsonl 쓰기 실패 — 디스크 권한 확인 필요")


def _classify_exception(exc: Exception) -> ErrorCategory:
    """
    예외 메시지에서 ErrorCategory를 추론하는 내부 헬퍼.
    auto_crawling.py의 except 블록에서 category를 명시하기 어려울 때 사용.
    """
    msg = str(exc).lower()
    if any(k in msg for k in ["timeout", "time out", "타임아웃"]):
        return ErrorCategory.TIMEOUT
    if any(k in msg for k in ["block", "차단", "403", "captcha", "robot", "접근"]):
        return ErrorCategory.IP_BLOCK
    if any(k in msg for k in ["parse", "파싱", "iframe", "frame", "select", "json"]):
        return ErrorCategory.PARSE_ERROR
    if any(k in msg for k in ["openai", "api", "key", "rate limit", "quota"]):
        return ErrorCategory.API_ERROR
    return ErrorCategory.UNKNOWN
