"""
Market Matcher & Safety Margin Engine
경매 물건 ↔ 네이버 부동산 시세 비교 및 진짜 안전마진 계산 모듈

핵심 로직:
1. 선순위 인수 보증금 계산:
   - 대항력 있는 선순위 임차인이 배당요구를 하지 않았거나 전액 배당받지 못하는 보증금 합산
2. 네이버 부동산 실매물 매칭:
   - 1순위: 동일동 (법정동 코드 또는 시/구 + 동/읍/면 일치, 전용면적 ±40%)
   - 2순위: 동일구 (시/구 일치, 전용면적 ±40%)
   - 3순위: 동일시 (시/군 일치, 전용면적 ±40%)
3. 진짜 안전마진 (Net Safety Margin) 산출:
   - 진짜 안전마진 = 네이버 추정 시세 - 최저입찰가 - 선순위 인수 보증금
   - 실질 할인율 = (네이버 시세 - 최저입찰가 - 인수보증금) / 네이버 시세 * 100
4. 임대수익률 산출:
   - 동일 지역 월세 매물 기반 예상 월세 및 연간 임대수익률 계산
"""

import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

PYEONG = 3.3058

# 물건 종류(주거용/상업용) 구분 키워드
RESIDENTIAL_KEYWORDS = [
    "아파트", "오피스텔", "다세대", "빌라", "연립", "맨션", "하이츠",
    "단독주택", "다가구", "주거용", "도시형생활주택",
]
COMMERCIAL_KEYWORDS = [
    "상가", "근린", "점포", "판매시설", "업무용", "사무실", "사무용",
    "지식산업", "프라자", "플라자", "비즈타워", "오피스", "창고", "공장",
]
# 네이버 부동산 상가(상업용) realEstateType 코드
COMMERCIAL_REALTY_CODES = ("D02", "D03", "D04", "E01", "Z00")


def classify_property_type(usage: str = "", location: str = "") -> str:
    """물건을 시세 비교군이 같은 유형끼리 묶기 위한 분류 (residential/commercial/mixed/unknown)

    아파트·오피스텔·다세대 등 주거용 물건의 시세를 일반상가(D02) 호가와 비교하면
    전혀 다른 상품을 비교하게 되어 안전마진이 수억 원 단위로 부풀려진다.
    """
    u = str(usage or "").strip()
    loc = str(location or "").strip()

    # 차량·선박 등 부동산이 아닌 물건은 시세 비교 대상이 아니다
    if any(k in loc for k in ("차대번호", "차종", "자동차", "Mercedes", "BMW")) \
            or any(k in u for k in ("차량", "자동차", "선박", "중기")):
        return "car"

    # 상가주택/근린주택은 1층 상가 + 주거 복합이므로 상업용 비교군을 허용
    if any(k in u or k in loc for k in ("상가주택", "근린주택", "겸용주택")):
        return "mixed"

    # 단지내상가/상가동 등은 아파트 단지 안이어도 상업용
    if any(k in loc for k in ("단지내상가", "단지상가", "상가동", "근린상가", "지하도상가", "지하상가")):
        return "commercial"

    # 1) 공적 용도(usage) 최우선
    if u and not re.fullmatch(r"\d+", u):
        if any(k in u for k in RESIDENTIAL_KEYWORDS) and "상가" not in u:
            return "residential"
        if any(k in u for k in COMMERCIAL_KEYWORDS):
            return "commercial"
        if any(k in u for k in ("토지", "대지", "임야", "전", "답")):
            return "unknown"

    # 2) 소재지 기반
    if any(k in loc for k in ("상가", "근린생활", "근린시설", "점포")):
        return "commercial"
    if any(k in loc for k in RESIDENTIAL_KEYWORDS):
        return "residential"
    if any(k in loc for k in COMMERCIAL_KEYWORDS):
        return "commercial"
    return "unknown"


def _is_commercial_listing(listing: Dict[str, Any]) -> bool:
    """네이버 실매물이 상업용(상가 등)인지 여부"""
    realty_cd = str(listing.get("realty_type_cd") or "")
    if realty_cd in COMMERCIAL_REALTY_CODES:
        return True
    name = str(listing.get("article_name") or "")
    return any(k in name for k in ("상가", "근린", "점포", "사무실", "오피스", "빌딩"))


