import os
import json
from openai import OpenAI
from typing import Dict

def analyze_auction_data(item_data: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY is not set."}
        
    client = OpenAI(api_key=api_key)
    
    # Calculate discount
    discount_rate = 0
    appraisal = item_data.get('appraisal') or 0
    min_bid = item_data.get('min_bid') or 0
    if appraisal > 0:
        discount_rate = round((1 - min_bid / appraisal) * 100, 1)

    prompt = f"""
    당신은 대한민국 최고의 부동산 경매 전문가입니다.
    다음 법원경매 물건을 분석하여 JSON 형식으로 결과를 응답하십시오.

    [물건 정보]
    - 사건번호: {item_data.get('case_number')}
    - 소재지: {item_data.get('location')}
    - 감정가: {appraisal:,}원
    - 최저매각가격: {min_bid:,}원
    - 할인율: {discount_rate}%
    - 유찰횟수: {item_data.get('failed_count')}회
    - 전입신고일: {item_data.get('tenant_registration_date', '정보없음')}
    - 보증금: {item_data.get('tenant_deposit', 0):,}원
    - 등기부/권리내역: {item_data.get('rights_list', '정보없음')}

    반드시 JSON 형식으로만 응답하십시오:
    {{
        "score": 0-100,
        "grade": "A-D",
        "verdict": "권리분석 및 가치 종합 한줄 판정",
        "buy_signal": true/false,
        "expected_yield": "예상 수익률 %",
        "suggested_bid": "추천 입찰가",
        "extinguished_rights": ["말소권리1"],
        "retained_rights": ["인수권리1 (없다면 '없음')"],
        "risks": ["현장 리스크1"],
        "analysis_detail": "상세 분석 리포트"
    }}
    """
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "system", "content": "You are a helpful JSON-only assistant."},
                  {"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2
    )
    
    return json.loads(response.choices[0].message.content)
