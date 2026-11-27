#!/usr/bin/env python3
"""
export_mobile_feed.py

이지경매(EasyAuction) 모바일 앱·웹용 정적 피드(mobile_feed.json) 생성 스크립트 (2단계 고도화).
- DB(auction_db.sqlite)의 활성 매물을 최대한 반영 (사건번호 + 정규화 주소 2중 중복 제거)
- 난이도 3단계 재분류: 🟢 초급(GREEN/BEGINNER) · 🟡 중급(YELLOW/INTERMEDIATE) · 🔴 고수(RED/ADVANCED)
- 스레드식 후킹 카피 + 카드형 전용 핵심 배지(card_tags)
- 상세 화면용 대시보드 알짜 데이터 이식:
  * AI 권리분석 리포트(ai_analysis) 및 말소기준권리(malso_right)
  * 유찰/매각 기일 히스토리(bid_history)
  * 네이버 부동산(naver_listings) / DB 기반 인근 전월세 시세 & 예상 수익률(rental_estimate, 없으면 null)
  * 인근 유사 낙찰 통계(area_winning_stats: auction_results 5,700+건 기반)
  * 대법원 공적장부 원문(raw_court_data)
"""

import os
import re
import json
import shutil
import sqlite3
import statistics
from datetime import datetime, date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "auction_db.sqlite")
OUTPUT_PATH = os.path.join(BASE_DIR, "mobile_feed.json")
APP_OUTPUT_PATH = os.path.join(BASE_DIR, "mobile", "assets", "mobile_feed.json")

MALSO_KEYWORDS = ("근저당", "저당", "가압류", "압류", "담보가등기", "경매개시", "전세권")


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


def format_krw_short(val: int) -> str:
    """스레드/카드뉴스용 짧은 금액 표기 (예: '2.1억', '4,300만')"""
    if not val or val <= 0:
        return "0원"
    if val >= 100_000_000:
        eok_float = val / 100_000_000
        s = f"{eok_float:.1f}억"
        return s.replace(".0억", "억")
    man = val // 10_000
    return f"{man:,}만"


def build_full_region_label(location: str, sgg: str, emd: str) -> str:
    """
    '서울 성동구 마장동', '경기 파주시 와동동', '인천 부평구 부평동' 등
    시/도 + 시/군/구 + 동/읍/면이 명확히 보이도록 정규화.
    """
    loc = (location or "").strip()
    sgg_c = (sgg or "").strip()
    emd_c = (emd or "").strip()

    sido_map = {
        "서울특별시": "서울", "서울시": "서울", "서울": "서울",
        "경기도": "경기", "경기": "경기",
        "인천광역시": "인천", "인천시": "인천", "인천": "인천",
        "부산광역시": "부산", "대구광역시": "대구", "대전광역시": "대전",
        "광주광역시": "광주", "울산광역시": "울산", "세종특별자치시": "세종",
        "강원특별자치도": "강원", "강원도": "강원",
        "충청북도": "충북", "충청남도": "충남",
        "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
        "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
    }

    tokens = loc.split()
    sido = ""
    if tokens:
        sido = sido_map.get(tokens[0], "")
        if not sido:
            for full_k, short_v in sido_map.items():
                if loc.startswith(full_k):
                    sido = short_v
                    break

    # sgg가 비어있으면 location 토큰에서 보완
    if not sgg_c and len(tokens) >= 2:
        sgg_c = tokens[1]
        if len(tokens) >= 3 and tokens[2].endswith("구") and not sgg_c.endswith("구"):
            sgg_c = f"{sgg_c} {tokens[2]}"

    # emd가 비어있으면 괄호 내 동/읍/면 또는 토큰에서 보완
    if not emd_c:
        m_paren = re.search(r"\(([가-힣0-9]+(?:동|읍|면|가))", loc)
        if m_paren:
            emd_c = m_paren.group(1)
        else:
            for tk in tokens[2:5]:
                if re.match(r"^[가-힣0-9]+(동|읍|면|리)$", tk):
                    emd_c = tk
                    break

    parts = []
    if sido:
        parts.append(sido)
    if sgg_c:
        # '경기 안양시 동안구' -> 중복 sido 제거
        sgg_clean = re.sub(r"^(서울특별시|경기도|인천광역시|서울|경기|인천)\s*", "", sgg_c).strip()
        if sgg_clean and sgg_clean not in parts:
            parts.append(sgg_clean)
    if emd_c and emd_c not in " ".join(parts):
        parts.append(emd_c)

    if parts:
        return " ".join(parts)
    return " ".join(tokens[:3]) if tokens else "수도권"