def _parse_share_ratio(text: str) -> Optional[float]:
    """'2분의 1', '1/2 지분' 등의 표기에서 지분 비율(0~1)을 계산"""
    if not text:
        return None
    # '2분의 1' → 1/2
    for m in re.finditer(r"(\d+)\s*분의\s*(\d+)", text):
        den, num = int(m.group(1)), int(m.group(2))
        if den > 0 and 0 < num <= den:
            return num / den
    # '1/2 지분', '지분 1/2'
    for m in re.finditer(r"(\d+)\s*/\s*(\d+)\s*지분", text):
        num, den = int(m.group(1)), int(m.group(2))
        if den > 0 and 0 < num <= den:
            return num / den
    for m in re.finditer(r"지분\s*(\d+)\s*/\s*(\d+)", text):
        num, den = int(m.group(1)), int(m.group(2))
        if den > 0 and 0 < num <= den:
            return num / den
    return None


def detect_share_sale(item: Dict[str, Any]) -> Tuple[bool, Optional[float]]:
    """지분매각 물건 여부와 지분 비율을 판별

    Returns:
        (is_share_sale, share_ratio)  # 비율을 특정할 수 없으면 None
    """
    texts: List[str] = []
    for key in ("remarks", "location", "special_rights", "ai_verdict", "ai_report_json"):
        val = item.get(key)
        if not val:
            continue
        if isinstance(val, str):
            texts.append(val)
        else:
            try:
                texts.append(json.dumps(val, ensure_ascii=False))
            except Exception:
                texts.append(str(val))

    ratio: Optional[float] = None

    # 매각물건 목록(dspslStk...)의 지분 분자/분모가 가장 정확하다
    objs = item.get("dspsl_objects") or item.get("dspsl_object_list")
    if isinstance(objs, list):
        for obj in objs:
            if not isinstance(obj, dict):
                continue
            try:
                nmrt = int(obj.get("dspslStkNmrtVal") or 0)
                dnmn = int(obj.get("dspslStkDnmnVal") or 0)
            except (TypeError, ValueError):
                continue
            if nmrt > 0 and dnmn > 0 and nmrt < dnmn:
                ratio = nmrt / dnmn
                break

    text = " ".join(texts)

    has_share_tag = re.search(r'"id"\s*:\s*"share"', text) is not None
    has_share_phrase = re.search(
        r"(지분\s*매각|지분매각|지분\s*경매|공유지분|지분\s*전부|지분\s*일부|"
        r"\d+\s*분의\s*\d+|\d+\s*/\s*\d+\s*지분|지분\s*\d+\s*/\s*\d+)",
        text,
    ) is not None

    is_share_sale = has_share_tag or has_share_phrase
    if not is_share_sale:
        return False, None

    if ratio is None:
        ratio = _parse_share_ratio(text)
    return True, ratio


