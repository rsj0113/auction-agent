"""지분매각·주거/상가 오매칭 회귀 테스트

배경(라이브 검증에서 발견):
- `2024타경51096`(신촌숲아이파크 1/2 지분, 아파트)에 마포구 일반상가(D02) 호가가
  시세로 매칭되어 시세 22.1억 · 안전마진 +12.6억 · SAFE로 잘못 표시되었다.
- 원인 1: 아파트/오피스텔 등 주거용 물건에 상가(D02) 실매물을 비교군으로 사용
  (면적 필터 완화 fallback 경로는 realty_type 자체를 무시했다).
- 원인 2: 지분매각 물건인데 '전체 물건' 시세를 지분 비율로 환산하지 않았다.
"""

import sqlite3

import pytest

from core.market_matcher import (
    MarketMatcher,
    classify_property_type,
    detect_share_sale,
)


DB_PATH = "auction_db.sqlite"


def _load_item(case_number: str):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM auction_items WHERE case_number = ?", (case_number,)).fetchone()
    conn.close()
    return dict(row) if row else None


def test_detect_share_sale_parses_share_ratio():
    """지분매각 표기별 지분 비율 파싱"""
    # 매각물건명세서 비고란 표기 (2024타경51096 실제 값)
    is_share, ratio = detect_share_sale(
        {"remarks": "[지분매각 내역]\n갑구 1번 지분 2분의 1 전부\n\n[지상권 관련 내역]\n해당사항없음"}
    )
    assert is_share is True
    assert ratio == pytest.approx(0.5)

    # 분수 표기
    assert detect_share_sale({"remarks": "갑구 3번 지분 1/3 매각"})[1] == pytest.approx(1 / 3)
    assert detect_share_sale({"location": "서울 마포구 신수동 123 (지분 3/4)"})[1] == pytest.approx(0.75)

    # 물건 목록(dspslStk...)의 분자/분모가 있으면 그 값을 최우선
    _, ratio_obj = detect_share_sale(
        {
            "remarks": "지분매각",
            "dspsl_objects": [{"dspslStkCtt": "지분", "dspslStkNmrtVal": 1, "dspslStkDnmnVal": 2}],
        }
    )
    assert ratio_obj == pytest.approx(0.5)

    # 지분매각이 아닌 물건은 False
    assert detect_share_sale({"remarks": "특이사항 없음", "usage": "아파트"}) == (False, None)


def test_classify_property_type_separates_residential_and_commercial():
    assert classify_property_type("아파트", "서울 마포구 신수동 신촌숲아이파크 103동 22층2204호") == "residential"
    assert classify_property_type("오피스텔", "") == "residential"
    assert classify_property_type("다세대/빌라", "") == "residential"
    assert classify_property_type("상가/근린시설", "") == "commercial"
    # 아파트 단지 내 상가는 상업용
    assert classify_property_type("", "분당구 정자동 아파트단지내상가 101호") == "commercial"
    # 상가주택·근린주택은 복합
    assert classify_property_type("상가주택", "") == "mixed"
    # 차량 등 부동산이 아닌 물건
    assert classify_property_type("차량/기타", "경기 성남시 분당구 (차대번호: WDD1760121J123456)") == "car"


def test_share_sale_apartment_is_not_matched_with_commercial_listings():
    """2024타경51096: 지분매각 아파트에 일반상가 시세가 매칭되어 +12.6억 마진이 나오지 않아야 한다"""
    item = _load_item("2024타경51096")
    if not item:
        pytest.skip("2024타경51096 물건이 DB에 없습니다")

    res = MarketMatcher().match_item(item)

    assert res["is_share_sale"] is True
    assert res["share_ratio"] == pytest.approx(0.5)
    assert res["property_category"] == "residential"
    # 일반상가 호가가 시세로 쓰이지 않아야 함
    assert res["market_price"] == 0
    assert res["market_match_count"] == 0
    assert res["safety_margin"] == 0
    assert res["market_discount_pct"] == 0.0
    assert "지분매각" in res["market_match_level"]


def test_residential_item_never_uses_commercial_asking_prices():
    """면적 필터 완화(fallback) 경로에서도 아파트에 상가(D02) 호가를 쓰지 않아야 한다"""
    item = {
        "case_number": "2024타경99999",
        "location": "서울특별시 마포구 신수동 신촌숲아이파크 103동 22층2204호",
        "usage": "아파트",
        "addr_sgg": "마포구",
        "addr_emd": "신수동",
        "area_m2": 84.93,
        "appraisal": 945000000,
        "min_bid": 945000000,
        "tenant_deposit": 0,
        "remarks": "",
        "rights_list": "",
    }
    res = MarketMatcher().match_item(item)

    assert res["property_category"] == "residential"
    assert res["market_price"] == 0
    assert res["market_match_count"] == 0
    assert "매칭차단" in res["market_match_level"]
    # 감정가 기준 보조 마진까지만 허용 (최저가=감정가이므로 0원)
    assert res["safety_margin"] == 0


