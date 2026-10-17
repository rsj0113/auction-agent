import os
import json
import urllib.request
from openai import OpenAI
from typing import Dict
from dotenv import load_dotenv

load_dotenv()

def _call_gemini_json(prompt: str, api_key: str, model_name: str = "gemini-3.8-flash") -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        res = json.loads(text)
        res["ai_model"] = model_name
        return res

def analyze_auction_data(item_data: dict) -> dict:
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    if not gemini_key and not openai_key:
        return {"error": "GEMINI_API_KEY or OPENAI_API_KEY is not set."}
        
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
    - 전입신고일: {item_data.get('tenant_registration_date') or '없음 (또는 미상)'}
    - 보증금: {item_data.get('tenant_deposit', 0):,}원
    - 등기부/권리내역: {item_data.get('rights_list') or '정보없음'}

    만약 전입신고일이 '없음 (또는 미상)'이고 등기부내역에 임차권이 없다면 임차인이 없는 물건으로 간주하여 무리한 리스크 경고(임차인 불확실성 등)를 생성하지 마십시오.

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
    
    # 1순위: Gemini 무료 티어 / Pro API 키 우선 호출
    if gemini_key:
        for g_model in ("gemini-3.8-flash", "gemini-flash-latest"):
            try:
                return _call_gemini_json(prompt, gemini_key, g_model)
            except Exception:
                continue

    # 2순위: OpenAI 폴백
    client = OpenAI(api_key=openai_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": "You are a helpful JSON-only assistant."},
                  {"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2
    )
    result = json.loads(response.choices[0].message.content)
    result["ai_model"] = "gpt-4o-mini"
    return result

