#!/usr/bin/env bash
set -euo pipefail

# 1. 시간 가드: crontab이 매시 정각(0 * * * *) 호출하더라도 새벽 3시(03시)에만 실행 (--force 인자 시 예외)
CURRENT_HOUR="$(date '+%H')"
if [[ "${1:-}" != "--force" && "$CURRENT_HOUR" != "03" ]]; then
    exit 0
fi

# 2. 중복 실행 방지 락(PID Lock)
LOCKFILE="/tmp/auction_crawl_nightly.lock"
if [[ -f "$LOCKFILE" ]]; then
    OLD_PID="$(cat "$LOCKFILE" 2>/dev/null || true)"
    if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') 이미 크롤링이 실행 중입니다 (PID: $OLD_PID). 종료합니다. ===" >> "$(cd "$(dirname "$0")" && pwd)/logs/crawl_nightly.log"
        exit 0
    fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

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

# 상가(0203): 법원당 최대 50개씩 수집 (기존 9999개 무제한 호출로 인한 토큰/시간 과소모 방지)
for region in "서울" "경기"; do
    echo "[$region] 상가(0203) 수집 (최대 50개) - $(date '+%H:%M:%S')" >> "$LOG"
    $PYTHON auto_crawling.py --region "$region" --property-type "0203" --max-items 50 >> "$LOG" 2>&1
done

# 네이버 부동산 상가 실매물(D02/D04) 정기 수집 및 시세 매칭 업데이트
echo "[네이버 상가] $(date '+%H:%M:%S') 성남·서울·경기 주요 상권 상가 실매물 수집 시작" >> "$LOG"
$PYTHON -c "from naver_land_scraper import run; run(max_pages=3, headless=True)" >> "$LOG" 2>&1

# 온비드(KAMCO) 공매 상가/근린시설 정기 수집
echo "[온비드 공매] $(date '+%H:%M:%S') 온비드 상가·근린생활시설 공매 매물 수집 시작" >> "$LOG"
$PYTHON onbid_scraper.py >> "$LOG" 2>&1

echo "[시세 매칭] $(date '+%H:%M:%S') 경매 물건 ↔ 네이버 상가/빌라 시세 및 안전마진 재계산" >> "$LOG"
$PYTHON core/market_matcher.py >> "$LOG" 2>&1

echo "[낙찰 결과 최신화] $(date '+%H:%M:%S') 매각기일 경과 매물 마감 및 낙찰 결과 DB 최신화" >> "$LOG"
$PYTHON init_auction_results.py >> "$LOG" 2>&1

echo "[정리] $(date '+%H:%M:%S') 7일 이상 지난 오래된 매물 삭제" >> "$LOG"
$PYTHON cleanup_db.py --days 7 >> "$LOG" 2>&1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료 ===" >> "$LOG"