def extract_assumed_deposit_info(item: Dict[str, Any]) -> Tuple[int, bool, str]:
    """
    선순위 임차인 인수 보증금 총액 계산 및 미상 인수 리스크 판정
    Returns:
        (senior_deposit: int, is_unknown_senior_risk: bool, reason: str)
    """
    assumed = 0
    is_unknown_senior_risk = False
    reasons = []

    tenant_deposit = item.get("tenant_deposit") or 0
    is_payout_requested = bool(item.get("is_payout_requested"))
    ai_verdict = str(item.get("ai_verdict") or "")
    remarks = str(item.get("remarks") or "")
    rights_list = str(item.get("rights_list") or "")

    # 말소기준일자 추출
    clean_malso = ""
    if rights_list:
        try:
            rl = json.loads(rights_list) if isinstance(rights_list, str) else rights_list
            if isinstance(rl, list):
                malso_kw = ["담보가등기", "근저당", "가압류", "경매개시결정", "경매개시", "압류", "저당"]
                m_candidates = []
                for r in rl:
                    if any(k in r.get("name", "") for k in malso_kw) and r.get("date"):
                        cd = re.sub(r"[^0-9]", "", r["date"])
                        if len(cd) >= 8:
                            m_candidates.append(cd[:8])
                if m_candidates:
                    clean_malso = min(m_candidates)
        except Exception:
            pass

    has_explicit_assumption = any(k in remarks or k in rights_list for k in [
        "주택임차권", "임차권등기", "매수인 인수", "매수인이 인수", "보증금 인수", "선순위 임차권"
    ])

    is_explicit_safe = (
        ("SAFE" in ai_verdict or
         "대항력 있는 임차인이 확인되지 않습니다" in ai_verdict or
         "소유자/채무자 점유" in ai_verdict or
         "후순위 임차인" in ai_verdict or
         "권리 소멸" in ai_verdict)
        and not has_explicit_assumption
    )

    # 1. ai_report_json 내 tenants 상세 분석
    report_raw = item.get("ai_report_json")
    if report_raw:
        try:
            report = json.loads(report_raw) if isinstance(report_raw, str) else report_raw
            retained = report.get("retained_rights", [])
            has_no_retained = (isinstance(retained, list) and len(retained) == 1 and retained[0] == "없음")

            tenants = report.get("tenants", [])
            if isinstance(tenants, list) and tenants:
                tenant_sum = 0
                has_unknown_senior = False
                for t in tenants:
                    dep = t.get("deposit")
                    payout_req = t.get("is_payout_requested", False)
                    t_date = re.sub(r"[^0-9]", "", t.get("move_in_date") or "")

                    # 말소기준권리와 비교하여 선순위 여부 검증
                    is_senior = False
                    if clean_malso and len(t_date) >= 8:
                        is_senior = (t_date < clean_malso)
                    else:
                        # 날짜가 없거나 불명인 경우
                        if is_explicit_safe or has_no_retained:
                            is_senior = False
                        else:
                            is_senior = True

                    # 배당요구를 하지 않은 선순위 임차인인 경우만 인수 대상
                    if is_senior and not payout_req:
                        if isinstance(dep, (int, float)) and dep > 0:
                            tenant_sum += int(dep)
                        elif isinstance(dep, str):
                            clean_dep = re.sub(r"[^0-9]", "", dep)
                            if clean_dep:
                                val = int(clean_dep)
                                if "억" in dep or "만" in dep:
                                    if "억" in dep and "만" in dep:
                                        m = re.search(r"(\d+)억\s*(\d+)만", dep)
                                        if m:
                                            val = (int(m.group(1)) * 10000 + int(m.group(2))) * 10000
                                    elif "억" in dep:
                                        m = re.search(r"(\d+)억", dep)
                                        if m:
                                            val = int(m.group(1)) * 100000000
                                    elif "만" in dep:
                                        m = re.search(r"(\d+)만", dep)
                                        if m:
                                            val = int(m.group(1)) * 10000
                                tenant_sum += val
                            elif "미상" in dep or not clean_dep:
                                has_unknown_senior = True
                        else:
                            has_unknown_senior = True

                if tenant_sum > 0:
                    assumed = max(assumed, tenant_sum)
                    reasons.append(f"선순위 임차인 미배당 보증금 {assumed:,}원 인수")
                elif has_unknown_senior and not is_explicit_safe:
                    is_unknown_senior_risk = True
                    reasons.append("선순위 임차인 배당요구 미신청(보증금 미상)으로 전액 인수 위험")
        except Exception:
            pass

    # 2. ai_report_json에 없거나 계산 안 된 경우 기본 tenant_deposit 검토
    if assumed == 0 and tenant_deposit > 0 and not is_explicit_safe:
        if not is_payout_requested or "인수" in ai_verdict or "대항력" in ai_verdict:
            assumed = int(tenant_deposit)
            reasons.append(f"대항력 임차보증금 {assumed:,}원 인수")

    # 3. ai_verdict 및 비고란에서 명시적 인수 리스크 키워드 탐색
    senior_risk_keywords = ["대항력 있는 선순위 임차인", "보증금 전액 인수 위험", "선순위 임차인 미배당", "보증금 인수 위험", "선순위 임차보증금 인수", "주택임차권", "매수인 인수", "임차권등기"]
    has_verdict_risk = (
        any(k in ai_verdict for k in senior_risk_keywords) or
        any(k in remarks for k in ["보증금 전액 인수", "대항력 있는 임차인", "매수인 인수", "매수인이 인수", "주택임차권", "임차권등기"]) or
        has_explicit_assumption
    )
    
    if has_verdict_risk:
        if assumed == 0:
            # 보증금 텍스트 추출 시도 (예: 3.8억, 3억 8,000만원, 380,000,000원)
            all_text = f"{ai_verdict} {remarks} {rights_list}"
            m_amt = re.search(r"(?:보증금|임차보증금)[^\d]{0,10}(\d+(?:\.\d+)?억(?:\s*\d+만)?|\d+만|\d{1,3}(?:,\d{3})+)", all_text)
            if m_amt:
                amt_str = m_amt.group(1)
                val = 0
                if "억" in amt_str and "만" in amt_str:
                    m = re.search(r"(\d+(?:\.\d+)?)억\s*(\d+)만", amt_str)
                    if m:
                        val = int(float(m.group(1)) * 100000000 + int(m.group(2)) * 10000)
                elif "억" in amt_str:
                    m = re.search(r"(\d+(?:\.\d+)?)억", amt_str)
                    if m:
                        val = int(float(m.group(1)) * 100000000)
                elif "만" in amt_str:
                    m = re.search(r"(\d+)만", amt_str)
                    if m:
                        val = int(m.group(1)) * 10000
                elif "," in amt_str:
                    clean_n = amt_str.replace(",", "")
                    if clean_n.isdigit():
                        val = int(clean_n)

                if val > 0:
                    assumed = val
                    reasons.append(f"비고란/권리내역 기반 선순위 보증금 {assumed:,}원 인수")
                else:
                    is_unknown_senior_risk = True
                    reasons.append("대항력 선순위 임차인 보증금 미상(인수 위험)")
            else:
                if tenant_deposit > 0:
                    assumed = int(tenant_deposit)
                    reasons.append(f"선순위 보증금 {assumed:,}원 인수")
                else:
                    is_unknown_senior_risk = True
                    reasons.append("대항력 있는 선순위 임차인 보증금 전액 인수 위험")

    final_reason = " / ".join(reasons) if reasons else ("인수 보증금 없음" if assumed == 0 and not is_unknown_senior_risk else "권리 인수 주의")
    return assumed, is_unknown_senior_risk, final_reason