def normalize_location_key(location: str) -> str:
    """동일 주소/호수 중복 제거용 정규화 키 생성 (연희동 3건, 회기동 4건 등 중복 방지)"""
    if not location:
        return ""
    s = re.sub(r"\([^)]*\)", "", location)  # 괄호 안 부가명 제거
    s = re.sub(r"\s+", "", s)
    s = s.replace("서울특별시", "서울").replace("경기도", "경기").replace("인천광역시", "인천")
    return s.strip().lower()


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


def extract_malso_right(rights_list: list) -> dict | None:
    """등기부 권리 내역에서 가장 빠른 말소기준권리 추출"""
    if not rights_list or not isinstance(rights_list, list):
        return None

    candidates = []
    for r in rights_list:
        if not isinstance(r, dict):
            continue
        r_name = str(r.get("type") or r.get("name") or "")
        r_date = str(r.get("registration_date") or r.get("date") or "").replace(".", "-").strip()
        is_std = bool(r.get("is_standard_right"))
        if is_std or any(k in r_name for k in MALSO_KEYWORDS):
            candidates.append({
                "name": r_name or "말소기준권리",
                "date": r_date or "일자 미상",
                "right_holder": str(r.get("right_holder") or ""),
                "claim_amount": r.get("claim_amount") or 0,
                "is_explicit": is_std,
            })

    if not candidates:
        return None

    # 명시적 is_standard_right 우선, 그다음 등록일 오름차순
    candidates.sort(key=lambda x: (0 if x["is_explicit"] else 1, x["date"] or "9999-99-99"))
    top = candidates[0]
    return {
        "name": top["name"],
        "date": top["date"],
        "right_holder": top["right_holder"],
        "claim_amount": top["claim_amount"],
    }


def determine_difficulty(row: dict, malso_right: dict | None) -> tuple[str, str, str, int]:
    """
    난이도 3단계 재분류:
    - GREEN  / BEGINNER     (🟢 초급): 임차인 없음·말소기준 이하 전부 소멸 등 권리 심플 (안정적 소수익)
    - YELLOW / INTERMEDIATE (🟡 중급): 대항력 임차인·배당 확인 등 약간의 권리 체크 필요
    - RED    / ADVANCED     (🔴 고수): 유치권·지분·선순위·폐문부재 등 권리는 복잡하지만 할인율/기대수익 큰 물건

    반환: (safety_grade, difficulty_level, right_summary, assumed_deposit)
    """
    special = (row.get("special_rights") or "").strip()
    tenant_dep = int(row.get("tenant_deposit") or 0)
    tenant_date = (row.get("tenant_registration_date") or "").strip()
    payout_req = int(row.get("is_payout_requested") or 0)
    ai_verdict = (row.get("ai_verdict") or "").strip()
    ai_grade = (row.get("ai_grade") or "").upper()
    remarks = (row.get("remarks") or "").strip()

    # 고수 난이도 키워드 (유치권·지분·법정지상권·분묘기지권·폐문부재·인수 등)
    advanced_keywords = ["유치권", "법정지상권", "분묘기지권", "지분매각", "공유지분", "지분", "예고등기", "폐문부재", "매수인 인수", "인수"]
    matched_adv = [k for k in advanced_keywords if k in special or k in remarks]

    if matched_adv:
        kw_label = "·".join(dict.fromkeys(matched_adv[:2]))
        assumed = tenant_dep if (tenant_dep > 0 and payout_req == 0) else 0
        return "RED", "ADVANCED", f"{kw_label} 등 복잡 권리 · 고수용 하이리턴", assumed

    # 말소기준일 대비 선순위 판정 시도
    is_senior = False
    if tenant_date and malso_right and malso_right.get("date"):
        t_clean = re.sub(r"[^0-9]", "", tenant_date)[:8]
        m_clean = re.sub(r"[^0-9]", "", str(malso_right["date"]))[:8]
        if len(t_clean) == 8 and len(m_clean) == 8 and t_clean < m_clean:
            is_senior = True

    # 임차인 보증금 존재
    if tenant_dep > 0:
        if payout_req == 1 and not is_senior:
            return "YELLOW", "INTERMEDIATE", f"세입자 배당요구 완료 · 배당순서만 체크", 0
        elif payout_req == 1 and is_senior:
            return "YELLOW", "INTERMEDIATE", f"선순위 세입자 배당요구 · 낙찰가 부족분 체크", 0
        else:
            return "RED", "ADVANCED", f"선순위 보증금 {format_krw_short(tenant_dep)}원 인수 가능성 체크", tenant_dep
    elif payout_req == 1 or tenant_date:
        return "YELLOW", "INTERMEDIATE", "세입자 점유·배당내역 한 번 더 확인", 0

    # AI 등급/판정 기반 (임차인·특수권리 없는 경우)
    if ai_grade in ("S", "A") or "안전" in ai_verdict or "SAFE" in ai_verdict or "소멸" in ai_verdict:
        return "GREEN", "BEGINNER", "임차인 0명 · 추가 인수금 0원 (권리 심플)", 0
    elif ai_grade == "B":
        return "YELLOW", "INTERMEDIATE", "입찰 전 점유현황·미납 관리비 체크 권장", 0
    else:
        return "YELLOW", "INTERMEDIATE", "입찰 전 매각물건명세서 세부 조건 확인", 0


