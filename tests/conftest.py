"""
pytest 픽스처 공유 모듈.
모든 테스트는 네트워크, OpenAI, Playwright 없이 실행되어야 한다.
"""

import os
import sys
import tempfile
import pytest

# 프로젝트 루트를 sys.path에 추가 (auction_agent 패키지 하위 모듈 임포트용)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# .env 없어도 임포트가 깨지지 않도록 더미 환경변수 주입
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy-key-for-unit-tests")


@pytest.fixture()
def tmp_db(tmp_path):
    """격리된 임시 SQLite DB 경로를 반환한다. 테스트 종료 시 자동 삭제."""
    return str(tmp_path / "test_auction.sqlite")


@pytest.fixture()
def sample_rights_list():
    """말소기준권리 탐색 테스트용 표준 권리 목록."""
    return [
        {"name": "근저당", "date": "2020.03.15"},
        {"name": "가압류", "date": "2021.07.01"},
        {"name": "압류",   "date": "2019.11.20"},   # 가장 오래된 것 → 말소기준
        {"name": "전세권", "date": "2018.06.10"},    # 키워드 미해당 → 무시
    ]


@pytest.fixture()
def sample_auction_item():
    """DB 에이전트 업서트 테스트용 기본 경매 물건 딕셔너리."""
    return {
        "case_number": "2024타경12345",
        "location": "서울시 서초구 서초동 123-45",
        "appraisal": 500_000_000,
        "min_bid": 400_000_000,
        "failed_count": 1,
        "rights_list": [{"name": "근저당", "date": "2020.01.01"}],
        "tenant_registration_date": "2021.06.15",
        "tenant_deposit": 50_000_000,
        "is_payout_requested": True,
        "area_m2": 84.5,
        "legal_div_no": "1101010100",
        "addr_sgg": "서초구",
        "addr_emd": "서초동",
    }
