#!/usr/bin/env python3
"""
Hermes Agent — 24시간 경매 크롤러 운영 모니터.

동작 방식:
  1. logs/events.jsonl 을 30초마다 폴링 (커서 파일로 중복 전송 방지)
  2. agent_inbox/hermes/ 의 리포트 파일 감지
  3. 에러 카테고리별로 Slack #ops-hermes 에 포맷된 메시지 전송
  4. IP_BLOCK / PARSE_ERROR 연속 발생 시 Aider 디버깅 태스크 자동 생성

실행:
  python hermes_agent.py            # 상시 데몬 모드
  python hermes_agent.py --once     # 현재 미전송 이벤트만 처리 후 종료
  python hermes_agent.py --summary  # 오늘 일일 요약 전송 후 종료
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# 경로 상수
# ─────────────────────────────────────────────────────────────────────────────
_ROOT         = Path(__file__).parent
_EVENTS_JSONL = _ROOT / "logs" / "events.jsonl"
_CURSOR_FILE  = _ROOT / "logs" / ".hermes_cursor"
_HERMES_INBOX = _ROOT / "agent_inbox" / "hermes"
_AIDER_INBOX  = _ROOT / "agent_inbox" / "aider"
_DB_FILE      = _ROOT / "auction_db.sqlite"

POLL_INTERVAL = 30   # seconds

# ─────────────────────────────────────────────────────────────────────────────
# Slack 설정
# ─────────────────────────────────────────────────────────────────────────────
WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_HERMES", "")

# 카테고리별 Slack 메시지 색상 및 이모지
_CATEGORY_META = {
    "IP_BLOCK":    {"color": "#E53E3E", "emoji": "🚨", "label": "IP 차단"},
    "PARSE_ERROR": {"color": "#DD6B20", "emoji": "⚠️",  "label": "파싱 오류"},
    "API_ERROR":   {"color": "#D69E2E", "emoji": "🔶",  "label": "API 오류"},
    "TIMEOUT":     {"color": "#718096", "emoji": "⏱️",  "label": "타임아웃"},
    "DB_ERROR":    {"color": "#9F7AEA", "emoji": "🗄️",  "label": "DB 오류"},
    "UNKNOWN":     {"color": "#A0AEC0", "emoji": "❓",  "label": "알 수 없음"},
}

# 이 카테고리가 연속 N회 이상 발생하면 Aider 태스크 자동 생성
_AIDER_TRIGGER = {
    "IP_BLOCK":    2,
    "PARSE_ERROR": 3,
}


# ─────────────────────────────────────────────────────────────────────────────
# Slack 전송
# ─────────────────────────────────────────────────────────────────────────────
def _send_slack(payload: dict) -> bool:
    if not WEBHOOK_URL:
        print("[Hermes] SLACK_WEBHOOK_HERMES 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        return False
    try:
        resp = requests.post(WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"[Hermes] Slack 전송 실패: {e}", file=sys.stderr)
        return False


def _build_event_payload(event: dict) -> dict:
    """단일 에러 이벤트를 Slack Block Kit 페이로드로 변환."""
    cat   = event.get("category", "UNKNOWN")
    meta  = _CATEGORY_META.get(cat, _CATEGORY_META["UNKNOWN"])
    ts    = event.get("ts", "")
    msg   = event.get("message", "")
    ctx   = event.get("context", {})
    exc   = event.get("exc_msg", "")

    ctx_lines = "\n".join(f"• *{k}*: `{v}`" for k, v in ctx.items()) if ctx else ""
    exc_line  = f"\n\n*예외*: `{exc}`" if exc else ""

    attachment_text = ctx_lines + exc_line if (ctx_lines or exc_line) else "추가 정보 없음"

    return {
        "attachments": [{
            "color": meta["color"],
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"{meta['emoji']} *[{meta['label']}]* {msg}",
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*카테고리*\n`{cat}`"},
                        {"type": "mrkdwn", "text": f"*시각 (UTC)*\n`{ts}`"},
                    ]
                },
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": attachment_text}
                },
            ]
        }]
    }


def _build_summary_payload(stats: dict, total: int) -> dict:
    """일일 요약 Slack 페이로드 생성."""
    now_kst = datetime.now().strftime("%Y-%m-%d %H:%M KST")
    lines = []
    for cat, count in sorted(stats.items(), key=lambda x: -x[1]):
        meta = _CATEGORY_META.get(cat, _CATEGORY_META["UNKNOWN"])
        lines.append(f"{meta['emoji']} {meta['label']}: *{count}건*")

    body = "\n".join(lines) if lines else "오류 없음 ✅"

    return {
        "attachments": [{
            "color": "#2B6CB0",
            "blocks": [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "📊 Hermes 일일 운영 리포트"}
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*기준 시각*: {now_kst}\n*총 에러 이벤트*: {total}건\n\n{body}"
                    }
                }
            ]
        }]
    }


# ─────────────────────────────────────────────────────────────────────────────
# 커서 관리 (중복 전송 방지)
# ─────────────────────────────────────────────────────────────────────────────
def _read_cursor() -> int:
    if _CURSOR_FILE.exists():
        try:
            return int(_CURSOR_FILE.read_text().strip())
        except ValueError:
            pass
    return 0


def _write_cursor(offset: int) -> None:
    _CURSOR_FILE.write_text(str(offset))


# ─────────────────────────────────────────────────────────────────────────────
# Aider 태스크 자동 생성
# ─────────────────────────────────────────────────────────────────────────────
def _maybe_create_aider_task(recent_events: list[dict]) -> None:
    """최근 이벤트에서 임계치 이상의 반복 카테고리를 감지해 Aider 태스크를 드롭."""
    counts: dict[str, list[dict]] = defaultdict(list)
    for ev in recent_events:
        counts[ev.get("category", "UNKNOWN")].append(ev)

    for cat, threshold in _AIDER_TRIGGER.items():
        evs = counts.get(cat, [])
        if len(evs) < threshold:
            continue

        import uuid
        task_id = uuid.uuid4().hex[:8]
        sample  = evs[-1]
        task = {
            "task_id":        task_id,
            "created_at":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "priority":       "high" if cat == "IP_BLOCK" else "normal",
            "title":          f"[자동생성] {cat} {len(evs)}회 반복 발생 — 수정 요청",
            "description": (
                f"Hermes가 최근 이벤트에서 *{cat}* 카테고리를 {len(evs)}회 감지했습니다.\n\n"
                f"마지막 에러 메시지: {sample.get('message', '')}\n"
                f"컨텍스트: {json.dumps(sample.get('context', {}), ensure_ascii=False)}\n\n"
                f"logs/events.jsonl 을 참고하여 원인을 파악하고 수정하십시오.\n"
                f"수정 후 아래 테스트 명령이 100% 통과해야 합니다."
            ),
            "error_log_path": str(_EVENTS_JSONL),
            "test_command":   "python -m pytest tests/ -v",
            "status":         "pending",
        }

        _AIDER_INBOX.mkdir(parents=True, exist_ok=True)
        task_file = _AIDER_INBOX / f"task_{task_id}.json"
        task_file.write_text(json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[Hermes] Aider 태스크 생성: {task_file.name}")

        # Slack에도 Aider 태스크 생성 알림
        _send_slack({
            "attachments": [{
                "color": "#E53E3E",
                "blocks": [{
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f"🤖 *Aider 디버깅 태스크 자동 생성*\n"
                            f"카테고리 `{cat}` 이 {len(evs)}회 반복 감지되어 Aider에게 수정을 요청했습니다.\n"
                            f"태스크 ID: `{task_id}`"
                        )
                    }
                }]
            }]
        })


# ─────────────────────────────────────────────────────────────────────────────
# 메인 처리 루프
# ─────────────────────────────────────────────────────────────────────────────
def process_new_events() -> list[dict]:
    """커서 이후의 신규 이벤트를 읽어 Slack으로 전송하고, 처리된 이벤트 목록 반환."""
    if not _EVENTS_JSONL.exists():
        return []

    cursor = _read_cursor()
    new_events: list[dict] = []

    with _EVENTS_JSONL.open("r", encoding="utf-8") as f:
        f.seek(cursor)
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                new_events.append(event)
                _send_slack(_build_event_payload(event))
            except json.JSONDecodeError:
                pass
        new_cursor = f.tell()

    if new_cursor > cursor:
        _write_cursor(new_cursor)

    return new_events


def process_hermes_inbox() -> None:
    """agent_inbox/hermes/ 의 미처리 리포트 파일을 읽고 Slack 전송 후 done/ 로 이동."""
    if not _HERMES_INBOX.exists():
        return

    done_dir = _HERMES_INBOX / "done"
    for report_file in _HERMES_INBOX.glob("report_*.json"):
        try:
            report = json.loads(report_file.read_text(encoding="utf-8"))
            if report.get("read"):
                continue

            event_type = report.get("event_type", "")
            message    = report.get("message", "")
            context    = report.get("context", {})

            payload = {
                "attachments": [{
                    "color": "#2B6CB0",
                    "blocks": [{
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"📬 *[크롤러 리포트]* `{event_type}`\n{message}"
                        }
                    }]
                }]
            }
            if context:
                payload["attachments"][0]["blocks"].append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "\n".join(f"• *{k}*: `{v}`" for k, v in context.items())
                    }
                })

            _send_slack(payload)

            # 처리 완료 표시 후 done/ 으로 이동
            report["read"] = True
            done_dir.mkdir(exist_ok=True)
            (done_dir / report_file.name).write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            report_file.unlink()

        except Exception as e:
            print(f"[Hermes] 리포트 처리 실패 {report_file.name}: {e}", file=sys.stderr)


def send_daily_summary() -> None:
    """오늘 날짜 기준 events.jsonl 을 집계해 일일 요약을 Slack 전송."""
    if not _EVENTS_JSONL.exists():
        _send_slack(_build_summary_payload({}, 0))
        return

    today = datetime.now().strftime("%Y-%m-%d")
    stats: dict[str, int] = defaultdict(int)
    total = 0

    with _EVENTS_JSONL.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                if ev.get("ts", "").startswith(today):
                    stats[ev.get("category", "UNKNOWN")] += 1
                    total += 1
            except json.JSONDecodeError:
                pass

    _send_slack(_build_summary_payload(dict(stats), total))


# ─────────────────────────────────────────────────────────────────────────────
# 엔트리포인트
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes Agent — 경매 크롤러 운영 모니터")
    parser.add_argument("--once",    action="store_true", help="미전송 이벤트 처리 후 종료")
    parser.add_argument("--summary", action="store_true", help="일일 요약 전송 후 종료")
    args = parser.parse_args()

    if not WEBHOOK_URL:
        print("[Hermes] 오류: .env 에 SLACK_WEBHOOK_HERMES 를 설정하세요.")
        sys.exit(1)

    if args.summary:
        send_daily_summary()
        return

    if args.once:
        events = process_new_events()
        process_hermes_inbox()
        _maybe_create_aider_task(events)
        print(f"[Hermes] 처리 완료: {len(events)}개 이벤트")
        return

    # 상시 데몬 모드
    print(f"[Hermes] 데몬 시작 (폴링 간격: {POLL_INTERVAL}초) — Ctrl+C 로 종료")
    _send_slack({
        "text": "✅ *Hermes Agent 시작* — 경매 크롤러 모니터링을 시작합니다."
    })

    recent_window: list[dict] = []  # Aider 트리거 판단용 최근 이벤트 버퍼 (최대 20개)

    try:
        while True:
            new_events = process_new_events()
            process_hermes_inbox()

            if new_events:
                recent_window.extend(new_events)
                recent_window = recent_window[-20:]  # 최대 20개 유지
                _maybe_create_aider_task(recent_window)

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\n[Hermes] 종료합니다.")
        _send_slack({"text": "🛑 *Hermes Agent 종료*"})


if __name__ == "__main__":
    main()
