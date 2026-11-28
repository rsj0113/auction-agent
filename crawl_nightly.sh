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

# 일반 매물: 수도권(서울·경기·인천) 종류별(아파트:0201, 오피스텔:0205, 다세대/빌라:0204) 각 법원당 최대 150개씩 수집
# (auto_crawling.py는 case_number 기준 ON CONFLICT DO UPDATE라 중복이 쌓이지 않음)
for region in "서울" "경기" "인천"; do
    for ptype in "0201" "0205" "0204"; do
        echo "[$region] 종류: $ptype (최대 150개) - $(date '+%H:%M:%S')" >> "$LOG"
        $PYTHON auto_crawling.py --region "$region" --property-type "$ptype" --max-items 150 >> "$LOG" 2>&1 || echo "[경고] $region $ptype 수집 중 일부 오류 발생 (계속 진행)" >> "$LOG"
    done
done

# 상가(0203): 수도권(서울·경기·인천) 법원당 최대 200개씩 수집
# 성남지원처럼 진행 중인 상가 물건이 150건을 넘는 법원에서 12월 기일 물건(예: 대장동 클라우드베이6 2025타경52448)이
# 기존 50개 한도에 잘리던 문제를 해결. 무제한(9999) 호출은 토큰/시간 과소모가 커서 200개로 상한을 둔다.
for region in "서울" "경기" "인천"; do
    echo "[$region] 상가(0203) 수집 (최대 200개) - $(date '+%H:%M:%S')" >> "$LOG"
    $PYTHON auto_crawling.py --region "$region" --property-type "0203" --max-items 200 >> "$LOG" 2>&1 || echo "[경고] $region 0203 수집 중 일부 오류 발생 (계속 진행)" >> "$LOG"
done

# 네이버 부동산 상가 실매물(D02/D04) 정기 수집 및 시세 매칭 업데이트
echo "[네이버 상가] $(date '+%H:%M:%S') 성남·서울·경기 주요 상권 상가 실매물 수집 시작" >> "$LOG"
$PYTHON -c "from naver_land_scraper import run; run(max_pages=3, headless=True)" >> "$LOG" 2>&1 || echo "[경고] 네이버 상가 수집 일부 오류 (계속 진행)" >> "$LOG"

# 네이버 부동산 주거·오피스텔·빌라·상가 전월세 시세 보강 (수익률 커버리지 확대)
echo "[전월세 보강] $(date '+%H:%M:%S') 수도권 핵심 법정동 전월세 실매물 수집 시작" >> "$LOG"
$PYTHON core/naver_rent_enricher.py --districts 35 --pages 2 >> "$LOG" 2>&1 || echo "[경고] 전월세 보강 일부 오류 (계속 진행)" >> "$LOG"

# 온비드(KAMCO) 공매 상가/부동산 공공데이터 OpenAPI 정기 수집 (유형별 5페이지 확대)
echo "[온비드 공매] $(date '+%H:%M:%S') 온비드 차세대 부동산 OpenAPI 물건 수집 시작" >> "$LOG"
$PYTHON core/onbid_api_scraper.py --pages 5 >> "$LOG" 2>&1 || echo "[경고] 온비드 공매 수집 일부 오류 (계속 진행)" >> "$LOG"

echo "[시세 매칭] $(date '+%H:%M:%S') 경매 물건 ↔ 네이버 상가/빌라 시세 및 안전마진 재계산" >> "$LOG"
$PYTHON core/market_matcher.py >> "$LOG" 2>&1 || echo "[경고] 시세 매칭 일부 오류 (계속 진행)" >> "$LOG"

echo "[낙찰 결과 최신화 - 온비드] $(date '+%H:%M:%S') 온비드 공매 실제 개찰결과 API 최신화" >> "$LOG"
$PYTHON core/onbid_results.py --days 7 >> "$LOG" 2>&1 || echo "[경고] 온비드 낙찰결과 일부 오류 (계속 진행)" >> "$LOG"

echo "[낙찰 결과 최신화 - 대법원] $(date '+%H:%M:%S') 수도권 주요 법원 실제 매각결과(낙찰) 크롤링 수집" >> "$LOG"
$PYTHON core/court_results_scraper.py --courts "서울중앙지방법원,성남지원,수원지방법원,인천지방법원,고양지원,안양지원,부천지원" --max-pages 2 >> "$LOG" 2>&1 || echo "[경고] 대법원 낙찰결과 일부 오류 (계속 진행)" >> "$LOG"

echo "[정리] $(date '+%H:%M:%S') 30일 이상 지난 만료/종결 매물 안전 정리" >> "$LOG"
$PYTHON cleanup_db.py --days 30 >> "$LOG" 2>&1 || echo "[경고] DB 정리 일부 오류 (계속 진행)" >> "$LOG"

# 3. 모바일 앱·웹 피드 재생성 → 변경분 git commit/push → mobile/ (easy-auction-web) Vercel 프로덕션 자동 재배포
echo "[모바일 피드] $(date '+%H:%M:%S') export_mobile_feed.py 실행" >> "$LOG"
$PYTHON export_mobile_feed.py >> "$LOG" 2>&1

FEED_CHANGED="$(git status --porcelain mobile_feed.json mobile/assets/mobile_feed.json || true)"
if [[ -n "$FEED_CHANGED" ]]; then
    echo "[Git] $(date '+%H:%M:%S') 모바일 피드 변경 감지 → 커밋 및 푸시" >> "$LOG"
    git add mobile_feed.json mobile/assets/mobile_feed.json >> "$LOG" 2>&1
    git commit -m "chore(feed): 야간 정기 크롤링 모바일 피드 자동 갱신 ($(date '+%Y-%m-%d %H:%M'))" >> "$LOG" 2>&1 || true
    git push origin main >> "$LOG" 2>&1 || echo "[경고] git push 실패 (로컬 커밋 유지)" >> "$LOG"
else
    echo "[Git] $(date '+%H:%M:%S') 모바일 피드 변경분 없음 (커밋 스킵)" >> "$LOG"
fi

if [[ -n "$FEED_CHANGED" || "${1:-}" == "--force" ]]; then
    if [[ -f "$SCRIPT_DIR/mobile/.vercel/project.json" ]] && grep -q "easy-auction-web" "$SCRIPT_DIR/mobile/.vercel/project.json"; then
        echo "[Vercel] $(date '+%H:%M:%S') mobile/ (easy-auction-web) 프로덕션 재배포 시작" >> "$LOG"
        export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
        if [[ -s "$NVM_DIR/nvm.sh" ]]; then
            # shellcheck disable=SC1090
            source "$NVM_DIR/nvm.sh"
            nvm use 22 >> "$LOG" 2>&1 || true
        fi
        (
            cd "$SCRIPT_DIR/mobile"
            npx vercel --prod --yes >> "$LOG" 2>&1
        ) || echo "[경고] easy-auction-web Vercel 재배포 실패" >> "$LOG"
    else
        echo "[경고] mobile/.vercel/project.json(easy-auction-web) 미확인으로 배포 스킵" >> "$LOG"
    fi
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료 ===" >> "$LOG"
