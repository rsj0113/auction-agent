#!/usr/bin/env python3
"""
export_mobile_feed.py

이지경매(EasyAuction) 모바일 앱 MVP용 정적 피드(mobile_feed.json) 생성 스크립트.
- DB(auction_db.sqlite)에서 초보자에게 적합한 서울/수도권 주거용 매물 추출
- 감정가 0원, 최저가 100만원 미만, CLOSED 등 이상치/종결 매물 및 중복 사건번호 자동 제외
- 최저가 1억~6억대 및 유찰 1회 이상 매물 우선 정렬
- 초보자용 요약 필드(headline, safety_grade, gap_amount, summary_bullets) 자동 생성
"""

import os
import sys
import json
import sqlite3
from datetime import datetime, date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "auction_db.sqlite")
OUTPUT_PATH = os.path.join(BASE_DIR, "mobile_feed.json")

def format_krw(val: int) -> str:
    """원 단위를 'X억 Y,YYY만원' 또는 'Y,YYY만원' 문자열로 포맷팅"""
    if not val or val <= 0:
        return "0원"
    
    eok = val // 100_000_000
    man = (val % 100_000_000) // 10_000
    
    if eok > 0 and man > 0:
        return f"{eok}억 {man:,}만원"
    elif eok > 0:
        return f"{eok}억원"
    else:
        return f"{man:,}만원"

def calculate_d_day(auction_date_str: str) -> str:
    """auction_date (YYYYMMDD or YYYY-MM-DD)를 파싱해 D-Day 계산"""
    if not auction_date_str:
        return "기일 미정"
    
    clean_str = auction_date_str.replace("-", "").strip()
    if len(clean_str) < 8:
        return "기일 미정"
    
    try:
        target_date = datetime.strptime(clean_str[:8], "%Y%m%d").date()
        today = date.today()
        diff = (target_date - today).days
        
        if diff == 0:
            return "D-Day (오늘)"
        elif diff > 0:
            return f"D-{diff}"
        else:
            return f"{abs(diff)}일 전 마감"
    except Exception:
        return "기일 미정"

def determine_safety(row: dict) -> tuple[str, str]:
    """
    초보자를 위한 신호등 등급(GREEN/YELLOW/RED) 및 권리 요약 문구 산출
    - GREEN: 말소기준 이하 전부 소멸, 인수 보증금 0원, 특수권리 없음
    - YELLOW: 임차인 배당요구 여부 확인 필요, 선순위 전세권 등 조사 필요
    - RED: 대항력 있는 미배당 임차인, 유치권/법정지상권 등 인수 위험 권리
    """
    special = (row.get("special_rights") or "").strip()
    tenant_dep = row.get("tenant_deposit") or 0
    payout_req = row.get("is_payout_requested") or 0
    ai_verdict = (row.get("ai_verdict") or "").strip()
    ai_grade = (row.get("ai_grade") or "").upper()
    remarks = (row.get("remarks") or "").strip()

    # 위험 키워드 검사
    danger_keywords = ["유치권", "법정지상권", "분묘기지권", "지분매각", "예고등기", "인수"]
    has_danger = any(k in special or k in remarks for k in danger_keywords)

    if has_danger:
        return "RED", "⚠️ 인수 권리 주의 (유치권·지분 등 현장 조사 필수)"

    # 임차인 검사
    if tenant_dep > 0:
        if payout_req == 1 and ai_grade in ("S", "A"):
            return "YELLOW", f"보증금 {format_krw(tenant_dep)} 전액 배당 예상 (배당요구 완료)"
        else:
            return "RED", f"선순위 임차인 보증금 {format_krw(tenant_dep)} 인수 위험 확인 필요"
    elif payout_req == 1:
        return "YELLOW", "임차인 배당요구 접수됨 (권리신고 내역 확인 권장)"
    
    # AI 등급 기반
    if ai_grade in ("S", "A") or "안전" in ai_verdict or "소멸" in ai_verdict:
        return "GREEN", "떠안는 권리 0원 · 말소기준권리 이하 모두 깨끗이 소멸"
    elif ai_grade == "B":
        return "YELLOW", "선순위 권리 및 관리비 체납 여부 사전 열람 권장"
    else:
        return "YELLOW", "입찰 전 매각물건명세서 상세 확인 요망"

