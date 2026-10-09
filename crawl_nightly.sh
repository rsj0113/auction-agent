#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="/Users/seonjin/.pyenv/versions/3.11.14/bin/python3"
LOG="$SCRIPT_DIR/logs/crawl_nightly.log"

cd "$SCRIPT_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 맞춤형 정기 크롤링 시작 ===" >> "$LOG"

# 일반 매물: 종류별(아파트:0201, 오피스텔:0205, 다세대/빌라:0204)로 각 법원당 20개씩 수집
for region in "서울" "경기"; do
    for ptype in "0201" "0205" "0204"; do
        echo "[$region] 종류: $ptype (최대 20개) - $(date '+%H:%M:%S')" >> "$LOG"
        $PYTHON auto_crawling.py --region "$region" --property-type "$ptype" --max-items 20 >> "$LOG" 2>&1
    done
done

# 상가(0203): 살아있는 전체 매물 수집 (max-items 9999)
for region in "서울" "경기"; do
    echo "[$region] 상가(0203) 전체 수집 - $(date '+%H:%M:%S')" >> "$LOG"
    $PYTHON auto_crawling.py --region "$region" --property-type "0203" --max-items 9999 >> "$LOG" 2>&1
done

echo "[정리] $(date '+%H:%M:%S') 3일 이상 지난 오래된 매물 삭제" >> "$LOG"
$PYTHON cleanup_db.py --days 3 >> "$LOG" 2>&1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료 ===" >> "$LOG"