def build_bid_history(appraisal: int, min_bid: int, failed_count: int, prev_min_bid: int, auction_date: str) -> list[dict]:
    """유찰 횟수와 감정가·최저가를 바탕으로 회차별 매각 기일 히스토리 생성"""
    if appraisal <= 0 or min_bid <= 0:
        return []

    rounds = max(1, failed_count + 1)
    # 1차 대비 현재 비율로 회차당 저감률 추정 (통상 20% 또는 30%)
    if rounds == 1:
        return [{
            "round": 1,
            "price": min_bid,
            "price_str": format_krw(min_bid),
            "ratio_pct": round(min_bid / appraisal * 100),
            "status": "진행 예정",
            "is_current": True,
            "date": auction_date or "기일 미정",
        }]

    # 이전 회차 대비 저감률 추정 (기본 0.8)
    step_ratio = 0.8
    if prev_min_bid and prev_min_bid > min_bid and prev_min_bid <= appraisal:
        r_est = min_bid / prev_min_bid
        if 0.65 <= r_est <= 0.85:
            step_ratio = round(r_est, 2)
    else:
        # 전체 비율에서 역산
        overall = min_bid / appraisal
        if overall < (0.7 ** (rounds - 1)) * 1.05:
            step_ratio = 0.7

    history = []
    # 최대 최근 5개 회차까지만 깔끔하게 표시
    for r in range(1, rounds + 1):
        is_curr = (r == rounds)
        if r == 1:
            p = appraisal
        elif is_curr:
            p = min_bid
        else:
            p = int(round(appraisal * (step_ratio ** (r - 1)) / 10000) * 10000)
        ratio_pct = round(p / appraisal * 100)
        history.append({
            "round": r,
            "price": p,
            "price_str": format_krw(p),
            "ratio_pct": ratio_pct,
            "status": "현재 진행" if is_curr else "유찰",
            "is_current": is_curr,
            "date": (auction_date or "기일 미정") if is_curr else f"{r}차 유찰",
        })

    if len(history) > 5:
        history = [history[0]] + history[-4:]
    return history


