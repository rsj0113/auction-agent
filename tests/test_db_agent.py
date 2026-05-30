"""
AuctionDBAgent 단위 테스트.
실제 SQLite 파일을 tmp_path에 생성하며, 네트워크는 전혀 사용하지 않는다.
"""

import pytest
from auto_crawling import AuctionDBAgent


@pytest.fixture()
def db(tmp_db):
    return AuctionDBAgent(db_path=tmp_db)


def _make_ai_report(score=75):
    return {
        "score": score, "grade": "B", "verdict": "투자 검토 가능",
        "buy_signal": True, "expected_yield": "6%",
        "suggested_bid": "400,000,000원",
        "extinguished_rights": [], "retained_rights": [],
        "key_points": [], "risks": [], "analysis_detail": "",
    }


def _make_rights_report(risk_level="SAFE"):
    return {
        "has_daehang": False, "risk_level": risk_level,
        "estimated_loss": 0, "reason": "테스트용",
        "malso_standard": "2020-01-01", "discount_rate": 20.0,
        "failed_count": 1, "warnings": [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# DB 초기화
# ─────────────────────────────────────────────────────────────────────────────
class TestDBInit:
    def test_테이블_생성(self, db):
        import sqlite3
        with sqlite3.connect(db.db_path) as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        assert ("auction_items",) in tables

    def test_신규_컬럼_존재(self, db):
        import sqlite3
        with sqlite3.connect(db.db_path) as conn:
            cols = [row[1] for row in conn.execute(
                "PRAGMA table_info(auction_items)"
            ).fetchall()]
        for col in ["area_m2", "legal_div_no", "addr_sgg", "addr_emd"]:
            assert col in cols


# ─────────────────────────────────────────────────────────────────────────────
# upsert 상태 머신 — NEW / UPDATED / UNCHANGED
# ─────────────────────────────────────────────────────────────────────────────
class TestUpsertStateMachine:

    def test_신규_물건_NEW(self, db, sample_auction_item):
        status, prev = db.upsert_auction_item(
            sample_auction_item, _make_ai_report(), _make_rights_report()
        )
        assert status == "NEW"
        assert prev is None

    def test_가격_변동없음_UNCHANGED(self, db, sample_auction_item):
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        # 동일 가격으로 다시 업서트
        status, prev = db.upsert_auction_item(
            sample_auction_item, _make_ai_report(), _make_rights_report()
        )
        assert status == "UNCHANGED"
        assert prev == sample_auction_item["min_bid"]

    def test_가격_변동_UPDATED(self, db, sample_auction_item):
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        # 최저가 변경
        updated = {**sample_auction_item, "min_bid": 320_000_000}
        status, prev = db.upsert_auction_item(
            updated, _make_ai_report(), _make_rights_report()
        )
        assert status == "UPDATED"
        assert prev == 400_000_000

    def test_조회_데이터_일치(self, db, sample_auction_item):
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        assert item is not None
        assert item["location"] == sample_auction_item["location"]
        assert item["appraisal"] == sample_auction_item["appraisal"]

    def test_없는_사건번호_None(self, db):
        assert db.get_existing_item("없는사건번호9999") is None


# ─────────────────────────────────────────────────────────────────────────────
# _cap 가드 — 0원·초과금액 방어
# ─────────────────────────────────────────────────────────────────────────────
class TestCapGuard:

    def test_0원_appraisal_기존값_보존(self, db, sample_auction_item):
        # 첫 업서트로 감정가 500만 저장
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        # 두 번째: 파싱 실패로 appraisal=0 들어올 때 기존값이 유지되어야 함
        broken = {**sample_auction_item, "appraisal": 0}
        db.upsert_auction_item(broken, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        assert item["appraisal"] == 500_000_000

    def test_0원_min_bid_기존값_보존(self, db, sample_auction_item):
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        broken = {**sample_auction_item, "min_bid": 0}
        db.upsert_auction_item(broken, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        assert item["min_bid"] == 400_000_000

    def test_INT_CAP_초과값_클리핑(self, db, sample_auction_item):
        huge = {**sample_auction_item, "appraisal": 10 ** 15, "min_bid": 10 ** 15}
        db.upsert_auction_item(huge, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        # _INT_CAP = 10^13
        assert item["appraisal"] <= 10 ** 13


# ─────────────────────────────────────────────────────────────────────────────
# rights_list JSON 직렬화/역직렬화
# ─────────────────────────────────────────────────────────────────────────────
class TestRightsListSerialization:

    def test_rights_list_왕복_일치(self, db, sample_auction_item):
        db.upsert_auction_item(sample_auction_item, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        assert isinstance(item["rights_list"], list)
        assert item["rights_list"] == sample_auction_item["rights_list"]

    def test_빈_rights_list(self, db, sample_auction_item):
        empty_rights = {**sample_auction_item, "rights_list": []}
        db.upsert_auction_item(empty_rights, _make_ai_report(), _make_rights_report())
        item = db.get_existing_item(sample_auction_item["case_number"])
        assert item["rights_list"] == []
