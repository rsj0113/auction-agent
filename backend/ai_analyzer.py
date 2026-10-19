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


def chat_with_auction_ai(item_data: dict, user_message: str, chat_history: list = None) -> dict:
    """
    Conversational AI advisor for answering auction, valuation, winning bid, and rights questions.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return {"error": "OPENAI_API_KEY가 설정되어 있지 않습니다."}

    appraisal = item_data.get('appraisal', 0) or 0
    min_bid = item_data.get('min_bid', 0) or 0
    winning_bid = item_data.get('winning_bid', 0) or 0
    winning_rate = item_data.get('winning_rate', 0) or 0
    bidder_count = item_data.get('bidder_count', 0) or 0
    runner_up_bid = item_data.get('runner_up_bid', 0) or 0
    runner_diff = max(0, winning_bid - runner_up_bid) if runner_up_bid > 0 else 0
    market_price = item_data.get('market_price') or appraisal

    context = f"""
[물건 기본 정보]
- 사건/관리번호: {item_data.get('case_number')}
- 물건 소재지: {item_data.get('location')}
- 용도: {item_data.get('usage', '상가/주택')}
- 층수/면적: {item_data.get('floor', 0)}층, 전용 {item_data.get('area_pyeong', 0)}평 ({item_data.get('area_m2', 0)}㎡)
- 법원 감정가: {appraisal:,}원
- 당시 입찰 최저가: {min_bid:,}원
- 유찰 횟수: {item_data.get('failed_count', 0)}회

[낙찰 결과 데이터 (해당 시)]
- 최종 낙찰 금액: {winning_bid:,}원
- 감정가 대비 낙찰가율: {winning_rate}%
- 총 참여 응찰자 수: {bidder_count}명 (경쟁률 {bidder_count}:1)
- 2등 차순위 입찰가: {runner_up_bid:,}원
- 1등과 2등 금액 차이: {runner_diff:,}원 ({((runner_diff/winning_bid)*100 if winning_bid else 0):.1f}% 차이)
- 낙찰 일자: {item_data.get('result_date', '-')}

[등기부 권리 및 임차인 현황]
- 등기부 권리내역: {item_data.get('rights_list', '정보없음')}
- 임차인 전입일자: {item_data.get('tenant_registration_date') or '소유자 점유 추정 (선순위 임차인 없음)'}
- 임차보증금: {item_data.get('tenant_deposit', 0):,}원
- 배당요구 여부: {'배당요구 신청 완료' if item_data.get('is_payout_requested') == 1 else '미신청 또는 해당없음'}

[시세 및 마진]
- 네이버 추정 호가/시세: {market_price:,}원
- 실현 안전마진 (시세 - 낙찰가/최저가): {max(0, market_price - (winning_bid or min_bid)):,}원
"""

    system_prompt = f"""당신은 대한민국 최고의 부동산 경매 및 실거래 낙찰가 정밀 분석 전문 AI 어드바이저입니다.
사용자는 경매 투자자이며, "왜 이 가격에 낙찰되었는지", "2등과의 입찰가 차이가 왜 발생하는지", "추가로 인수해야 할 권리 리스크가 있는지", "어떻게 엑시트(전세/월세/매매)해야 하는지" 등을 대화로 질문합니다.

다음 물건의 실제 데이터를 바탕으로 실무적이고 통찰력 있게 답변하십시오.
- 서론이나 상투적인 인사말은 생략하고, 곧바로 질문에 대한 날카롭고 명쾌한 핵심 분석을 제시하십시오.
- 금액은 이해하기 쉽게 억/만원 단위(예: 3억 5,200만원)를 함께 명시하십시오.
- 1등과 2등의 입찰 심리, 감정가 및 유찰가 대비 가격 형성 배경, 임대수익률 및 갭투자 등 실전 투자자 관점을 명확하게 짚어주십시오.
- 한국어로 신뢰감 있고 친절하며 명확하게 설명하십시오.

물건 상세 정보:
{context}
"""

    messages = [{"role": "system", "content": system_prompt}]

    if chat_history and isinstance(chat_history, list):
        for msg in chat_history[-6:]:
            if isinstance(msg, dict) and msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    client = OpenAI(api_key=openai_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.3,
        max_tokens=800
    )

    reply = response.choices[0].message.content
    return {
        "reply": reply,
        "ai_model": "gpt-4o-mini"
    }


