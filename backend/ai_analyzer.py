import os
import json
from typing import Dict, Optional, List
from dotenv import load_dotenv

# Gemini 1순위 헬퍼
from core.gemini_helper import call_gemini_json, call_gemini_chat

load_dotenv()

def analyze_auction_data(item_data: dict) -> dict:
    """
    경매 물건 종합 AI 가치 및 권리 분석:
    - 1순위: Google Gemini (무료 티어 / 고속 3.5 Flash Lite 등 우선)
    - 2순위: OpenAI GPT-4o-mini (폴백)
    """
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

    remarks = item_data.get('remarks') or '특이사항 없음 (비고란 공란)'
    rights_list = item_data.get('rights_list') or '정보없음'
    special_rights = item_data.get('special_rights') or '없음'
    usage = item_data.get('usage') or '부동산'

    prompt = f"""
    당신은 대한민국 최고의 부동산 경매 전문가 및 감정평가사입니다.
    다음 법원경매 물건의 매각물건명세서, 등기부 을구, 비고란 및 권리관계를 정밀 분석하여 JSON 형식으로 결과를 응답하십시오.

    [물건 기본 정보]
    - 사건번호: {item_data.get('case_number')}
    - 소재지: {item_data.get('location')}
    - 용도: {usage}
    - 감정가: {appraisal:,}원
    - 최저매각가격: {min_bid:,}원
    - 할인율: {discount_rate}%
    - 유찰횟수: {item_data.get('failed_count', 0)}회

    [매각물건명세서 비고란 및 특수조건]
    {remarks}

    [등기부 및 을구 권리내역 (말소/인수 검토 대상)]
    {rights_list}

    [임차인 현황 및 보증금]
    - 전입신고일: {item_data.get('tenant_registration_date') or '소유자/미상'}
    - 임차보증금: {item_data.get('tenant_deposit', 0):,}원
    - 배당요구 여부: {'배당요구 신청 완료' if item_data.get('is_payout_requested') == 1 else '미신청 또는 해당없음'}

    [특수권리 감지 태그]
    {special_rights}

    [중요 권리분석 및 인수금액 산정 지침]
    1. 매각물건명세서 을구에 '주택임차권등기'(또는 상가임차권등기)가 있거나, 비고란에 '매수인 인수', '임차권등기자 배당미요구 시 매수인 인수', '보증금 인수' 등이 명시된 경우 낙찰자가 인수해야 할 권리와 금액을 절대 누락하지 마십시오.
    2. 선순위 주택임차권등기(보증금 3.8억 원 등)가 존재하고 배당요구를 하지 않은 경우, 해당 보증금은 전액 '매수인(낙찰자) 인수'로 판정하여 retained_rights에 명시하고 최종 권리 위험도(score, grade, verdict)에 반드시 반영하십시오. 절대 '인수 0원' 또는 '권리하자 없음'으로 오판독해서는 안 됩니다.
    3. 전입신고일이 '없음(또는 미상)'이더라도 매각물건명세서 을구나 비고란에 임차권등기 또는 보증금이 명시되어 있다면 임차권 인수를 철저히 분석하십시오.
    4. 지분매각인 경우 배타적 점유 불가 및 공유자 우선매수권 위험을 명시하십시오.

    반드시 JSON 형식으로만 응답하십시오:
    {{
        "score": 0-100,
        "grade": "A-D",
        "verdict": "권리분석 및 가치 종합 한줄 판정 (인수 보증금이 있는 경우 반드시 금액 명시)",
        "buy_signal": true/false,
        "expected_yield": "예상 수익률 %",
        "suggested_bid": "추천 입찰가 (인수 보증금을 감안한 실수수료 반영)",
        "extinguished_rights": ["말소권리1", "말소권리2"],
        "retained_rights": ["인수권리1 (없다면 '없음', 인수보증금이 있으면 '주택임차권등기 (보증금 X원 인수)' 등 구체적 명시)"],
        "risks": ["현장 리스크1", "권리 리스크2"],
        "analysis_detail": "경매 전문가 관점의 상세 분석 리포트"
    }}
    """
    
    # 1순위: Google Gemini 무료 티어 우선 호출
    gemini_res = call_gemini_json(prompt, temperature=0.2)
    if gemini_res:
        return gemini_res

    # 2순위: OpenAI GPT-4o-mini 폴백
    if openai_key:
        try:
            from openai import OpenAI
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
        except Exception as e:
            return {"error": f"OpenAI 폴백 호출 실패: {str(e)}"}

    return {"error": "AI 분석 호출에 실패했습니다."}


def chat_with_auction_ai(item_data: dict, user_message: str, chat_history: list = None) -> dict:
    """
    경매 매물 및 낙찰 결과 대화형 AI 어드바이저:
    - 1순위: Google Gemini (무료 티어 / 고속 3.5 Flash Lite 등 우선)
    - 2순위: OpenAI GPT-4o-mini (폴백)
    """
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

[매각물건명세서 비고란 및 특수조건]
- 비고란/을구 권리: {item_data.get('remarks') or '특이사항 없음'}
- 특수권리 감지: {item_data.get('special_rights') or '없음'}

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

    # 1순위: Google Gemini 무료 티어 우선 대화 생성
    gemini_chat = call_gemini_chat(
        user_message=user_message,
        system_prompt=system_prompt,
        chat_history=chat_history,
        temperature=0.3
    )
    if gemini_chat:
        return gemini_chat

    # 2순위: OpenAI GPT-4o-mini 폴백
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
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
        except Exception as e:
            return {"error": f"OpenAI 응답 생성 실패: {str(e)}"}

    return {"error": "AI 응답을 생성할 수 없습니다. (GEMINI 또는 OPENAI 키 설정 필요)"}