def generate_feed(limit: int = 100) -> list[dict]:
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found at {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 서울/경기/인천 주거용 매물 쿼리 (이상치 제외)
    query = """
        SELECT *
        FROM auction_items
        WHERE (location LIKE '%서울%' OR location LIKE '%경기%' OR location LIKE '%인천%')
          AND (usage IN ('아파트', '오피스텔', '다세대/빌라', '연립주택', '주택', '단독주택', '다가구주택')
               OR location LIKE '%아파트%' OR location LIKE '%빌라%' OR location LIKE '%오피스텔%')
          AND COALESCE(status_flag, '') != 'CLOSED'
          AND appraisal > 0
          AND min_bid >= 30000000
        ORDER BY 
            CASE WHEN auction_date >= strftime('%Y%m%d', 'now', 'localtime') THEN 0 ELSE 1 END,
            CASE WHEN ai_grade IN ('S', 'A') THEN 0 WHEN ai_grade = 'B' THEN 1 ELSE 2 END,
            CASE WHEN min_bid BETWEEN 100000000 AND 600000000 THEN 0 ELSE 1 END,
            failed_count DESC,
            auction_date ASC
    """
    
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()

    feed_items = []
    seen_cases = set()

    for r in rows:
        row = dict(r)
        case_no = row["case_number"]
        if case_no in seen_cases:
            continue
        seen_cases.add(case_no)

        appraisal = row["appraisal"] or 0
        min_bid = row["min_bid"] or 0
        market_price = row.get("market_price") or 0
        location = row.get("location") or ""
        sgg = row.get("addr_sgg") or ""
        emd = row.get("addr_emd") or ""
        pyeong = round(row.get("area_pyeong") or 0, 1)
        raw_usage = row.get("usage") or "주택"
        failed_count = row.get("failed_count") or 0
        auction_date_str = row.get("auction_date") or ""

        # 평수 표기 개선 (0평 방지)
        pyeong_str = f"{pyeong}평 " if pyeong > 0 else ""

        # 용도 단축명
        if "아파트" in raw_usage or "아파트" in location:
            usage_label = "아파트"
        elif "오피스텔" in raw_usage or "오피스텔" in location:
            usage_label = "오피스텔"
        elif "빌라" in raw_usage or "다세대" in raw_usage or "연립" in raw_usage:
            usage_label = "빌라"
        else:
            usage_label = "주택"

        # 지역 짧은 명칭
        short_loc = f"{sgg} {emd}".strip() if sgg or emd else (location.split()[:2][-1] if location else "수도권")

        # 갭(시세차익) 계산: 실거래 매칭가 우선, 없으면 감정가 기준
        if market_price > min_bid:
            gap = market_price - min_bid
            ref_name = "최근 실거래가"
        else:
            gap = max(0, appraisal - min_bid)
            ref_name = "감정가"

        gap_str = format_krw(gap)
        discount_pct = round((1 - min_bid / appraisal) * 100) if appraisal > 0 else 0

        # 신호등 등급 및 권리 한줄 요약
        safety_grade, right_summary = determine_safety(row)

        # 후킹 한 줄 헤드라인
        if gap >= 50_000_000:
            headline = f"{short_loc} {pyeong_str}{usage_label}, {ref_name}보다 {gap_str} 쌈"
        elif discount_pct >= 30:
            headline = f"{short_loc} {pyeong_str}{usage_label}, {discount_pct}% 반값 유찰 줍줍"
        else:
            headline = f"{short_loc} {pyeong_str}{usage_label}, {format_krw(min_bid)}대 알짜 경매"

        # 핵심 요약 3줄 (초보자용 불릿)
        bullet_right = f"🛡️ {right_summary}"
        
        if ref_name == "최근 실거래가":
            bullet_price = f"💰 주변 실거래({format_krw(market_price)}) 대비 {gap_str} 저렴 ({discount_pct}% 할인)"
        else:
            bullet_price = f"💰 감정가({format_krw(appraisal)}) 대비 {discount_pct}% 유찰 ({gap_str} 할인)"
        
        deposit_req = int(min_bid * 0.1) # 입찰 보증금 10%
        d_day_str = calculate_d_day(auction_date_str)
        bullet_cash = f"💵 입찰 준비금(10%) {format_krw(deposit_req)} 필요 · {d_day_str}"

        # 썸네일 이미지 링크
        # 카카오/네이버 정적 맵 또는 건물 기본 로드뷰 에셋
        lat = row.get("lat")
        lng = row.get("lng")
        photo_url = f"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80"
        if "아파트" in usage_label:
            photo_url = "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80"
        elif "오피스텔" in usage_label:
            photo_url = "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80"
        else:
            photo_url = "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80"

        item = {
            "case_number": case_no,
            "headline": headline,
            "safety_grade": safety_grade,
            "gap_amount": gap,
            "gap_amount_str": gap_str,
            "ref_price_name": ref_name,
            "summary_bullets": [
                bullet_right,
                bullet_price,
                bullet_cash
            ],
            "min_bid": min_bid,
            "min_bid_str": format_krw(min_bid),
            "appraisal": appraisal,
            "appraisal_str": format_krw(appraisal),
            "discount_pct": discount_pct,
            "deposit_required": deposit_req,
            "deposit_required_str": format_krw(deposit_req),
            "usage": usage_label,
            "area_pyeong": pyeong,
            "location": location,
            "short_location": short_loc,
            "floor": row.get("floor") or 1,
            "failed_count": failed_count,
            "auction_date": auction_date_str,
            "d_day": d_day_str,
            "lat": lat,
            "lng": lng,
            "photo_url": photo_url,
            "court_name": row.get("court_name") or ""
        }
        feed_items.append(item)
        if len(feed_items) >= limit:
            break

    return feed_items

def main():
    print(f"🚀 [export_mobile_feed] DB에서 모바일 최적화 피드 생성 중...")
    items = generate_feed(limit=100)
    
    meta = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_count": len(items),
        "green_count": sum(1 for i in items if i["safety_grade"] == "GREEN"),
        "yellow_count": sum(1 for i in items if i["safety_grade"] == "YELLOW"),
        "red_count": sum(1 for i in items if i["safety_grade"] == "RED"),
        "items": items
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"✅ mobile_feed.json 생성 완료: 총 {len(items)}건")
    print(f"   🟢 GREEN(안전): {meta['green_count']}건 | 🟡 YELLOW: {meta['yellow_count']}건 | 🔴 RED: {meta['red_count']}건")
    print(f"   저장 경로: {OUTPUT_PATH}")

    # 샘플 3건 출력
    print("\n📋 [샘플 3건 미리보기]")
    for idx, sample in enumerate(items[:3], 1):
        print(f"\n[{idx}] {sample['headline']} ({sample['safety_grade']})")
        print(f"    사건번호: {sample['case_number']} | 최저가: {sample['min_bid_str']} (감정가: {sample['appraisal_str']})")
        for b in sample['summary_bullets']:
            print(f"    - {b}")

if __name__ == "__main__":
    main()