def load_reference_indexes(conn: sqlite3.Connection) -> tuple[dict, dict, dict]:
    """
    1) naver_listings (월세 데이터): emd / sgg 별 인덱스
    2) auction_results (낙찰 결과 5,700+건): (sgg, usage) 별 낙찰가율·경쟁률 및 임대 참조 인덱스
    """
    cur = conn.cursor()

    # 1. naver_listings 월세 매물 로드
    naver_by_emd: dict[str, list[tuple]] = {}
    naver_by_sgg: dict[str, list[tuple]] = {}
    try:
        cur.execute("""
            SELECT addr_sgg, addr_emd, area_pyeong, deposit_10k, monthly_rent_10k, realty_type_cd
            FROM naver_listings
            WHERE trade_type = '월세' AND monthly_rent_10k > 0
        """)
        for sgg, emd, pyeong, dep, rent, rtype in cur.fetchall():
            rec = (float(pyeong or 0), int(dep or 0) * 10_000, int(rent or 0) * 10_000, rtype or "")
            if emd:
                naver_by_emd.setdefault(emd.strip(), []).append(rec)
            if sgg:
                short_sgg = sgg.strip().split()[-1]
                naver_by_sgg.setdefault(short_sgg, []).append(rec)
    except Exception:
        pass

    # 2. auction_results 시군구+용도별 낙찰 통계 & 임대 참조
    win_stats: dict[tuple[str, str], list[tuple]] = {}
    rent_by_sgg_usage: dict[tuple[str, str], list[int]] = {}
    try:
        cur.execute("""
            SELECT addr_sgg, usage, winning_rate, bidder_count, est_monthly_rent
            FROM auction_results
            WHERE winning_rate > 10 AND winning_rate <= 200
        """)
        for sgg, usage, wr, bc, est_r in cur.fetchall():
            if not sgg:
                continue
            short_sgg = sgg.strip().split()[-1]
            u_norm = normalize_usage(usage or "")
            win_stats.setdefault((short_sgg, u_norm), []).append((float(wr), int(bc or 1)))
            if est_r and est_r > 0:
                rent_by_sgg_usage.setdefault((short_sgg, u_norm), []).append(int(est_r))
    except Exception:
        pass

    return (naver_by_emd, naver_by_sgg), win_stats, rent_by_sgg_usage


def normalize_usage(raw_usage: str, location: str = "") -> str:
    text = f"{raw_usage} {location}"
    if "아파트" in text:
        return "아파트"
    if "오피스텔" in text:
        return "오피스텔"
    if any(k in text for k in ("빌라", "다세대", "연립", "다가구", "단독", "주택")):
        return "빌라"
    if any(k in text for k in ("상가", "근린", "점포", "사무실", "오피스")):
        return "상가"
    if any(k in text for k in ("토지", "대지", "임야", "전", "답", "농지")):
        return "토지"
    return "기타"


def estimate_rental_and_yield(
    row: dict,
    usage_label: str,
    min_bid: int,
    appraisal: int,
    pyeong: float,
    sgg: str,
    emd: str,
    naver_indexes: tuple[dict, dict],
    rent_by_sgg_usage: dict,
) -> dict | None:
    """
    인근 전월세 시세 및 예상 수익률 매칭.
    실제 DB/네이버/현황조사서 근거가 없으면 절대 허위 추정하지 않고 None 반환!
    """
    naver_by_emd, naver_by_sgg = naver_indexes
    short_sgg = sgg.strip().split()[-1] if sgg else ""
    emd_clean = emd.strip() if emd else ""

    est_monthly = int(row.get("est_monthly_rent") or 0)
    est_deposit = 0
    est_jeonse = 0
    sample_count = 0
    source_label = ""

    # 1순위: DB 자체 산출 est_monthly_rent가 있는 경우 (토지 제외 또는 수익률 정상 범위)
    if est_monthly >= 100_000 and usage_label != "토지":
        est_deposit = int(round((est_monthly * 20) / 1_000_000) * 1_000_000)
        sample_count = int(row.get("market_match_count") or 1)
        source_label = "DB 인근 임대 매칭"

    # 2순위: 상가/오피스텔/기타는 naver_listings (20,638건) 동 -> 시군구 유사 평형 월세 매칭
    if est_monthly <= 0 and usage_label in ("상가", "오피스텔", "기타"):
        pool = []
        if emd_clean and emd_clean in naver_by_emd:
            pool = naver_by_emd[emd_clean]
            source_label = f"네이버 부동산 {emd_clean} 월세"
        elif short_sgg and short_sgg in naver_by_sgg:
            pool = naver_by_sgg[short_sgg]
            source_label = f"네이버 부동산 {short_sgg} 월세"

        if pool:
            if pyeong > 0:
                similar = [p for p in pool if p[0] > 0 and pyeong * 0.45 <= p[0] <= pyeong * 1.75]
                if len(similar) >= 2:
                    pool = similar
            sample_count = len(pool)
            est_deposit = int(statistics.median([p[1] for p in pool]))
            est_monthly = int(statistics.median([p[2] for p in pool]))

    # 3순위: 주거용(아파트/빌라) — 법원 현황조사서 실제 임차인 보증금이 확인된 경우 실전세 참고
    tenant_dep = int(row.get("tenant_deposit") or 0)
    if est_monthly <= 0 and usage_label in ("아파트", "빌라", "오피스텔") and tenant_dep >= 20_000_000:
        # 현황조사서 실보증금을 전세가 참고치로 활용 (보증금 20% + 나머지 5.5% 월세 환산 참고)
        est_jeonse = min(tenant_dep, int(appraisal * 0.95)) if appraisal > 0 else tenant_dep
        est_deposit = int(round((est_jeonse * 0.2) / 1_000_000) * 1_000_000)
        est_monthly = int(round(((est_jeonse - est_deposit) * 0.055 / 12) / 10_000) * 10_000)
        sample_count = 1
        source_label = "법원 현황조사서 실임차 보증금 기준"

    if est_monthly < 100_000:
        return None

    # 수익률 계산
    net_invest = max(min_bid - est_deposit, 10_000_000)
    annual_yield_pct = round((est_monthly * 12) / net_invest * 100, 1)
    if annual_yield_pct <= 0.3 or annual_yield_pct > 25.0:
        return None

    # 전세 환산 추정치 (주거/오피스텔, 연 5.5% 전환율 참고)
    if est_jeonse <= 0 and usage_label in ("아파트", "빌라", "오피스텔"):
        jeonse_raw = est_deposit + int((est_monthly * 12) / 0.055)
        est_jeonse = min(jeonse_raw, int(min_bid * 0.92))
        est_jeonse = int(round(est_jeonse / 1_000_000) * 1_000_000)
    gap_invest_cash = max(0, min_bid - est_jeonse) if est_jeonse > 0 else 0

    return {
        "est_deposit": est_deposit,
        "est_deposit_str": format_krw(est_deposit),
        "est_monthly_rent": est_monthly,
        "est_monthly_rent_str": format_krw(est_monthly),
        "est_jeonse": est_jeonse,
        "est_jeonse_str": format_krw(est_jeonse) if est_jeonse > 0 else "",
        "annual_yield_pct": annual_yield_pct,
        "gap_invest_cash": gap_invest_cash,
        "gap_invest_cash_str": format_krw(gap_invest_cash) if est_jeonse > 0 else "",
        "sample_count": sample_count,
        "source_label": source_label,
    }


