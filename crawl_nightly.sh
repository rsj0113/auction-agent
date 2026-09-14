#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="/Users/seonjin/.pyenv/versions/3.11.14/bin/python3"
LOG="$SCRIPT_DIR/logs/crawl_nightly.log"

cd "$SCRIPT_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 야간 크롤링 시작 ===" >> "$LOG"

echo "[서울] $(date '+%H:%M:%S')" >> "$LOG"
$PYTHON auto_crawling.py --region 서울 --max-items 50 >> "$LOG" 2>&1

echo "[경기] $(date '+%H:%M:%S')" >> "$LOG"
$PYTHON auto_crawling.py --region 경기 --max-items 50 >> "$LOG" 2>&1

echo "[정리] $(date '+%H:%M:%S') 3일 이상 지난 오래된 매물 삭제" >> "$LOG"
$PYTHON cleanup_db.py --days 3 >> "$LOG" 2>&1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료 ===" >> "$LOG"
