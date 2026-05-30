"""
RightsAnalysisEngine 단위 테스트.
네트워크·DB·OpenAI 없이 순수 로직만 검증한다.
"""

import pytest
from datetime import datetime

# auto_crawling.py가 프로젝트 루트에 있어 직접 임포트
from auto_crawling import RightsAnalysisEngine


@pytest.fixture()
def engine():
    return RightsAnalysisEngine()


# ─────────────────────────────────────────────────────────────────────────────
# parse_date
# ─────────────────────────────────────────────────────────────────────────────
class TestParseDate:
    def test_dot_format(self, engine):
        result = engine.parse_date("2020.03.15")
        assert result == datetime(2020, 3, 15)

    def test_dash_format(self, engine):
        result = engine.parse_date("2021-07-01")
        assert result == datetime(2021, 7, 1)

    def test_slash_format(self, engine):
        result = engine.parse_date("2019/11/20")
        assert result == datetime(2019, 11, 20)

    def test_compact_8digit(self, engine):
        result = engine.parse_date("20220815")
        assert result == datetime(2022, 8, 15)

    def test_none_input(self, engine):
        assert engine.parse_date(None) is None

    def test_empty_string(self, engine):
        assert engine.parse_date("") is None

    def test_jeongboneoum(self, engine):
        assert engine.parse_date("정보없음") is None

    def test_garbage_string(self, engine):
        assert engine.parse_date("불명") is None


# ─────────────────────────────────────────────────────────────────────────────
# find_malso_standard
# ─────────────────────────────────────────────────────────────────────────────
class TestFindMalsoStandard:
    def test_picks_earliest_date(self, engine, sample_rights_list):
        # 압류(2019-11-20)가 근저당(2020-03-15), 가압류(2021-07-01)보다 빠름
        result = engine.find_malso_standard(sample_rights_list)
        assert result == datetime(2019, 11, 20)

    def test_ignores_non_malso_keywords(self, engine):
        # 전세권·소유권이전 등 말소기준 아닌 권리 무시
        rights = [
            {"name": "전세권", "date": "2018.01.01"},
            {"name": "소유권이전", "date": "2017.05.10"},
        ]
        assert engine.find_malso_standard(rights) is None

    def test_empty_list(self, engine):
        assert engine.find_malso_standard([]) is None

    def test_entry_without_date(self, engine):
        rights = [{"name": "근저당", "date": ""}]
        assert engine.find_malso_standard(rights) is None

    def test_single_entry(self, engine):
        rights = [{"name": "가압류", "date": "2023.04.22"}]
        result = engine.find_malso_standard(rights)
        assert result == datetime(2023, 4, 22)


# ─────────────────────────────────────────────────────────────────────────────
# analyze_tenant_risk
# ─────────────────────────────────────────────────────────────────────────────
class TestAnalyzeTenantRisk:

    def test_safe_후순위_임차인(self, engine):
        # 임차인 날짜가 말소기준 이후 → 후순위 → SAFE
        malso = datetime(2020, 1, 1)
        tenant = datetime(2021, 6, 15)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=30_000_000,
                                            is_payout_requested=False)
        assert result["risk_level"] == "SAFE"
        assert result["has_daehang"] is False
        assert result["estimated_loss"] == 0

    def test_critical_선순위_배당미요구(self, engine):
        # 임차인 날짜가 말소기준 이전 + 배당요구 없음 → CRITICAL
        malso = datetime(2020, 6, 1)
        tenant = datetime(2019, 3, 10)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=80_000_000,
                                            is_payout_requested=False)
        assert result["risk_level"] == "CRITICAL"
        assert result["has_daehang"] is True
        assert result["estimated_loss"] == 80_000_000

    def test_warning_선순위_배당요구(self, engine):
        # 임차인 날짜가 말소기준 이전 + 배당요구 있음 → WARNING
        malso = datetime(2020, 6, 1)
        tenant = datetime(2019, 3, 10)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=50_000_000,
                                            is_payout_requested=True)
        assert result["risk_level"] == "WARNING"
        assert result["has_daehang"] is True

    def test_unknown_말소기준없음(self, engine):
        # 말소기준권리 없음 → UNKNOWN
        result = engine.analyze_tenant_risk(None, None, deposit=0,
                                            is_payout_requested=False)
        assert result["risk_level"] == "UNKNOWN"
        assert result["has_daehang"] is False

    def test_no_tenant_date(self, engine):
        # 임차인 날짜 정보 없음 → has_daehang False
        malso = datetime(2020, 1, 1)
        result = engine.analyze_tenant_risk(malso, None, deposit=0,
                                            is_payout_requested=False)
        assert result["has_daehang"] is False

    def test_discount_rate_계산(self, engine):
        malso = datetime(2020, 1, 1)
        tenant = datetime(2021, 1, 1)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=0,
                                            is_payout_requested=False,
                                            appraisal=500_000_000,
                                            min_bid=400_000_000)
        assert result["discount_rate"] == 20.0

    def test_extreme_discount_경고_추가(self, engine):
        # 70% 이상 할인 시 warnings에 경고 추가
        malso = datetime(2020, 1, 1)
        tenant = datetime(2021, 1, 1)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=0,
                                            is_payout_requested=False,
                                            appraisal=500_000_000,
                                            min_bid=100_000_000)  # 80% 할인
        assert any("할인" in w for w in result["warnings"])

    def test_다중유찰_경고(self, engine):
        malso = datetime(2020, 1, 1)
        tenant = datetime(2021, 1, 1)
        result = engine.analyze_tenant_risk(malso, tenant, deposit=0,
                                            is_payout_requested=False,
                                            failed_count=6)
        assert any("유찰" in w for w in result["warnings"])

    def test_malso_standard_포맷(self, engine):
        malso = datetime(2020, 3, 15)
        result = engine.analyze_tenant_risk(malso, None, deposit=0,
                                            is_payout_requested=False)
        assert result["malso_standard"] == "2020-03-15"
