import pytest
import json
from datetime import datetime
from auto_crawling import _infer_usage, AuctionCrawler, RightsAnalysisEngine
from core.special_rights import extract_special_rights
from core.market_matcher import MarketMatcher, extract_assumed_deposit_info


def test_bug1_senior_deposit_and_assumed_amount():
    """Bug 1: 을구 주택임차권등기(3.8억) 및 매수인 인수 문구가 누락 없이 감지되고 안전마진/인수금에 반영되는지 검증"""
    remarks = (
        "[매각물건명세서 을구/최선순위설정]\n"
        "을구 주택임차권등기 (임차보증금 380,000,000원)\n\n"
        "[매각물건명세서 비고]\n"
        "주택임차권등기자 배당요구 미신청. 매수인이 임차보증금(3억 8,000만 원)을 전액 인수함."
    )
    rights_list = json.dumps([{"name": "주택임차권등기", "date": "2021.05.10"}])
    item = {
        "case_number": "2022타경59047",
        "location": "경기도 성남시 분당구 정자동 피더하우스 1층",
        "usage": "노유자복지시설",
        "appraisal": 419000000,
        "min_bid": 49290000,
        "tenant_deposit": 380000000,
        "remarks": remarks,
        "rights_list": rights_list
    }

    # 1. extract_assumed_deposit_info 검증: 3.8억 원 인수 추출 및 SAFE 오판정 차단
    assumed, is_unknown, reason = extract_assumed_deposit_info(item)
    assert assumed == 380000000
    assert not is_unknown
    assert "380,000,000원 인수" in reason

    # 2. RightsAnalysisEngine 검증: 말소기준일 없어도 보증금 존재 시 CRITICAL 위험 판정
    engine = RightsAnalysisEngine()
    risk = engine.analyze_tenant_risk(
        malso_date=None,
        tenant_date=datetime(2021, 5, 10),
        deposit=380000000,
        is_payout_requested=False,
        appraisal=419000000,
        min_bid=49290000
    )
    assert risk["risk_level"] == "CRITICAL"
    assert risk["estimated_loss"] == 380000000


def test_bug2_failed_count_and_next_min_bid_parsing():
    """Bug 2: 기일내역(gdsDspslDxdyLst)에서 6회 유찰 및 차기 예정기일 최저가(4,929만 원) 정상 파싱 검증"""
    fake_detail_data = {
        "data": {
            "dma_result": {
                "csBaseInfo": {
                    "csNo": "20220130059047",
                    "csNm": "부동산임의경매",
                    "dspslMthdCd": "01",
                    "dspslMthdNm": "기일입찰"
                },
                "gdsDspslDxdyLst": [
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 419000000, "dxdyYmd": "20230101"},
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 293300000, "dxdyYmd": "20230201"},
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 205310000, "dxdyYmd": "20230301"},
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 143717000, "dxdyYmd": "20230401"},
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 100602000, "dxdyYmd": "20230501"},
                    {"auctnDxdyRsltCd": "002", "tsLwsDspslPrc": 70421000, "dxdyYmd": "20230601"},
                    # 차기 예정 기일 (상태코드 00, 최저가 49,290,000)
                    {"auctnDxdyRsltCd": "", "auctnDxdyGdsStatCd": "00", "tsLwsDspslPrc": 49290000, "dxdyYmd": "20261207"}
                ],
                "dspslGdsDtsLst": [
                    {
                        "rletKndNm": "근린생활시설",
                        "prptDtsAddress": "경기도 성남시 분당구 불정로 112 1층에이123호 (정자동,피더하우스)",
                        "evlPrc": 419000000,
                        "tprtyRnkHypthcStngDts": "주택임차권등기 2021.05.10 (380,000,000원)",
                        "dspslPrptCmdtDtsLst": []
                    }
                ],
                "gdsDspslObjctLst": []
            }
        }
    }

    crawler = AuctionCrawler()
    parsed = crawler._parse_detail_json(fake_detail_data)
    assert parsed["failed_count"] == 6
    assert parsed["min_bid"] == 49290000
    assert parsed["prev_min_bid"] == 70421000
    assert parsed["auction_date"] == "20261207"
    assert parsed["tenant_deposit"] == 380000000
    assert "주택임차권등기" in parsed["remarks"]
    assert any(r["name"] == "주택임차권등기" for r in parsed["rights_list"])


