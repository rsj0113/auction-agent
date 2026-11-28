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
            return "오늘 마감"
        elif diff > 0:
            return f"마감 {diff}일 전"
        else:
            return "차기 기일 대기"
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


def _parse_date_yyyymmdd(date_str: str) -> str:
    """'2018년 9월 12일', '2019.07.03', '2017-11-30' 등을 'YYYYMMDD'로 정규화"""
    if not date_str:
        return ""
    s = str(date_str).strip()
    m_kr = re.search(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", s)
    if m_kr:
        return f"{int(m_kr.group(1)):04d}{int(m_kr.group(2)):02d}{int(m_kr.group(3)):02d}"
    m_sep = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m_sep:
        return f"{int(m_sep.group(1)):04d}{int(m_sep.group(2)):02d}{int(m_sep.group(3)):02d}"
    digits = re.sub(r"[^0-9]", "", s)
    return digits[:8] if len(digits) >= 8 else ""


def _parse_krw_amount(val) -> int:
    """숫자 또는 '205,000,000원', '5,000만원' 등을 원 단위 정수로 파싱 (미상이면 0)"""
    if isinstance(val, (int, float)):
        return int(val) if val > 0 else 0
    if not val:
        return 0
    s = str(val).strip()
    if not s or "미상" in s or "없음" in s:
        return 0
    # 억/만 표기 처리
    eok_m = re.search(r"(\d+)\s*억", s)
    man_m = re.search(r"([\d,]+)\s*만", s)
    if eok_m or man_m:
        total = 0
        if eok_m:
            total += int(eok_m.group(1)) * 100_000_000
        if man_m:
            total += int(man_m.group(1).replace(",", "")) * 10_000
        return total
    digits = re.sub(r"[^0-9]", "", s)
    return int(digits) if digits else 0


def extract_all_tenants(
    ai_report: dict,
    remarks: str,
    row: dict,
    malso_right: dict | None,
) -> tuple[list[dict], int, int]:
    """
    ai_report.tenants + remarks 내 [임차인 현황] + 단일 DB 컬럼을 모두 병합 파싱해
    전체 임차인 목록(전입일·보증금·배당요구·선순위 여부)을 빠짐없이 추출한다.
    반환: (tenants_list, senior_assumed_deposit, senior_unknown_count)
    """
    malso_ymd = _parse_date_yyyymmdd(malso_right.get("date", "") if malso_right else "")
    raw_entries: list[dict] = []
    seen_keys: set[tuple] = set()

    def add_entry(name: str, room: str, move_in: str, dep_raw, rent_raw, fixed: str, payout: bool):
        n_clean = (name or "").strip() or "임차인"
        r_clean = (room or "").strip()
        m_clean = (move_in or "").strip() or "미상"
        dep_int = _parse_krw_amount(dep_raw)
        dep_str = format_krw(dep_int) if dep_int > 0 else (str(dep_raw).strip() if dep_raw and "미상" not in str(dep_raw) else "미상")
        if dep_str in ("", "0", "0원"):
            dep_str = "미상"
        rent_str = ""
        if rent_raw and str(rent_raw).strip() not in ("", "0", "미상", "없음"):
            rent_int = _parse_krw_amount(rent_raw)
            rent_str = format_krw(rent_int) if rent_int >= 10_000 else str(rent_raw).strip()

        key = (n_clean, r_clean, _parse_date_yyyymmdd(m_clean) or m_clean)
        if key in seen_keys:
            return
        seen_keys.add(key)

        move_ymd = _parse_date_yyyymmdd(m_clean)
        if not move_ymd or "미전입" in m_clean or "미상" in m_clean:
            seniority = "UNKNOWN"
        elif malso_ymd:
            seniority = "SENIOR" if move_ymd < malso_ymd else "JUNIOR"
        else:
            seniority = "UNKNOWN"

        raw_entries.append({
            "name": n_clean,
            "room": r_clean,
            "move_in_date": m_clean,
            "deposit": dep_int,
            "deposit_str": dep_str,
            "monthly_rent": rent_str,
            "fixed_date": (fixed or "").strip() or "미상",
            "is_payout_requested": bool(payout),
            "seniority": seniority,
        })

    # 1순위: ai_report_json["tenants"]
    ai_tenants = ai_report.get("tenants") if isinstance(ai_report, dict) else None
    if isinstance(ai_tenants, list):
        for t in ai_tenants:
            if not isinstance(t, dict):
                continue
            add_entry(
                name=str(t.get("name") or ""),
                room=str(t.get("room") or ""),
                move_in=str(t.get("move_in_date") or ""),
                dep_raw=t.get("deposit"),
                rent_raw=t.get("monthly_rent"),
                fixed=str(t.get("fixed_date") or ""),
                payout=bool(t.get("is_payout_requested")),
            )

    # 2순위: remarks 내 [임차인 현황] 텍스트 파싱 보완
    if remarks and "[임차인 현황]" in remarks:
        after = remarks.split("[임차인 현황]", 1)[1]
        next_sec = re.search(r"\n\[[^\]]+\]", after)
        section_text = after[:next_sec.start()] if next_sec else after
        for line in section_text.splitlines():
            line = line.strip()
            if not line.startswith("-"):
                continue
            # 예: - 김진이: 전입 2020.12.08, 보증금 미상, 확정 미상, 배당요구 없음 (1층101호)
            m = re.match(r"^-\s*([^:]+):\s*(.*)$", line)
            if not m:
                continue
            t_name = m.group(1).strip()
            rest = m.group(2).strip()
            room_m = re.search(r"\(([^)]*)\)\s*$", rest)
            t_room = room_m.group(1).strip() if room_m else ""
            if room_m:
                rest = rest[:room_m.start()].strip()

            mi_m = re.search(r"전입\s*([^,]+)", rest)
            dp_m = re.search(r"보증금\s*([^,]+)", rest)
            fx_m = re.search(r"확정\s*([^,]+)", rest)
            py_m = re.search(r"배당요구\s*([^,(]+)", rest)
            t_mi = mi_m.group(1).strip() if mi_m else "미상"
            t_dp = dp_m.group(1).strip() if dp_m else "미상"
            t_fx = fx_m.group(1).strip() if fx_m else "미상"
            t_py_txt = py_m.group(1).strip() if py_m else ""
            t_py = bool(t_py_txt and ("없음" not in t_py_txt and "미요구" not in t_py_txt))
            add_entry(t_name, t_room, t_mi, t_dp, "", t_fx, t_py)

    # 3순위: 위 둘 다 없을 때만 단일 DB 컬럼 폴백
    if not raw_entries:
        col_date = (row.get("tenant_registration_date") or "").strip()
        col_dep = int(row.get("tenant_deposit") or 0)
        col_payout = bool(row.get("is_payout_requested"))
        if col_date or col_dep > 0 or col_payout:
            add_entry("조사된 임차인", "", col_date or "미상", col_dep if col_dep > 0 else "미상", "", "미상", col_payout)

    # 선순위 인수 보증금 합계 및 보증금 미상 선순위 임차인 카운트
    senior_assumed_deposit = 0
    senior_unknown_count = 0
    for t in raw_entries:
        if t["seniority"] == "SENIOR":
            if not t["is_payout_requested"]:
                if t["deposit"] > 0:
                    senior_assumed_deposit += t["deposit"]
                else:
                    senior_unknown_count += 1
            elif t["deposit"] == 0:
                senior_unknown_count += 1

    return raw_entries, senior_assumed_deposit, senior_unknown_count


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
    1) naver_listings (월세 + 전세 데이터): emd / sgg 별 인덱스
    2) auction_results (낙찰 결과 5,700+건): (sgg, usage) 별 낙찰가율·경쟁률 및 임대 참조 인덱스
    """
    cur = conn.cursor()

    # 1. naver_listings 월세·전세 매물 로드 (면적·층·거래유형 포함 — 평형 밴드 보정용)
    naver_by_emd: dict[str, list[tuple]] = {}
    naver_by_sgg: dict[str, list[tuple]] = {}
    try:
        cur.execute("""
            SELECT addr_sgg, addr_emd, area_pyeong, deposit_10k, monthly_rent_10k, realty_type_cd, floor, trade_type
            FROM naver_listings
            WHERE area_pyeong > 0
              AND (
                  (trade_type = '월세' AND monthly_rent_10k > 0)
                  OR (trade_type = '전세' AND deposit_10k >= 2000)
              )
        """)
        for sgg, emd, pyeong, dep, rent, rtype, floor, ttype in cur.fetchall():
            rec = (
                float(pyeong or 0),
                int(dep or 0) * 10_000,
                int(rent or 0) * 10_000,
                (rtype or "").strip(),
                str(floor or "").strip(),
                (ttype or "월세").strip(),
            )
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


def _extract_floor_from_location(location: str) -> int:
    """소재지 문자열에서 층수 추출 (지하는 음수, 미확인 시 0)"""
    if not location:
        return 0
    m_under = re.search(
        r"(?:제?지하|제지|(?<![가-힣A-Za-z])지|(?<![A-Za-z])[bB])\s*([1-9])\s*(?:층|,|~)",
        location,
    )
    if m_under:
        return -int(m_under.group(1))
    if re.search(r"(?:지하도상가|지하상가|지하층|지하\s*도)", location):
        return -1
    m_ground = re.search(
        r"(?<!지하)(?<!제지하)(?<!제지)(?<!(?<![가-힣])지)(?<!(?<![A-Za-z])[bB])(?:제)?\s*([1-9][0-9]?)\s*층",
        location,
    )
    if m_ground:
        return int(m_ground.group(1))
    return 0


def normalize_usage(raw_usage: str, location: str = "", remarks: str = "") -> str:
    """
    DB 원본 usage 오류를 소재지(단지·브랜드·동·층·호) 및 비고 원문으로 교정하여
    '아파트' / '오피스텔' / '빌라' / '상가' / '토지' / '기타' 중 하나로 정규화한다.
    """
    raw = (raw_usage or "").strip()
    loc = (location or "").strip()
    loc_lower = loc.lower()
    rem = (remarks or "").strip()
    flr = _extract_floor_from_location(loc)

    # 0. 순수 토지 판별 (층/호/동 표기가 없고 지번으로 끝나는 경우 — '삼성당리' 등 행정지명 오탐 방지)
    has_unit = bool(re.search(r"(?:층|호|동\s+\d)", loc))
    if loc and not has_unit and not any(k in loc for k in ("아파트", "빌라", "오피스텔", "상가", "주택", "타워", "프라자")):
        if (
            any(k in raw for k in ("토지", "대지", "임야", "전", "답", "농지"))
            or "임야" in loc
            or re.search(r"\b산\s*\d+", loc)
            or re.search(r"\d+(-\d+)?$", loc)
        ):
            if raw not in ("기타", "차량/기타", "노유자복지시설"):
                return "토지"

    # 1. 특수 노유자/복지시설
    if any(k in loc or k in raw or k in rem for k in ("노유자", "복지시설", "요양시설", "노인복지", "피더하우스")):
        return "기타"

    # 2. 명확한 상가/근린시설 (단지내 상가, 판매시설, 상업 타워/몰, 1층 대형 호수, 구획 상가 호수)
    comm_loc_kw = (
        "단지내상가", "단지상가", "상가동", "제상가동", "근린상가", "지하도상가", "지하상가", "시장",
        "상가", "근린", "지식산업", "프라자", "플라자", "에이스하이테크", "테크노", "비즈타워",
        "메디타워", "푸리마타워", "불로장생타워", "그랑파사쥬", "하이브랜드", "리빙관", "나인스에비뉴",
        "몰", "마켓", "스퀘어", "아케이드", "에스케이브이", "sk v1", "점포", "판매시설",
        "성남아리스타", "코아루센타시아",
    )
    if any(k in loc_lower for k in comm_loc_kw):
        return "상가"
    if any(k in rem for k in ("판매시설", "오픈상가", "일반음식점", "스크린야구장", "근린생활시설(학원", "근린생활시설(음식점", "음식점, 사무소", "독서실")):
        return "상가"

    has_apt_dong = bool(re.search(r"(?:제)?([1-9]\d{2,3})동", loc))
    # 구획 상가 호수 패턴 (예: '2층나-36호', '제비1가009호', '13층13-36-1호')
    if re.search(r"[가나다라마바사]-\d+호|제?비\d+[가나다]\d+호|\d+-\d+-\d+호", loc):
        return "상가"
    # 1층 대형 상가 호수 (101동~ 없는 단일 건물 1층 106호 이상 — 예: 성남아리스타 1층123호, 1층에이112호, 1층1043호)
    if flr == 1 and not has_apt_dong:
        m_ho = re.search(r"(?:제)?(?:[가-힣A-Za-z]+)?(1[0-9]{2,3})호", loc)
        if m_ho and int(m_ho.group(1)) >= 106:
            return "상가"
    # 지하2층 이상 (명시적 주거용 제외)
    if flr <= -2 and not any(k in loc for k in ("빌라", "다세대", "연립", "주택")):
        return "상가"

    # 3. 오피스텔 (오피스텔 전용 브랜드·키워드 + 비고 공부상 오피스텔; '힐스테이트' 오탐 제외)
    offi_kw = (
        "오피스텔", "아트리움", "리버빌", "오피스", "메종", "르메이에르", "샤르망",
        "두산위브센티움", "효성해링턴타워", "센트럴푸르지오시티", "푸르지오시티",
        "자이엘라", "아이파크디어반", "더샵스타파크", "라포르테블랑",
    )
    is_offi_state = ("스테이트" in loc and "힐스테이트" not in loc)
    if (
        any(k in loc for k in offi_kw)
        or is_offi_state
        or "오피스텔" in raw
        or re.search(r"(?:건축물대장상|공부상)[^.]{0,16}오피스텔", rem)
    ):
        return "오피스텔"

    # 4. 아파트 (단지·브랜드 키워드 + 101동~ & 6층 이상 휴리스틱 + 7층 이상 공동주택)
    villa_kw = (
        "빌라", "다세대", "연립", "맨션", "하이츠", "빌리지", "주택", "하우스",
        "캐슬빌", "아트빌", "그린빌", "스카이빌", "드림빌", "청구빌", "현대빌", "삼성빌",
        "샤인빌", "블루빌", "스위트빌", "리즈빌", "아인스빌", "엠에스 빌", "하우징",
    )
    apt_strong_kw = (
        "아파트", "단지", "마을", "비발디", "한라비발디", "자이", "래미안", "푸르지오",
        "힐스테이트", "아이파크", "더샵", "e편한", "이편한", "이-편한", "롯데캐슬", "주공",
        "센트럴파크", "호반", "우미린", "포레나", "반도유보라", "유보라", "한양수자인", "수자인",
        "화성파크드림", "파크드림", "아크로", "데시앙", "센트레빌", "위브", "해링턴", "꿈에그린",
        "베르디움", "중흥에스클래스", "파크뷰", "리버파크", "트리지움", "엘스", "리센츠",
        "헬리오시티", "파크리오", "그랑빌",
    )
    apt_secondary_kw = ("센트럴", "파크", "포레", "스카이뷰")

    is_villa_name = any(k in loc for k in villa_kw)
    if flr >= 0:
        if any(k in loc for k in apt_strong_kw) and not is_villa_name:
            return "아파트"
        if any(k in loc for k in apt_secondary_kw) and not is_villa_name and (has_apt_dong or flr >= 5):
            return "아파트"
        if has_apt_dong and flr >= 6 and not is_villa_name:
            return "아파트"
        if flr >= 7 and "호" in loc and not is_villa_name:
            return "아파트"
        if "아파트" in raw and not is_villa_name:
            return "아파트"

    # 5. 빌라/다세대/상가/토지 fallback
    if any(k in raw for k in ("빌라", "다세대", "연립", "다가구", "단독", "주택")) or is_villa_name:
        return "빌라"
    if "주택임차권" in rem and "호" in loc:
        return "빌라"
    if any(k in raw for k in ("상가", "근린", "점포", "사무실", "오피스")):
        return "상가"
    if any(k in raw for k in ("토지", "대지", "임야", "전", "답", "농지")):
        return "토지"
    return "기타"


def _dedup_naver_recs(recs: list[tuple]) -> list[tuple]:
    """동일 호실 중복 중개 매물(면적·보증금·월세·층·거래유형 동일) 제거"""
    seen: set[tuple] = set()
    out: list[tuple] = []
    for r in recs:
        key = (round(r[0], 1), r[1], r[2], r[4] if len(r) > 4 else "", r[5] if len(r) > 5 else "월세")
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def classify_yield_tier(rental_estimate: dict | None, is_lease: bool = False) -> str:
    """
    이지경매 핵심 정체성 — 예상 연 수익률 기반 4단계 구분:
    - HIGH: 연 8.0% 이상 (🔥 고수익)
    - MID:  연 5.0% ~ 7.9% (📈 중수익)
    - LOW:  연 5.0% 미만 (📉 저수익)
    - NONE: 수익률 미확인 · 토지 · 시세차익/일반 매물 (🏷️ 시세차익·일반)
    """
    if is_lease or not rental_estimate:
        return "NONE"
    y = rental_estimate.get("annual_yield_pct")
    if not isinstance(y, (int, float)) or y <= 0:
        return "NONE"
    if y >= 8.0:
        return "HIGH"
    if y >= 5.0:
        return "MID"
    return "LOW"


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
    - 아파트(A01)·오피스텔(A02)·빌라(C02/C03)·상가(D02/D03/D04) 동일 유형 실매물(월세 우선, 주거용 전세 환산 보조) 매칭.
    - 전용면적(평형) ±30%(우선) → ±40%(보조) 유사 평형 밴드 내에서만 보증금·월세를 함께 매칭.
    - 표본이 3건 미만이거나 면적이 미확인인 경우 전체 평형 평균으로 억지 추정하지 않고 None 반환!
    """
    naver_by_emd, naver_by_sgg = naver_indexes
    short_sgg = sgg.strip().split()[-1] if sgg else ""
    emd_clean = emd.strip() if emd else ""
    floor_num = _extract_floor_from_location(str(row.get("location") or ""))

    est_monthly = 0
    est_deposit = 0
    est_jeonse = 0
    sample_count = 0
    source_label = ""

    # 1순위: 네이버 부동산 동 → 시군구 유사 평형 밴드(±30% → ±40%) 월세/전세 매칭 (토지 제외)
    if usage_label in ("아파트", "빌라", "오피스텔", "상가", "기타") and pyeong > 0:
        candidates: list[tuple[str, list[tuple]]] = []
        if emd_clean and emd_clean in naver_by_emd:
            candidates.append((emd_clean, naver_by_emd[emd_clean]))
        if short_sgg and short_sgg in naver_by_sgg:
            candidates.append((short_sgg, naver_by_sgg[short_sgg]))

        def _match_pool(raw_pool: list[tuple], allowed_types: tuple[str, ...], trade_kind: str):
            pool = [
                r for r in raw_pool
                if (not allowed_types or r[3] in allowed_types)
                and (r[5] if len(r) > 5 else "월세") == trade_kind
            ]
            for band_pct in (0.30, 0.40):
                lo, hi = pyeong * (1.0 - band_pct), pyeong * (1.0 + band_pct)
                band = _dedup_naver_recs([r for r in pool if lo <= r[0] <= hi])
                if len(band) < 3:
                    continue
                if usage_label == "상가" and floor_num != 0 and trade_kind == "월세":
                    fl_band = [r for r in band if (r[4] == "1") == (floor_num == 1)]
                    if len(fl_band) >= 3:
                        band = fl_band
                return band, (max(1, round(lo)), max(1, round(hi)))
            return None, (0, 0)

        usage_type_codes = {
            "아파트": ("A01", "APT"),
            "오피스텔": ("A02", "OPST"),
            "빌라": ("C02", "C03", "VL"),
            "상가": ("D02", "D03", "D04", "SG"),
            "기타": ("D02", "D03", "D04", "A02"),
        }
        own_codes = usage_type_codes.get(usage_label, ())

        for loc_name, raw_pool in candidates:
            # 1-A. 동일 유형 월세 우선 매칭
            matched_band, matched_bounds = _match_pool(raw_pool, own_codes, "월세")
            is_commercial_fallback = False
            matched_trade = "월세"

            # 1-B. 주거용(아파트·빌라·오피스텔) 월세 표본 부족 시 동일 유형 전세 실매물 → 5.5% 월세 환산
            if not matched_band and usage_label in ("아파트", "빌라", "오피스텔"):
                matched_band, matched_bounds = _match_pool(raw_pool, own_codes, "전세")
                if matched_band:
                    matched_trade = "전세"

            # 1-C. 오피스텔은 A02 표본이 모두 부족할 때만 인근 상가/업무 월세 풀 보수 보정(상위 25% 제거)
            if not matched_band and usage_label == "오피스텔":
                matched_band, matched_bounds = _match_pool(raw_pool, (), "월세")
                if matched_band:
                    is_commercial_fallback = True
                    matched_trade = "월세"
                    if len(matched_band) >= 6:
                        rents_sorted = sorted(r[2] for r in matched_band)
                        q3 = rents_sorted[(len(rents_sorted) * 3) // 4]
                        trimmed = [r for r in matched_band if r[2] <= q3]
                        if len(trimmed) >= 3:
                            matched_band = trimmed

            if matched_band:
                sample_count = len(matched_band)
                band_tag = f"{matched_bounds[0]}~{matched_bounds[1]}평대"
                if matched_trade == "전세":
                    est_jeonse = int(round(statistics.median([r[1] for r in matched_band]) / 1_000_000) * 1_000_000)
                    est_deposit = int(round((est_jeonse * 0.2) / 1_000_000) * 1_000_000)
                    est_monthly = int(round(((est_jeonse - est_deposit) * 0.055 / 12) / 10_000) * 10_000)
                    source_label = f"네이버 부동산 {loc_name} {band_tag} 실전세 환산"
                else:
                    est_deposit = int(round(statistics.median([r[1] for r in matched_band]) / 1_000_000) * 1_000_000)
                    est_monthly = int(round(statistics.median([r[2] for r in matched_band]) / 10_000) * 10_000)
                    suffix = "유사평형 보정 월세" if is_commercial_fallback else "유사평형 월세"
                    source_label = f"네이버 부동산 {loc_name} {band_tag} {suffix}"
                break

    # 2순위: DB 자체 산출 est_monthly_rent (유사 평형 네이버 매칭이 없을 때, 토지 제외)
    db_est_monthly = int(row.get("est_monthly_rent") or 0)
    if est_monthly <= 0 and db_est_monthly >= 100_000 and usage_label != "토지":
        est_monthly = db_est_monthly
        est_deposit = int(round((est_monthly * 20) / 1_000_000) * 1_000_000)
        sample_count = int(row.get("market_match_count") or 1)
        source_label = "DB 인근 임대 매칭"

    # 3순위: 주거용(아파트/빌라/오피스텔) — 법원 현황조사서 실제 임차인 보증금이 확인된 경우 실전세 참고
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


def generate_feed(limit: int | None = None) -> list[dict]:
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found at {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    naver_indexes, win_stats, rent_by_sgg_usage = load_reference_indexes(conn)

    cursor = conn.cursor()
    # DB 활성 매물 전체 반영 (종결 제외, 최저가 100만원 이상 유효 매물 전부 노출, 건수 제한 해제)
    query = """
        SELECT *
        FROM auction_items
        WHERE COALESCE(status_flag, '') != 'CLOSED'
          AND appraisal > 0
          AND min_bid >= 1000000
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

        usage_label = normalize_usage(raw_usage, location, (row.get("remarks") or "").strip())

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

        usage_josa = "이" if usage_label == "오피스텔" else "가"
        if discount_pct >= 45:
            headline = f"{hook_loc} {usage_label}{usage_josa} 반값? {ref_short}보다 {gap_short} 싼 이유"
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

        # 상단 사진 출처 판정 (법원 감정평가서 N장 / 거리뷰 / 참고 이미지)
        has_court_photos = any(("/photos/" in p and "_sv.jpg" not in p) or "courtauction.go.kr" in p for p in photos_list)
        has_streetview = any("_sv.jpg" in p for p in photos_list)
        if has_court_photos:
            photo_source = "court"
            photo_source_label = f"🏛️ 법원 감정평가서 {len(photos_list)}장"
        elif has_streetview:
            photo_source = "streetview"
            photo_source_label = "🌐 거리뷰"
        else:
            photo_source = "stock"
            photo_source_label = "🖼️ 참고 이미지"

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

        # 전체 임차인 목록 파싱 (ai_report.tenants + remarks[임차인 현황] + 단일 컬럼 통합)
        tenants_list, senior_assumed_dep, senior_unknown_cnt = extract_all_tenants(
            ai_report=ai_report,
            remarks=row.get("remarks") or "",
            row=row,
            malso_right=malso_right,
        )
        effective_assumed_deposit = max(assumed_deposit, senior_assumed_dep)

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
            "assumed_deposit": effective_assumed_deposit,
            "assumed_deposit_str": format_krw(effective_assumed_deposit),
            "senior_unknown_count": senior_unknown_cnt,
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
            "tenants_list": tenants_list,
            "senior_assumed_deposit": effective_assumed_deposit,
            "senior_assumed_deposit_str": format_krw(effective_assumed_deposit),
            "senior_unknown_count": senior_unknown_cnt,
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
            "source_type": "auction",
            "source_badge": "[경매]",
            "disposal_method": "매각",
            "onbid_info": None,
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
            "photo_source": photo_source,
            "photo_source_label": photo_source_label,
            "ai_analysis": ai_analysis,
            "bid_history": bid_history,
            "rental_estimate": rental_estimate,
            "yield_tier": classify_yield_tier(rental_estimate, is_lease=False),
            "area_winning_stats": area_winning_stats,
            "raw_court_data": raw_court_data,
            "court_name": row.get("court_name") or "",
        }
        feed_items.append(item)
        if limit is not None and len(feed_items) >= limit:
            break

    print(f"🧹 중복 제거: 사건번호 중복 {dup_case_skipped}건 · 동일 주소 중복 {dup_loc_skipped}건 제외")

    # 온비드 공매(매각 + 임대) 활성 매물 연동 (수도권 대폭 확대 + 매각 물건 전월세 수익률 매칭)
    onbid_items = load_onbid_feed_items(
        sale_limit=500,
        lease_limit=250,
        naver_indexes=naver_indexes,
        rent_by_sgg_usage=rent_by_sgg_usage,
    )
    feed_items.extend(onbid_items)
    return feed_items


def _pick_stock_photo(usage_label: str) -> str:
    if usage_label == "아파트":
        return "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80"
    if usage_label == "오피스텔":
        return "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80"
    if usage_label == "상가":
        return "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80"
    if usage_label == "토지":
        return "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80"
    return "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80"


def load_onbid_feed_items(
    sale_limit: int = 500,
    lease_limit: int = 250,
    naver_indexes: tuple[dict, dict] | None = None,
    rent_by_sgg_usage: dict | None = None,
) -> list[dict]:
    """
    SQLite onbid_items에서 활성 수도권 온비드 공매 매각(매매)과 임대(대부) 물건을
    모바일 앱·웹 피드 규격으로 변환한다.
    - 공매 · 매각: source_type='onbid_sale', disposal_method='매각'
    - 공매 · 임대: source_type='onbid_lease', disposal_method='임대' (매매 전용 지표 제외, 사용료·임대기간 중심)
    """
    if not os.path.exists(DB_PATH):
        return []

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    today_iso = date.today().strftime("%Y-%m-%d")
    results: list[dict] = []

    def _fetch_by_disposal(disposal: str, min_price: int, max_rows: int) -> list[dict]:
        try:
            rows = cur.execute(
                """
                SELECT *
                FROM onbid_items
                WHERE disposal_method = ?
                  AND COALESCE(bid_status, '') != '마감'
                  AND bid_end_date >= ?
                  AND min_bid >= ?
                  AND (
                      addr_sido LIKE '%서울%' OR addr_sido LIKE '%경기%' OR addr_sido LIKE '%인천%'
                      OR addr_full LIKE '%서울%' OR addr_full LIKE '%경기%' OR addr_full LIKE '%인천%'
                  )
                ORDER BY
                  CASE WHEN bid_status = '입찰진행중' THEN 0 ELSE 1 END,
                  CASE
                      WHEN usage LIKE '%주거%' OR usage LIKE '%아파트%' OR usage LIKE '%오피스텔%'
                           OR usage LIKE '%상가%' OR usage LIKE '%업무%' OR usage LIKE '%판매%'
                      THEN 0 ELSE 1
                  END,
                  CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 0 ELSE 1 END,
                  bid_end_date ASC
                """,
                (disposal, today_iso, min_price),
            ).fetchall()
        except Exception as e:
            print(f"⚠️ onbid_items({disposal}) 조회 스킵: {e}")
            return []

        items_out: list[dict] = []
        seen_cltr: set[str] = set()
        seen_nm: set[str] = set()

        for r in rows:
            row = dict(r)
            cltr_no = (row.get("cltr_no") or "").strip()
            cltr_nm = (row.get("cltr_nm") or "").strip()
            if not cltr_no or cltr_no in seen_cltr:
                continue

            addr_sido = (row.get("addr_sido") or "").strip()
            addr_sgg = (row.get("addr_sgg") or "").strip()
            addr_emd = (row.get("addr_emd") or "").strip()
            addr_full = (row.get("addr_full") or "").strip()
            location = cltr_nm if (addr_sgg and addr_sgg in cltr_nm) else (f"{addr_sido} {addr_sgg} {addr_emd} {cltr_nm}".strip() or addr_full)
            location = re.sub(r"\s+", " ", location).strip()

            loc_key = normalize_location_key(location)
            if loc_key and loc_key in seen_nm:
                continue
            seen_cltr.add(cltr_no)
            if loc_key:
                seen_nm.add(loc_key)

            raw_usage = (row.get("usage") or "기타").strip()
            usage_label = normalize_usage(raw_usage, f"{addr_full} {cltr_nm}")
            short_loc = build_full_region_label(f"{addr_sido} {addr_sgg} {addr_emd}".strip() or location, addr_sgg, addr_emd)
            min_bid = int(row.get("min_bid") or 0)
            appraisal_raw = int(row.get("appraisal") or 0)
            prpt_div = (row.get("prpt_div") or "공매재산").strip()
            reg_org_nm = (row.get("reg_org_nm") or "온비드 공고기관").strip()
            bid_status = (row.get("bid_status") or "입찰진행중").strip()
            bid_start_date = (row.get("bid_start_date") or "").strip()
            bid_end_date = (row.get("bid_end_date") or "").strip()
            end_date_ymd = bid_end_date[:10].replace("-", "") if len(bid_end_date) >= 10 else ""
            d_day_str = calculate_d_day(end_date_ymd)
            pyeong = round(float(row.get("bld_area_pyeong") or 0), 1)
            land_m2 = round(float(row.get("land_area_m2") or 0), 1)
            bld_m2 = round(float(row.get("bld_area_m2") or 0), 1)
            if pyeong <= 0 and land_m2 > 0 and usage_label == "토지":
                pyeong = round(land_m2 / 3.3058, 1)
            pyeong_short = f"{int(round(pyeong))}평 " if pyeong > 0 else ""

            lat = row.get("lat")
            lng = row.get("lng")
            lat_f = float(lat) if lat is not None and str(lat).strip() != "" else None
            lng_f = float(lng) if lng is not None and str(lng).strip() != "" else None
            detail_url = (row.get("detail_url") or "https://www.onbid.co.kr").strip()
            if not detail_url.startswith("http"):
                detail_url = "https://www.onbid.co.kr"
            photo_url = _pick_stock_photo(usage_label)
            case_no = f"ONBID-{cltr_no}"

            if disposal == "매각":
                appraisal = appraisal_raw if appraisal_raw >= min_bid else min_bid
                gap = max(0, appraisal - min_bid)
                discount_pct = round((1 - min_bid / appraisal) * 100) if appraisal > 0 and appraisal > min_bid else 0
                if discount_pct < 0 or discount_pct > 95:
                    discount_pct = max(0, min(discount_pct, 95))
                min_short = format_krw_short(min_bid)
                gap_short = format_krw_short(gap)
                deposit_req = int(min_bid * 0.1)

                # 공매 매각 난이도 분류
                if "공유재산" in prpt_div or "국유재산" in prpt_div or "신탁" in prpt_div:
                    safety_grade, difficulty = "GREEN", "BEGINNER"
                    right_summary = f"기관 직접 공매({prpt_div}) · 권리 깔끔"
                elif discount_pct >= 50 or "지분" in cltr_nm:
                    safety_grade, difficulty = "RED", "ADVANCED"
                    right_summary = f"온비드 {prpt_div} · 고할인/권리 정밀확인 필요"
                else:
                    safety_grade, difficulty = "YELLOW", "INTERMEDIATE"
                    right_summary = f"온비드 {prpt_div} · 명도·임차인 확인 필요"

                if discount_pct >= 20 and gap >= 30_000_000:
                    headline = f"{short_loc} {pyeong_short}{usage_label} 공매, 감정가보다 {gap_short} 싼 {min_short}에 매각"
                elif discount_pct >= 15:
                    headline = f"{discount_pct}% 할인된 {short_loc} {usage_label} 공매 ({min_short})"
                else:
                    headline = f"{short_loc} {pyeong_short}{usage_label} 온비드 매각 · {min_short} ({reg_org_nm})"

                right_icon = "🟢" if safety_grade == "GREEN" else ("🟡" if safety_grade == "YELLOW" else "🔴")
                bullets = [
                    f"{right_icon} {right_summary}",
                    f"🏛️ {reg_org_nm} 공매 · {bid_status}" + (f" (-{discount_pct}%)" if discount_pct > 0 else ""),
                    f"🪙 입찰보증금 약 {format_krw(deposit_req)} (10%) · {d_day_str}",
                ]
                onbid_info = {
                    "cltr_no": cltr_no,
                    "onbid_cltr_no": str(row.get("onbid_cltr_no") or ""),
                    "prpt_div": prpt_div,
                    "reg_org_nm": reg_org_nm,
                    "bid_status": bid_status,
                    "bid_start_date": bid_start_date,
                    "bid_end_date": bid_end_date,
                    "detail_url": detail_url,
                    "deposit_note": f"입찰보증금 통상 10% (약 {format_krw(deposit_req)}) · 온비드 공고문 확인",
                    "land_area_m2": land_m2,
                    "bld_area_m2": bld_m2,
                }
                ai_analysis = {
                    "score": 82 if safety_grade == "GREEN" else (70 if safety_grade == "YELLOW" else 58),
                    "grade": "A" if safety_grade == "GREEN" else ("B" if safety_grade == "YELLOW" else "C"),
                    "verdict": f"온비드 {prpt_div} 매각 물건 ({reg_org_nm}) · {bid_status}",
                    "suggested_bid": f"{format_krw(min_bid)} 부근 (공고문 조건 확인 후 응찰)",
                    "expected_yield": "",
                    "key_points": [
                        f"공고기관: {reg_org_nm} ({prpt_div})",
                        f"입찰기간: {bid_start_date} ~ {bid_end_date}",
                        f"최저입찰가 {format_krw(min_bid)}" + (f" (감정가 대비 -{discount_pct}%)" if discount_pct > 0 else ""),
                    ],
                    "risks": [
                        "온비드 공매는 인도명령 제도가 없어 명도소송·협의가 필요할 수 있습니다.",
                        "입찰 전 온비드 원문 공고문에서 배분요구 종기·임차인·미납세금 인수 여부를 꼭 확인하세요.",
                    ],
                    "extinguished_rights": ["공고문상 말소 대상 권리 (온비드 공고 확인)"],
                    "retained_rights": ["인수 조건 여부 온비드 공고문 확인 필수"],
                    "analysis_detail": f"캠코 온비드({reg_org_nm})에서 진행 중인 {prpt_div} 매각 공매 물건입니다. 입찰 마감은 {bid_end_date}({d_day_str})입니다.",
                    "malso_right": None,
                    "assumed_deposit": 0,
                    "assumed_deposit_str": "0원",
                    "senior_unknown_count": 0,
                }
                onbid_rental = None
                if naver_indexes is not None and pyeong > 0 and usage_label != "토지":
                    onbid_rental = estimate_rental_and_yield(
                        row={"location": location, "est_monthly_rent": 0, "tenant_deposit": 0},
                        usage_label=usage_label,
                        min_bid=min_bid,
                        appraisal=appraisal,
                        pyeong=pyeong,
                        sgg=addr_sgg,
                        emd=addr_emd,
                        naver_indexes=naver_indexes,
                        rent_by_sgg_usage=rent_by_sgg_usage or {},
                    )
                onbid_yield_tier = classify_yield_tier(onbid_rental, is_lease=False)

                items_out.append({
                    "case_number": case_no,
                    "source_type": "onbid_sale",
                    "source_badge": "[공매 · 매각]",
                    "disposal_method": "매각",
                    "onbid_info": onbid_info,
                    "headline": headline,
                    "safety_grade": safety_grade,
                    "difficulty": difficulty,
                    "gap_amount": gap,
                    "gap_amount_str": format_krw(gap),
                    "gap_short_str": gap_short,
                    "ref_price_name": "감정가" if appraisal_raw > min_bid else "예정가",
                    "market_price": 0,
                    "market_price_str": "",
                    "summary_bullets": bullets,
                    "card_tags": [f"공매 · 매각", f"📍 {short_loc}", d_day_str],
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
                    "failed_count": 0,
                    "auction_date": end_date_ymd,
                    "d_day": d_day_str,
                    "lat": lat_f,
                    "lng": lng_f,
                    "photo_url": photo_url,
                    "photos": [photo_url],
                    "photo_source": "stock",
                    "photo_source_label": "🏛️ 온비드 공매 (참고 이미지)",
                    "ai_analysis": ai_analysis,
                    "bid_history": [],
                    "rental_estimate": onbid_rental,
                    "yield_tier": onbid_yield_tier,
                    "area_winning_stats": None,
                    "raw_court_data": None,
                    "court_name": reg_org_nm,
                })
            else:
                # ── 공매 · 임대(대부) — 매매 전용 지표(감정가·안전마진·할인율·매매 수익률) 제외 ──
                annual_fee = min_bid
                annual_fee_str = format_krw(annual_fee)
                est_monthly = max(10_000, int(round((annual_fee / 12) / 10_000) * 10_000))
                est_monthly_str = format_krw(est_monthly)
                est_monthly_short = format_krw_short(est_monthly)
                deposit_req = int(annual_fee * 0.05)

                headline = f"{short_loc} {pyeong_short}{usage_label} 공공임대 · 월 환산 {est_monthly_short} ({reg_org_nm})"
                bullets = [
                    f"🏛️ {reg_org_nm} · {prpt_div} 임대(대부)",
                    f"🔑 예정 사용료(연/기간) {annual_fee_str} · 월 환산 약 {est_monthly_str}",
                    f"📅 입찰 마감 {bid_end_date[:10] or '공고 확인'} ({d_day_str}) · 입찰보증금 5~10%",
                ]
                onbid_info = {
                    "cltr_no": cltr_no,
                    "onbid_cltr_no": str(row.get("onbid_cltr_no") or ""),
                    "prpt_div": prpt_div,
                    "reg_org_nm": reg_org_nm,
                    "bid_status": bid_status,
                    "bid_start_date": bid_start_date,
                    "bid_end_date": bid_end_date,
                    "detail_url": detail_url,
                    "annual_fee": annual_fee,
                    "annual_fee_str": annual_fee_str,
                    "est_monthly_fee": est_monthly,
                    "est_monthly_fee_str": est_monthly_str,
                    "deposit_note": f"입찰보증금 통상 5~10% (약 {format_krw(deposit_req)}~{format_krw(deposit_req * 2)}) · 공고문 확인",
                    "lease_period_note": "공공 임대·사용수익허가 (통상 1~5년 · 온비드 공고문 확인)",
                    "land_area_m2": land_m2,
                    "bld_area_m2": bld_m2,
                }
                items_out.append({
                    "case_number": case_no,
                    "source_type": "onbid_lease",
                    "source_badge": "[공매 · 임대]",
                    "disposal_method": "임대",
                    "onbid_info": onbid_info,
                    "headline": headline,
                    "safety_grade": "GREEN",
                    "difficulty": "BEGINNER",
                    "gap_amount": 0,
                    "gap_amount_str": "",
                    "gap_short_str": "",
                    "ref_price_name": "예정 사용료",
                    "market_price": 0,
                    "market_price_str": "",
                    "summary_bullets": bullets,
                    "card_tags": ["공매 · 임대", f"월 환산 {est_monthly_short}", d_day_str],
                    "min_bid": annual_fee,
                    "min_bid_str": annual_fee_str,
                    "appraisal": 0,
                    "appraisal_str": "",
                    "discount_pct": 0,
                    "deposit_required": deposit_req,
                    "deposit_required_str": format_krw(deposit_req),
                    "usage": usage_label,
                    "area_pyeong": pyeong,
                    "location": location,
                    "short_location": short_loc,
                    "floor": int(row.get("floor") or 1),
                    "failed_count": 0,
                    "auction_date": end_date_ymd,
                    "d_day": d_day_str,
                    "lat": lat_f,
                    "lng": lng_f,
                    "photo_url": photo_url,
                    "photos": [photo_url],
                    "photo_source": "stock",
                    "photo_source_label": "🔑 온비드 공공임대 (참고 이미지)",
                    "ai_analysis": None,
                    "bid_history": [],
                    "rental_estimate": None,
                    "yield_tier": "NONE",
                    "area_winning_stats": None,
                    "raw_court_data": None,
                    "court_name": reg_org_nm,
                })

            if len(items_out) >= max_rows:
                break

        return items_out

    sales = _fetch_by_disposal("매각", 1_000_000, sale_limit)
    leases = _fetch_by_disposal("임대", 100_000, lease_limit)
    conn.close()

    print(f"🏛️ 온비드 공매 연동: 매각 {len(sales)}건 · 임대 {len(leases)}건 (수도권 활성 매물)")
    results.extend(sales)
    results.extend(leases)
    return results


def main():
    print("🚀 [export_mobile_feed] DB 활성 매물(경매 + 온비드 공매 매각/임대) 피드 생성 중...")
    items = generate_feed(limit=None)

    auction_cnt = sum(1 for i in items if i.get("source_type", "auction") == "auction")
    onbid_sale_cnt = sum(1 for i in items if i.get("source_type") == "onbid_sale")
    onbid_lease_cnt = sum(1 for i in items if i.get("source_type") == "onbid_lease")
    green_cnt = sum(1 for i in items if i["safety_grade"] == "GREEN")
    yellow_cnt = sum(1 for i in items if i["safety_grade"] == "YELLOW")
    red_cnt = sum(1 for i in items if i["safety_grade"] == "RED")
    rental_cnt = sum(1 for i in items if i.get("rental_estimate"))
    high_yield_cnt = sum(1 for i in items if i.get("yield_tier") == "HIGH")
    mid_yield_cnt = sum(1 for i in items if i.get("yield_tier") == "MID")
    low_yield_cnt = sum(1 for i in items if i.get("yield_tier") == "LOW")
    capital_gain_cnt = sum(
        1 for i in items
        if i.get("source_type", "auction") != "onbid_lease" and i.get("yield_tier") == "NONE"
    )
    win_stat_cnt = sum(1 for i in items if i.get("area_winning_stats"))

    meta = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_count": len(items),
        "auction_count": auction_cnt,
        "onbid_sale_count": onbid_sale_cnt,
        "onbid_lease_count": onbid_lease_cnt,
        "green_count": green_cnt,
        "yellow_count": yellow_cnt,
        "red_count": red_cnt,
        "rental_matched_count": rental_cnt,
        "high_yield_count": high_yield_cnt,
        "mid_yield_count": mid_yield_cnt,
        "low_yield_count": low_yield_cnt,
        "capital_gain_count": capital_gain_cnt,
        "area_stats_matched_count": win_stat_cnt,
        "items": items,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(APP_OUTPUT_PATH), exist_ok=True)
    with open(APP_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✅ mobile_feed.json 생성 완료: 총 {len(items)}건 (경매 {auction_cnt} · 공매 매각 {onbid_sale_cnt} · 공매 임대 {onbid_lease_cnt})")
    print(f"   🟢 초급(GREEN): {green_cnt}건 | 🟡 중급(YELLOW): {yellow_cnt}건 | 🔴 고수(RED): {red_cnt}건")
    print(f"   🔥 수익률 구분: 고수익(8%↑) {high_yield_cnt}건 | 중수익(5~8%) {mid_yield_cnt}건 | 저수익(<5%) {low_yield_cnt}건 | 일반·시세차익 {capital_gain_cnt}건")
    print(f"   📊 인근 전월세 매칭: {rental_cnt}건 | 🏆 인근 낙찰통계 매칭: {win_stat_cnt}건")
    print(f"   저장 경로 1: {OUTPUT_PATH}")
    print(f"   저장 경로 2: {APP_OUTPUT_PATH}")

    print("\n📋 [샘플 3건 미리보기]")
    for idx, sample in enumerate(items[:3], 1):
        print(f"\n[{idx}] {sample['source_badge']} {sample['headline']} ({sample['difficulty']})")
        ai_info = sample.get("ai_analysis") or {}
        print(f"    사건번호: {sample['case_number']} | 금액: {sample['min_bid_str']} | AI: {ai_info.get('score', '-')}점({ai_info.get('grade', '-')})")
        if sample.get("rental_estimate"):
            re_d = sample["rental_estimate"]
            print(f"    임대추정: 보증금 {re_d['est_deposit_str']} / 월세 {re_d['est_monthly_rent_str']} (연 {re_d['annual_yield_pct']}%, {re_d['source_label']})")
        if sample.get("area_winning_stats"):
            ws = sample["area_winning_stats"]
            print(f"    인근낙찰: {ws['region_label']} {ws['sample_count']}건 평균 낙찰가율 {ws['avg_winning_rate']}% (평균 {ws['avg_bidder_count']}명)")


if __name__ == "__main__":
    main()