def generate_feed(limit: int = 500) -> list[dict]:
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found at {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    naver_indexes, win_stats, rent_by_sgg_usage = load_reference_indexes(conn)

    cursor = conn.cursor()
    # DB 활성 매물 최대한 반영 (이상치·종결 제외, 사진 보유 & 주거/상가 & 미래 기일 우선 정렬)
    query = """
        SELECT *
        FROM auction_items
        WHERE COALESCE(status_flag, '') != 'CLOSED'
          AND appraisal > 0
          AND min_bid >= 10000000
        ORDER BY
            CASE WHEN usage IN ('아파트', '다세대/빌라', '오피스텔', '상가/근린시설') THEN 0 ELSE 1 END,
            CASE WHEN photo_url IS NOT NULL AND photo_url != '' THEN 0 ELSE 1 END,
            CASE WHEN auction_date >= strftime('%Y%m%d', 'now', 'localtime') THEN 0 ELSE 1 END,
            CASE WHEN ai_grade IN ('S', 'A') THEN 0 WHEN ai_grade = 'B' THEN 1 ELSE 2 END,
            failed_count DESC,
            auction_date ASC
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()

    feed_items = []
    seen_cases = set()
    seen_locations = set()
    dup_case_skipped = 0
    dup_loc_skipped = 0

    for r in rows:
        row = dict(r)
        case_no = (row["case_number"] or "").strip()
        location = (row.get("location") or "").strip()

        if not case_no or case_no in seen_cases:
            dup_case_skipped += 1
            continue

        loc_key = normalize_location_key(location)
        if loc_key and loc_key in seen_locations:
            dup_loc_skipped += 1
            continue

        seen_cases.add(case_no)
        if loc_key:
            seen_locations.add(loc_key)

        appraisal = int(row["appraisal"] or 0)
        min_bid = int(row["min_bid"] or 0)
        prev_min_bid = int(row.get("prev_min_bid") or 0)
        market_price = int(row.get("market_price") or 0)
        sgg = (row.get("addr_sgg") or "").strip()
        emd = (row.get("addr_emd") or "").strip()
        pyeong = round(float(row.get("area_pyeong") or 0), 1)
        raw_usage = (row.get("usage") or "기타").strip()
        failed_count = int(row.get("failed_count") or 0)
        auction_date_str = (row.get("auction_date") or "").strip()

        usage_label = normalize_usage(raw_usage, location)

        # 지역 명확 표기 (시/도 + 시/군/구 + 동/읍/면, 예: '서울 성동구 마장동', '경기 파주시 와동동')
        short_loc = build_full_region_label(location, sgg, emd)

        # 등기부 권리 내역 및 말소기준권리 파싱
        rights_raw = row.get("rights_list")
        rights_list = []
        if rights_raw:
            try:
                parsed_r = json.loads(rights_raw) if isinstance(rights_raw, str) else rights_raw
                if isinstance(parsed_r, list):
                    rights_list = parsed_r
            except Exception:
                rights_list = []

        special_raw = row.get("special_rights")
        special_rights = []
        if special_raw:
            try:
                parsed_s = json.loads(special_raw) if isinstance(special_raw, str) else special_raw
                if isinstance(parsed_s, list):
                    special_rights = parsed_s
            except Exception:
                special_rights = []

        malso_right = extract_malso_right(rights_list)

        # 난이도 3단계 재분류 (🟢 초급 / 🟡 중급 / 🔴 고수)
        safety_grade, difficulty, right_summary, assumed_deposit = determine_difficulty(row, malso_right)

        # 시세차익(갭) 계산
        if market_price > min_bid:
            gap = market_price - min_bid
            ref_name = "최근 실거래가"
            ref_short = "시세"
            ref_val = market_price
        else:
            gap = max(0, appraisal - min_bid)
            ref_name = "감정가"
            ref_short = "감정가"
            ref_val = appraisal

        gap_str = format_krw(gap)
        gap_short = format_krw_short(gap)
        min_short = format_krw_short(min_bid)
        discount_pct = round((1 - min_bid / appraisal) * 100) if appraisal > 0 else 0

        # 스레드식 후킹 카피 (동 이름만 단독 표기하지 않고 시/도 + 시/군/구 + 동 전체 표기)
        hook_loc = short_loc
        pyeong_short = f"{int(round(pyeong))}평 " if pyeong > 0 else ""

        if discount_pct >= 45:
            headline = f"{hook_loc} {usage_label}가 반값? {ref_short}보다 {gap_short} 싼 이유"
        elif safety_grade == "GREEN" and gap >= 80_000_000:
            headline = f"{hook_loc} {pyeong_short}{usage_label}, {ref_short}보다 {gap_short} 싼데 인수금 0원"
        elif safety_grade == "RED" and discount_pct >= 30:
            headline = f"{hook_loc} {usage_label} -{discount_pct}% 급락! 고수가 노리는 이유"
        elif gap >= 100_000_000:
            headline = f"{hook_loc} {pyeong_short}{usage_label}, 지금 {min_short}에 나왔다 ({gap_short} 할인)"
        elif discount_pct >= 30:
            headline = f"{discount_pct}% 떨어진 {hook_loc} {usage_label}, {min_short}대 노려볼까?"
        elif safety_grade == "GREEN":
            headline = f"임차인 0명 · {hook_loc} {usage_label}, {min_short}에 깔끔하게 시작"
        elif gap > 0:
            headline = f"{hook_loc} {pyeong_short}{usage_label}, {ref_short}보다 {gap_short} 저렴하게"
        else:
            headline = f"{hook_loc} {pyeong_short}{usage_label}, 신건 첫 입찰 ({min_short})"

        right_icon = "🟢" if safety_grade == "GREEN" else ("🟡" if safety_grade == "YELLOW" else "🔴")
        bullet_right = f"{right_icon} {right_summary}"
        bullet_price = f"💸 {ref_short}({format_krw_short(ref_val)})보다 {gap_short} 저렴 (-{discount_pct}%)"

        deposit_req = int(min_bid * 0.1)
        d_day_str = calculate_d_day(auction_date_str)
        bullet_cash = f"🪙 입찰 보증금 {format_krw(deposit_req)} 준비 · {d_day_str}"

        difficulty_tag = (
            "초급 · 인수금 0원" if safety_grade == "GREEN"
            else ("중급 · 권리 체크" if safety_grade == "YELLOW" else "고수 · 하이리턴")
        )
        card_tags = [
            difficulty_tag,
            f"📍 {short_loc}",
            f"보증금 {format_krw_short(deposit_req)}",
        ]

        # 썸네일 & 다중 사진
        lat = row.get("lat")
        lng = row.get("lng")
        db_photo = (row.get("photo_url") or "").strip()
        if db_photo:
            photo_url = f"https://frontend-nine-gules-14.vercel.app{db_photo}" if db_photo.startswith("/") else db_photo
        elif usage_label == "아파트":
            photo_url = "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80"
        elif usage_label == "오피스텔":
            photo_url = "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80"
        elif usage_label == "상가":
            photo_url = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80"
        elif usage_label == "토지":
            photo_url = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80"
        else:
            photo_url = "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80"

        db_photos_raw = row.get("photos")
        photos_list = []
        if db_photos_raw:
            try:
                parsed_p = json.loads(db_photos_raw) if isinstance(db_photos_raw, str) else db_photos_raw
                if isinstance(parsed_p, list):
                    for p in parsed_p:
                        if isinstance(p, str) and p.strip():
                            photos_list.append(
                                f"https://frontend-nine-gules-14.vercel.app{p}" if p.startswith("/") else p
                            )
            except Exception:
                pass
        if not photos_list and photo_url:
            photos_list = [photo_url]

        # AI 권리분석 리포트 파싱 (기존 대시보드 알짜 기능 이식)
        ai_json_raw = row.get("ai_report_json")
        ai_report = {}
        if ai_json_raw:
            try:
                ai_report = json.loads(ai_json_raw) if isinstance(ai_json_raw, str) else ai_json_raw
                if not isinstance(ai_report, dict):
                    ai_report = {}
            except Exception:
                ai_report = {}

        ai_analysis = {
            "score": int(row.get("ai_score") or ai_report.get("score") or 0),
            "grade": str(row.get("ai_grade") or ai_report.get("grade") or ""),
            "verdict": str(row.get("ai_verdict") or ai_report.get("verdict") or ""),
            "suggested_bid": str(row.get("ai_suggested_bid") or ai_report.get("suggested_bid") or ""),
            "expected_yield": str(ai_report.get("expected_yield") or ""),
            "key_points": ai_report.get("key_points") if isinstance(ai_report.get("key_points"), list) else [],
            "risks": ai_report.get("risks") if isinstance(ai_report.get("risks"), list) else [],
            "extinguished_rights": ai_report.get("extinguished_rights") if isinstance(ai_report.get("extinguished_rights"), list) else [],
            "retained_rights": ai_report.get("retained_rights") if isinstance(ai_report.get("retained_rights"), list) else [],
            "analysis_detail": str(ai_report.get("analysis_detail") or ""),
            "malso_right": malso_right,
            "assumed_deposit": assumed_deposit,
            "assumed_deposit_str": format_krw(assumed_deposit),
        }

        # 유찰/매각 기일 히스토리
        bid_history = build_bid_history(appraisal, min_bid, failed_count, prev_min_bid, auction_date_str)

        # 인근 전월세 시세 & 예상 수익률 (근거 없으면 None)
        rental_estimate = estimate_rental_and_yield(
            row=row,
            usage_label=usage_label,
            min_bid=min_bid,
            appraisal=appraisal,
            pyeong=pyeong,
            sgg=sgg,
            emd=emd,
            naver_indexes=naver_indexes,
            rent_by_sgg_usage=rent_by_sgg_usage,
        )

        # 인근 유사 낙찰 통계 (auction_results 5,700+건 기반)
        short_sgg = sgg.split()[-1] if sgg else ""
        stat_rows = win_stats.get((short_sgg, usage_label), [])
        area_winning_stats = None
        if len(stat_rows) >= 3:
            avg_wr = round(sum(x[0] for x in stat_rows) / len(stat_rows), 1)
            avg_bc = round(sum(x[1] for x in stat_rows) / len(stat_rows), 1)
            area_winning_stats = {
                "region_label": f"{short_sgg} {usage_label}",
                "sample_count": len(stat_rows),
                "avg_winning_rate": avg_wr,
                "avg_bidder_count": avg_bc,
            }

        # 대법원 공적장부 원문 데이터
        raw_court_data = {
            "rights_list": rights_list,
            "remarks": row.get("remarks") or "",
            "special_rights": special_rights,
            "tenant_registration_date": row.get("tenant_registration_date") or "",
            "tenant_deposit": int(row.get("tenant_deposit") or 0),
            "tenant_deposit_str": format_krw(int(row.get("tenant_deposit") or 0)),
            "is_payout_requested": bool(row.get("is_payout_requested")),
            "court_name": row.get("court_name") or "",
            "legal_div_no": row.get("legal_div_no") or "",
            "failed_count": failed_count,
            "auction_date": auction_date_str,
        }

        item = {
            "case_number": case_no,
            "headline": headline,
            "safety_grade": safety_grade,
            "difficulty": difficulty,
            "gap_amount": gap,
            "gap_amount_str": gap_str,
            "gap_short_str": gap_short,
            "ref_price_name": ref_name,
            "market_price": market_price,
            "market_price_str": format_krw(market_price) if market_price > 0 else "",
            "summary_bullets": [
                bullet_right,
                bullet_price,
                bullet_cash,
            ],
            "card_tags": card_tags,
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
            "floor": int(row.get("floor") or 1),
            "failed_count": failed_count,
            "auction_date": auction_date_str,
            "d_day": d_day_str,
            "lat": lat,
            "lng": lng,
            "photo_url": photo_url,
            "photos": photos_list,
            "ai_analysis": ai_analysis,
            "bid_history": bid_history,
            "rental_estimate": rental_estimate,
            "area_winning_stats": area_winning_stats,
            "raw_court_data": raw_court_data,
            "court_name": row.get("court_name") or "",
        }
        feed_items.append(item)
        if len(feed_items) >= limit:
            break

    print(f"🧹 중복 제거: 사건번호 중복 {dup_case_skipped}건 · 동일 주소 중복 {dup_loc_skipped}건 제외")
    return feed_items


def main():
    print("🚀 [export_mobile_feed] DB에서 2단계 고도화 피드 생성 중...")
    items = generate_feed(limit=500)

    green_cnt = sum(1 for i in items if i["safety_grade"] == "GREEN")
    yellow_cnt = sum(1 for i in items if i["safety_grade"] == "YELLOW")
    red_cnt = sum(1 for i in items if i["safety_grade"] == "RED")
    rental_cnt = sum(1 for i in items if i.get("rental_estimate"))
    win_stat_cnt = sum(1 for i in items if i.get("area_winning_stats"))

    meta = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_count": len(items),
        "green_count": green_cnt,
        "yellow_count": yellow_cnt,
        "red_count": red_cnt,
        "rental_matched_count": rental_cnt,
        "area_stats_matched_count": win_stat_cnt,
        "items": items,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(APP_OUTPUT_PATH), exist_ok=True)
    shutil.copyfile(OUTPUT_PATH, APP_OUTPUT_PATH)

    print(f"✅ mobile_feed.json 생성 완료: 총 {len(items)}건 (유니크 매물)")
    print(f"   🟢 초급(GREEN): {green_cnt}건 | 🟡 중급(YELLOW): {yellow_cnt}건 | 🔴 고수(RED): {red_cnt}건")
    print(f"   📊 인근 전월세 매칭: {rental_cnt}건 | 🏆 인근 낙찰통계 매칭: {win_stat_cnt}건")
    print(f"   저장 경로 1: {OUTPUT_PATH}")
    print(f"   저장 경로 2: {APP_OUTPUT_PATH}")

    print("\n📋 [샘플 3건 미리보기]")
    for idx, sample in enumerate(items[:3], 1):
        print(f"\n[{idx}] {sample['headline']} ({sample['difficulty']})")
        print(f"    사건번호: {sample['case_number']} | 최저가: {sample['min_bid_str']} | AI: {sample['ai_analysis']['score']}점({sample['ai_analysis']['grade']})")
        if sample.get("rental_estimate"):
            re_d = sample["rental_estimate"]
            print(f"    임대추정: 보증금 {re_d['est_deposit_str']} / 월세 {re_d['est_monthly_rent_str']} (연 {re_d['annual_yield_pct']}%, {re_d['source_label']})")
        if sample.get("area_winning_stats"):
            ws = sample["area_winning_stats"]
            print(f"    인근낙찰: {ws['region_label']} {ws['sample_count']}건 평균 낙찰가율 {ws['avg_winning_rate']}% (평균 {ws['avg_bidder_count']}명)")


if __name__ == "__main__":
    main()