def test_share_ratio_scales_matched_market_price():
    """상가 물건이 1/2 지분으로 매각되면 매칭 시세도 1/2로 환산되어야 한다"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM auction_items WHERE market_match_count > 0 AND usage LIKE '%상가%' ORDER BY market_match_count DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        pytest.skip("시세 매칭된 상가 물건이 DB에 없습니다")

    base_item = dict(row)
    base_item["remarks"] = ""
    base_item["special_rights"] = ""
    base_item["location"] = base_item.get("location") or ""
    matcher = MarketMatcher()
    base = matcher.match_item(base_item)
    assert base["market_price"] > 0

    share_item = dict(base_item)
    share_item["remarks"] = "[지분매각 내역]\n갑구 1번 지분 2분의 1 전부"
    shared = matcher.match_item(share_item)

    assert shared["is_share_sale"] is True
    assert shared["share_ratio"] == pytest.approx(0.5)
    assert shared["market_price"] == int(base["market_price"] * 0.5)
    assert "지분 50% 환산" in shared["market_match_level"]
    # 인수 대상이 지분이므로 안전마진도 환산 시세 기준으로 줄어야 한다
    assert shared["safety_margin"] <= base["safety_margin"]


AUCTION_COLUMNS = {
    "case_number": "TEXT PRIMARY KEY",
    "location": "TEXT",
    "usage": "TEXT",
    "appraisal": "INTEGER",
    "min_bid": "INTEGER",
    "area_m2": "REAL",
    "floor": "INTEGER",
    "legal_div_no": "TEXT",
    "addr_sgg": "TEXT",
    "addr_emd": "TEXT",
    "tenant_deposit": "INTEGER",
    "is_payout_requested": "INTEGER",
    "ai_verdict": "TEXT",
    "ai_report_json": "TEXT",
    "remarks": "TEXT",
    "rights_list": "TEXT",
    "special_rights": "TEXT",
    "market_price": "INTEGER",
    "safety_margin": "INTEGER",
    "market_discount_pct": "REAL",
    "market_match_count": "INTEGER",
    "market_match_level": "TEXT",
    "est_monthly_rent": "INTEGER",
    "rental_yield": "REAL",
}

NAVER_COLUMNS = [
    "article_id", "legal_div_no", "region_name", "addr_sgg", "addr_emd",
    "trade_type", "trade_type_cd", "realty_type_cd", "area_m2", "area_pyeong",
    "price_sale_10k", "deposit_10k", "monthly_rent_10k",
    "floor", "total_floor", "detail_url", "article_name",
]


def _make_temp_db(tmp_path):
    """배치(update_database) 경로 검증용 임시 DB 생성"""
    db = tmp_path / "test_market.sqlite"
    conn = sqlite3.connect(db)
    cols = ", ".join(f"{c} {t}" for c, t in AUCTION_COLUMNS.items())
    conn.execute(f"CREATE TABLE auction_items ({cols})")
    conn.execute(
        "CREATE TABLE naver_listings ("
        + ", ".join(f"{c}" for c in NAVER_COLUMNS)
        + ")"
    )
    # 마포구 일반상가(D02) 매매 호가 1건 — 아파트/지분 물건에 매칭되면 안 된다
    conn.execute(
        "INSERT INTO naver_listings (article_id, legal_div_no, region_name, addr_sgg, addr_emd,"
        " trade_type, trade_type_cd, realty_type_cd, area_m2, area_pyeong, price_sale_10k,"
        " deposit_10k, monthly_rent_10k, floor, total_floor, detail_url, article_name)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("A1", "1144011100", "서울 마포구 신수동", "마포구", "신수동", "매매", "A1", "D02",
         84.93, 25.7, 220000, 0, 0, 1, 5, "", "일반상가 · 신수동 대로변"),
    )
    conn.commit()
    conn.close()
    return str(db)


def test_batch_update_keeps_usage_and_share_rules(tmp_path):
    """배치 update_database도 usage·지분 정보를 읽어 개별 match_item과 같은 판단을 해야 한다"""
    db_path = _make_temp_db(tmp_path)
    conn = sqlite3.connect(db_path)
    rows = [
        # 아파트(용도 기반 주거 판정) — 상가 호가 매칭 금지
        ("2024타경51096", "서울특별시 마포구 광성로 17 103동 22층2204호 (신수동,신촌숲아이파크)",
         "아파트", 945000000, 945000000, 84.93, 22, "", "마포구", "신수동", 0, 0, "", None,
         "[지분매각 내역]\n갑구 1번 지분 2분의 1 전부", "", ""),
        # 노유자복지시설 — 동종 비교군 없으면 매칭 차단
        ("2022타경59047", "경기도 성남시 분당구 불정로 112 1층에이123호 (정자동,피더하우스)",
         "노유자복지시설", 419000000, 49290000, 0.0, 1, "", "", "", 0, 0, "", None,
         "", "", ""),
        # 상가 — 종전처럼 매칭되어야 한다
        ("2025타경00001", "서울 마포구 신수동 123 1층 101호", "상가/근린시설",
         900000000, 500000000, 84.93, 1, "", "마포구", "신수동", 0, 0, "", None, "", "", ""),
    ]
    for r in rows:
        conn.execute(
            "INSERT INTO auction_items (case_number, location, usage, appraisal, min_bid, area_m2, floor,"
            " legal_div_no, addr_sgg, addr_emd, tenant_deposit, is_payout_requested, ai_verdict, ai_report_json,"
            " remarks, rights_list, special_rights)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            r,
        )
    conn.commit()
    conn.close()

    stats = MarketMatcher(db_path=db_path).update_database()
    assert stats["total"] == 3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    got = {r["case_number"]: dict(r) for r in conn.execute("SELECT * FROM auction_items")}
    conn.close()

    # 아파트 1/2 지분 — 상가 호가 매칭 차단, 안전마진 0
    assert got["2024타경51096"]["market_price"] == 0
    assert got["2024타경51096"]["market_match_count"] == 0
    assert got["2024타경51096"]["safety_margin"] == 0
    assert "지분매각" in got["2024타경51096"]["market_match_level"]

    # 노유자복지시설 — 매칭 차단
    assert got["2022타경59047"]["market_price"] == 0
    assert got["2022타경59047"]["market_match_level"] == "동종 비교군 없음 (매칭차단)"

    # 상가 — 매칭 유지 (usage·주거 판정이 과잉 차단하지 않는다)
    assert got["2025타경00001"]["market_match_count"] > 0
    assert got["2025타경00001"]["market_price"] > 0