def test_bug3_special_facility_market_matching_blocked():
    """Bug 3: 노유자복지시설(피더하우스) 용도 분류 정상화 및 일반 상가 호가 대조군 매칭 원천 차단 검증"""
    # 1. _infer_usage 검증: "피더하우스"가 다세대/빌라로 오분류되지 않고 노유자복지시설로 분류되는지 확인
    usage = _infer_usage(
        loc="경기도 성남시 분당구 불정로 112 1층에이123호 (정자동,피더하우스)",
        cur_usage="노유자복지시설"
    )
    assert usage == "노유자복지시설"

    usage2 = _infer_usage(
        loc="경기도 성남시 분당구 정자동 123 (피더하우스 노인복지)",
        cur_usage=""
    )
    assert usage2 == "노유자복지시설"

    # 2. MarketMatcher 검증: 동종 시설이 아닌 일반 상가(D02)와의 임의 매칭 및 안전마진 산출 차단
    matcher = MarketMatcher()
    item = {
        "case_number": "2022타경59047",
        "location": "경기도 성남시 분당구 불정로 112 1층에이123호 (정자동,피더하우스)",
        "addr_sgg": "분당구",
        "addr_emd": "정자동",
        "usage": "노유자복지시설",
        "area_pyeong": 0.0,
        "area_m2": 0.0,
        "appraisal": 419000000,
        "min_bid": 49290000,
        "tenant_deposit": 380000000,
        "remarks": "[매각물건명세서 을구/최선순위설정]\n을구 주택임차권등기 (임차보증금 380,000,000원)"
    }
    res = matcher.match_item(item)
    assert res["market_price"] == 0
    assert res["safety_margin"] == 0
    assert res["market_discount_pct"] == 0.0
    assert res["market_match_count"] == 0
    assert res["market_match_level"] == "동종 비교군 없음 (매칭차단)"
    assert res["rental_yield"] == 0.0
    assert res["senior_deposit_assumed"] == 380000000


def test_bug4_share_sale_detection():
    """Bug 4: 지분매각(1/2 지분, 2분의 1 지분, gdsDspslObjctLst) 물건 판별 및 특수권리 태그 생성 검증"""
    # 1. 텍스트 비고란 기반 1/2 지분매각 감지
    remarks_share = (
        "[지분매각 내역]\n"
        "갑구 1번 지분 2분의 1 전부\n\n"
        "[지상권 관련 내역]\n"
        "해당사항없음"
    )
    tags_text = extract_special_rights(remarks=remarks_share)
    assert any(t["id"] == "share" and t["short"] == "지분매각" for t in tags_text)

    # 2. gdsDspslObjctLst (dspslStkNmrtVal / dspslStkDnmnVal) 기반 지분 감지
    dspsl_objects = [
        {"dspslStkCtt": "지분 2분의 1", "dspslStkNmrtVal": 1, "dspslStkDnmnVal": 2}
    ]
    tags_obj = extract_special_rights(remarks="", dspsl_objects=dspsl_objects)
    assert any(t["id"] == "share" and t["short"] == "지분매각" for t in tags_obj)

    # 3. location 내 1/2 지분 텍스트 감지
    tags_loc = extract_special_rights(remarks="", location="서울특별시 마포구 신촌숲아이파크 103동 22층 (1/2 지분매각)")
    assert any(t["id"] == "share" and t["short"] == "지분매각" for t in tags_loc)