def extract_assumed_deposit(item: Dict[str, Any]) -> int:
    """기존 호환성 유지용"""
    assumed, _, _ = extract_assumed_deposit_info(item)
    return assumed


class MarketMatcher:
    def __init__(self, db_path: str = "auction_db.sqlite"):
        self.db_path = db_path
        self.naver_listings: List[Dict[str, Any]] = []
        self._load_naver_listings()

    def _load_naver_listings(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                       trade_type, trade_type_cd, realty_type_cd, area_m2, area_pyeong,
                       price_sale_10k, deposit_10k, monthly_rent_10k,
                       floor, total_floor, detail_url, article_name
                FROM naver_listings
                WHERE area_m2 > 0
            """).fetchall()
        self.naver_listings = [dict(r) for r in rows]

    def match_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """
        단일 경매 물건에 대해 네이버 시세 및 안전마진을 계산하여 반환
        """
        raw_area_m2 = float(item.get("area_m2") or 0.0)
        min_bid = int(item.get("min_bid") or 0)
        appraisal = int(item.get("appraisal") or 0)
        item_floor = item.get("floor")

        # 주거용(아파트·오피스텔·다세대)과 상업용(상가)은 시세 비교군이 다르다
        property_category = classify_property_type(str(item.get("usage") or ""), str(item.get("location") or ""))
        # 지분매각 물건: 시세는 '전체 물건' 기준이므로 지분 비율만큼 환산해야 한다
        is_share_sale, share_ratio = detect_share_sale(item)

        adiv = str(item.get("legal_div_no") or "")
        aemd = str(item.get("addr_emd") or "")
        asgg = str(item.get("addr_sgg") or "")
        loc = str(item.get("location") or "")
        sido = loc.split()[0] if loc else ""

        # location에서 시군구/읍면동 보조 추출
        if not asgg and loc:
            m_sgg = re.search(r"([가-힣]+시\s+[가-힣]+구|[가-힣]+구|[가-힣]+시|[가-힣]+군)", loc)
            if m_sgg:
                asgg = m_sgg.group(1)
        if not aemd and loc:
            m_emd = re.search(r"([가-힣0-9]+동|[가-힣]+읍|[가-힣]+면)\b", loc)
            if m_emd:
                aemd = m_emd.group(1)

        # 집합건물(호실)인데 대지 전체 면적(300㎡ 초과)이 들어간 경우 전용면적 미상으로 간주
        is_unit = "호" in loc
        area_m2 = 0.0 if (is_unit and raw_area_m2 > 300.0) else raw_area_m2

        # 면적 범위 설정 (면적 정보가 있을 경우 ±40%)
        has_area = area_m2 > 0
        min_area = area_m2 * 0.6 if has_area else 10.0
        max_area = area_m2 * 1.4 if has_area else (250.0 if is_unit else 999999.0)

        matched_emd_sale = []
        matched_sgg_sale = []
        matched_sido_sale = []

        matched_emd_rent = []
        matched_sgg_rent = []
        matched_sido_rent = []

        usage_str = str(item.get("usage") or "").strip()
        is_villa_item = any(k in usage_str or k in loc for k in ["다세대", "빌라", "연립"])
        # 노유자복지시설, 복지시설, 종교시설, 공장, 창고 등 특수용도 시설 엄격 판별
        FACILITY_CATEGORY_MAP = {
            "노유자": ["노유자", "복지시설", "피더하우스", "실버타운", "요양원", "요양시설"],
            "복지": ["노유자", "복지시설", "피더하우스", "실버타운", "요양원", "요양시설"],
            "종교": ["종교시설", "교회", "사찰", "성당"],
            "교회": ["종교시설", "교회", "사찰", "성당"],
            "공장": ["공장", "제조장", "아파트형공장", "지식산업센터"],
            "창고": ["물류창고", "전용창고", "창고용지"],
            "위락": ["위락시설", "유흥"],
            "숙박": ["숙박시설", "호텔", "모텔", "펜션", "게스트하우스"],
            "주유소": ["주유소", "충전소"],
            "목욕탕": ["목욕탕", "사우나", "스파"]
        }
        target_facility_kws = []
        for cat, kws in FACILITY_CATEGORY_MAP.items():
            if cat in usage_str or cat in loc:
                target_facility_kws.extend(kws)
        # 중복 제거
        target_facility_kws = list(dict.fromkeys(target_facility_kws))
        is_special_facility = bool(target_facility_kws)

        for n in self.naver_listings:
            n_area = float(n.get("area_m2") or 0.0)
            if not (min_area <= n_area <= max_area):
                continue

            n_realty = n.get("realty_type_cd") or ""
            n_name = str(n.get("article_name") or "")
            # 특수용도(노유자복지시설 등)인 경우 동종 비교군이 없으면 일반 상가(D02)/빌라 호가 매칭 원천 차단
            if is_special_facility:
                if not any(k in n_name for k in target_facility_kws):
                    continue

            # 주거용 물건에 상가(D02) 호가를 시세로 쓰는 오매칭 원천 차단 / 부동산 아닌 물건도 제외
            if property_category in ("residential", "car") and _is_commercial_listing(n):
                continue
            if property_category == "car":
                continue

            # 빌라인 경우 네이버 빌라(C02, C03, VL) 우선 매칭
            if is_villa_item:
                if n_realty not in ("C02", "C03", "VL"):
                    continue
            else:
                # 상가 호실인 경우 일반상가(D02) 우선 매칭, 빌라는 제외
                if is_unit and n_realty not in ("D02", None, ""):
                    continue
                elif n_realty in ("C02", "C03", "VL"):
                    continue

            n_div = str(n.get("legal_div_no") or "")
            n_emd = str(n.get("addr_emd") or "")
            n_sgg = str(n.get("addr_sgg") or "")
            n_rn = str(n.get("region_name") or "")
            trade_cd = str(n.get("trade_type_cd") or "")

            is_emd = False
            is_sgg = False
            is_sido = False

            # 1. 동일동 매칭 (법정동코드 일치 또는 동일 시/구 + 읍/면/동)
            if (adiv and n_div == adiv) or (aemd and n_emd == aemd and (not asgg or n_sgg == asgg or asgg in n_sgg or n_sgg in asgg)):
                is_emd = True
            # 2. 동일구 매칭
            elif asgg and (n_sgg == asgg or asgg in n_sgg or n_sgg in asgg):
                is_sgg = True
            # 3. 동일시 매칭
            elif sido and (n_rn.startswith(sido) or sido in n_rn or (asgg and asgg[:2] in n_sgg)):
                is_sido = True

            if trade_cd == "A1" or n.get("trade_type") == "매매":
                if is_emd:
                    matched_emd_sale.append(n)
                elif is_sgg:
                    matched_sgg_sale.append(n)
                elif is_sido:
                    matched_sido_sale.append(n)

            elif trade_cd == "B2" or n.get("trade_type") == "월세":
                if is_emd:
                    matched_emd_rent.append(n)
                elif is_sgg:
                    matched_sgg_rent.append(n)
                elif is_sido:
                    matched_sido_rent.append(n)

        # 토지/임야 여부 검사 (상가/빌딩 단가 오적용 방지)
        is_land = bool(re.search(r'(산\s*\d+|임야|전\s*\d+|답\s*\d+|과수원|잡종지)', loc))

        # 매매 매칭 우선순위 선정 (토지는 일반 상가/빌딩 단가 매칭 제외)
        if not is_land and matched_emd_sale:
            chosen_sales = matched_emd_sale
            match_level = "동일동"
        elif not is_land and matched_sgg_sale:
            chosen_sales = matched_sgg_sale
            match_level = "동일구"
        elif not is_land and matched_sido_sale:
            chosen_sales = matched_sido_sale
            match_level = "동일시"
        else:
            chosen_sales = []
            if is_special_facility:
                match_level = "동종 비교군 없음 (매칭차단)"
            elif property_category == "residential":
                match_level = "주거용 실매물 없음 (매칭차단)"
            elif property_category == "car":
                match_level = "부동산 아님 (매칭차단)"
            else:
                match_level = "매칭없음"

        # 동일 층수(특히 1층 상가 vs 비1층 상가) 및 면적 유사도 순 정렬
        def _similarity_key(s: Dict[str, Any]):
            floor_diff = 0 if (item_floor and s.get("floor") == item_floor) else 1
            area_diff = abs(float(s.get("area_m2") or 0) - area_m2) if has_area else 0
            price_diff = abs((s.get("price_sale_10k") or 0) * 10000 - appraisal) if appraisal > 0 else 0
            return (floor_diff, area_diff, price_diff)

        chosen_sales.sort(key=_similarity_key)

        # 만약 ±40% 면적 필터 때문에 동일동/동일구 매칭이 비었다면, 면적 제한을 완화해 가장 비슷한 동일동/동일구 상가를 후보로 확보 (특수시설/토지는 제외)
        fallback_Candidates = []
        if not chosen_sales and not is_land and not is_special_facility and property_category != "car":
            for n in self.naver_listings:
                if (n.get("trade_type_cd") == "A1" or n.get("trade_type") == "매매") and (n.get("price_sale_10k") or 0) > 0:
                    # 면적 필터를 완화하더라도 상품 종류(주거용/상업용)가 다르면 비교군에서 제외
                    if property_category == "residential" and _is_commercial_listing(n):
                        continue
                    n_emd = str(n.get("addr_emd") or "")
                    n_sgg = str(n.get("addr_sgg") or "")
                    if (aemd and n_emd == aemd) or (asgg and (n_sgg == asgg or asgg in n_sgg or n_sgg in asgg)):
                        fallback_Candidates.append(n)
            fallback_Candidates.sort(key=_similarity_key)

        # 시세 단가 계산 (원/㎡)
        valid_sales = [s for s in chosen_sales if (s.get("price_sale_10k") or 0) > 0 and (s.get("area_m2") or 0) > 0]
        display_sales = [] if is_special_facility else (valid_sales if valid_sales else fallback_Candidates)
        market_price = 0
        min_market_price = 0
        price_from_listings = False
        if valid_sales:
            prices_per_m2 = [s["price_sale_10k"] * 10000 / s["area_m2"] for s in valid_sales]
            avg_ppm2 = sum(prices_per_m2) / len(prices_per_m2)
            min_ppm2 = min(prices_per_m2)
            
            if has_area:
                raw_mp = int(avg_ppm2 * area_m2)
                raw_min_mp = int(min_ppm2 * area_m2)
                price_from_listings = True
            elif appraisal > 0:
                # 전용면적이 미상인 호실은 감정가 근처(0.6~1.8배) 실매물 평균 또는 감정가 기준 보정
                near_sales = [s["price_sale_10k"] * 10000 for s in valid_sales if 0.5 * appraisal <= s["price_sale_10k"] * 10000 <= 1.8 * appraisal]
                if near_sales:
                    raw_mp = int(sum(near_sales) / len(near_sales))
                    raw_min_mp = int(min(near_sales))
                    price_from_listings = True
                else:
                    raw_mp = appraisal
                    raw_min_mp = int(appraisal * 0.85)
                    price_from_listings = False
            else:
                raw_mp = int(sum(s["price_sale_10k"] * 10000 for s in valid_sales) / len(valid_sales))
                raw_min_mp = int(min(s["price_sale_10k"] * 10000 for s in valid_sales))
                price_from_listings = True

            # 이상치 가드: 감정가 대비 0.35배 ~ 2.5배 이내인 경우만 정상 시세로 채택 (단, 비교 매물 리스트인 display_sales는 유지)
            if appraisal > 0:
                ratio = raw_mp / appraisal
                if 0.35 <= ratio <= 2.5:
                    market_price = raw_mp
                    min_market_price = raw_min_mp
                else:
                    match_level = "인근참고"
            else:
                market_price = raw_mp
                min_market_price = raw_min_mp

        # 지분매각 물건은 전체 물건 시세를 지분 비율만큼 환산해야 실제 취득 대상과 비교가 된다
        share_ratio_note = ""
        if is_share_sale:
            if share_ratio and 0 < share_ratio < 1 and market_price > 0 and price_from_listings:
                market_price = int(market_price * share_ratio)
                min_market_price = int(min_market_price * share_ratio)
                share_ratio_note = f" · 지분 {share_ratio:.0%} 환산"
                if len(display_sales) > 0 and match_level not in ("", None):
                    match_level = f"{match_level}{share_ratio_note}"

        # 월세 매칭 우선순위 선정
        if not is_land and matched_emd_rent:
            chosen_rents = matched_emd_rent
        elif not is_land and matched_sgg_rent:
            chosen_rents = matched_sgg_rent
        elif not is_land and matched_sido_rent:
            chosen_rents = matched_sido_rent
        else:
            chosen_rents = []

        valid_rents = [
            r for r in chosen_rents
            if (r.get("monthly_rent_10k") or 0) > 0 and (r.get("area_pyeong") or 0) > 0
        ]
        
        est_monthly_rent = 0
        rental_yield = 0.0
        area_pyeong = area_m2 / PYEONG if has_area else 0.0
        
        if valid_rents and (market_price > 0 or appraisal > 0) and not (is_special_facility and not valid_sales):
            avg_rpp = sum(r["monthly_rent_10k"] / r["area_pyeong"] for r in valid_rents) / len(valid_rents)
            avg_dep_10k = sum(r.get("deposit_10k") or 0 for r in valid_rents) / len(valid_rents)
            
            target_pyeong = area_pyeong if area_pyeong > 0 else sum(r["area_pyeong"] for r in valid_rents) / len(valid_rents)
            est_monthly_rent = int(avg_rpp * target_pyeong * 10000)
            
            denom = min_bid - int(avg_dep_10k * 10000)
            if denom > 0 and est_monthly_rent > 0:
                rental_yield = round((est_monthly_rent * 12 / denom) * 100, 2)

        # 선순위 인수 보증금 (여러 임차인 전액 합산 반영 및 미상 위험 방어)
        senior_deposit, is_unknown_senior_risk, senior_risk_reason = extract_assumed_deposit_info(item)
        net_cost = min_bid + senior_deposit

        # 안전마진 계산 (실질 매수원가 = 최저가 + 인수금액 반영)
        if is_special_facility and not valid_sales:
            # 특수용도(노유자복지시설 등)는 동종 비교군이 없으면 임의 상가 호가 매칭 및 안전마진 산출 차단
            safety_margin = 0
            market_discount_pct = 0.0
        elif is_unknown_senior_risk:
            # 🚨 보증금 미상의 대항력 있는 선순위 임차인이 있는 경우, 가짜 안전마진 생성 원천 차단
            safety_margin = 0
            market_discount_pct = 0.0
        elif market_price > 0:
            safety_margin = max(0, market_price - net_cost)
            market_discount_pct = round((market_price - net_cost) / market_price * 100, 1) if market_price > 0 and net_cost < market_price else 0.0
        else:
            # 네이버 매칭이 없는 경우 감정가 기준 보조 계산
            safety_margin = max(0, appraisal - net_cost) if appraisal > 0 and net_cost < appraisal else 0
            market_discount_pct = round((appraisal - net_cost) / appraisal * 100, 1) if appraisal > 0 and net_cost < appraisal else 0.0

        # 대표 비교 매물 (최대 5건)
        sample_listings = []
        for s in display_sales[:5]:
            sample_listings.append({
                "article_id": s.get("article_id"),
                "article_name": s.get("article_name") or f"{s.get('addr_emd','')} 매물",
                "trade_type": s.get("trade_type", "매매"),
                "price_sale_10k": s.get("price_sale_10k"),
                "area_m2": round(float(s.get("area_m2") or 0), 1),
                "area_pyeong": round(float(s.get("area_pyeong") or 0), 1),
                "floor": s.get("floor"),
                "total_floor": s.get("total_floor"),
                "detail_url": s.get("detail_url")
            })

        if len(display_sales) == 0 and is_share_sale and not share_ratio_note:
            match_level = f"{match_level} · 지분매각" if match_level and match_level != "미매칭" else "지분매각 (감정가 기준)"

        return {
            "market_price": market_price,
            "min_market_price": min_market_price,
            "safety_margin": safety_margin,
            "market_discount_pct": market_discount_pct,
            "market_match_count": len(display_sales),
            "market_match_level": match_level if (len(display_sales) > 0 or is_special_facility or property_category in ("residential", "car") or is_share_sale) else "미매칭",
            "property_category": property_category,
            "is_share_sale": is_share_sale,
            "share_ratio": share_ratio,
            "senior_deposit_assumed": senior_deposit,
            "is_senior_risk": is_unknown_senior_risk or (senior_deposit > 0),
            "is_unknown_senior_risk": is_unknown_senior_risk,
            "senior_risk_reason": senior_risk_reason,
            "net_cost": net_cost,
            "est_monthly_rent": est_monthly_rent,
            "rental_yield": rental_yield,
            "sample_listings": sample_listings,
        }

    def update_database(self) -> Dict[str, int]:
        """
        auction_items 테이블의 전체 물건에 대해 시세 및 안전마진 지표를 일괄 계산하여 저장
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            items = cursor.execute("""
                SELECT case_number, location, usage, appraisal, min_bid, area_m2, floor,
                       legal_div_no, addr_sgg, addr_emd, tenant_deposit,
                       is_payout_requested, ai_verdict, ai_report_json, remarks, rights_list,
                       special_rights
                FROM auction_items
            """).fetchall()
            
            stats = {"total": len(items), "matched": 0, "positive_margin": 0}
            
            update_data = []
            for row in items:
                item_dict = dict(row)
                metrics = self.match_item(item_dict)
                
                if metrics["market_match_count"] > 0:
                    stats["matched"] += 1
                if metrics["safety_margin"] > 0:
                    stats["positive_margin"] += 1
                    
                update_data.append((
                    metrics["market_price"],
                    metrics["safety_margin"],
                    metrics["market_discount_pct"],
                    metrics["market_match_count"],
                    metrics["market_match_level"],
                    metrics["est_monthly_rent"],
                    metrics["rental_yield"],
                    item_dict["case_number"]
                ))
            
            cursor.executemany("""
                UPDATE auction_items
                SET market_price = ?,
                    safety_margin = ?,
                    market_discount_pct = ?,
                    market_match_count = ?,
                    market_match_level = ?,
                    est_monthly_rent = ?,
                    rental_yield = ?
                WHERE case_number = ?
            """, update_data)
            
            conn.commit()
            return stats


if __name__ == "__main__":
    matcher = MarketMatcher()
    stats = matcher.update_database()
    print("Market Matcher Batch Update Complete:", stats)
