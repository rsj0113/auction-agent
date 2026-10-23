import os
import json
import sqlite3
import re
from typing import List, Dict, Any, Optional
from openai import OpenAI
from dotenv import load_dotenv

from core.villa_transactions import get_villa_trade_info
from core.post_auction_analyzer import analyze_post_auction

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "auction_db.sqlite")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def parse_user_intent(user_prompt: str) -> dict:
    """
    Extract user search intent from natural language prompt.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return {"property_type": "", "region": "", "max_price": None, "focus": "general"}

    prompt = f"""
다음은 부동산 경매 투자자의 자연어 요청입니다.
요청 내용을 분석하여 아래 JSON 형식으로 추출하십시오.

[사용자 요청]
"{user_prompt}"

[JSON 필드 정의]
- property_type: 'villa'(빌라/다세대/연립), 'commercial'(상가/근린/점포/체육), 'apartment'(아파트), 'officetel'(오피스텔), ''(전체)
- region: 검색 지역명 (예: '성남', '분당', '광주', '하남', '송파', '강남', '수원' 등, 없으면 '')
- max_price: 최대 금액 (원 단위 정수, 예: 2억 -> 200000000, 5천만 -> 50000000, 없으면 null)
- min_yield: 최소 희망 연 임대수익률 (숫자 또는 null)
- floor: '1f'(1층), 'b1'(지하1층), 'upper'(상층), ''(상관없음)
- focus: 'cashflow'(월세/수익률 중심), 'gap'(전세 갭투자/소액), 'margin'(안전마진/시세차익), 'general'
- is_result_query: true(이미 끝난 낙찰 결과/사례 분석을 묻는 경우), false(현재 진행 중인 경매 추천인 경우)
- keywords: 검색 보조 키워드 문자열

반드시 JSON만 응답하십시오:
{{
  "property_type": "...",
  "region": "...",
  "max_price": null,
  "min_yield": null,
  "floor": "",
  "focus": "...",
  "is_result_query": false,
  "keywords": "..."
}}
"""
    try:
        client = OpenAI(api_key=openai_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a specialized intent extraction engine. Respond in JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.0
        )
        return json.loads(resp.choices[0].message.content)
    except Exception as e:
        print(f"Error parsing intent: {e}")
        return {"property_type": "", "region": "", "max_price": None, "focus": "general", "is_result_query": False}

def search_candidate_items(intent: dict, limit: int = 4) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()

    ptype = intent.get("property_type") or ""
    region = intent.get("region") or ""
    max_price = intent.get("max_price")
    floor = intent.get("floor") or ""
    focus = intent.get("focus") or "general"
    is_result = intent.get("is_result_query", False)

    candidates = []

    if is_result:
        # Search auction_results
        sql = "SELECT * FROM auction_results WHERE winning_bid > 0"
        params = []
        if region:
            sql += " AND (location LIKE ? OR court_name LIKE ?)"
            params.extend([f"%{region}%", f"%{region}%"])
        if ptype == "villa":
            sql += " AND (usage LIKE '%빌라%' OR usage LIKE '%다세대%' OR usage LIKE '%연립%')"
        elif ptype == "commercial":
            sql += " AND (usage LIKE '%상가%' OR usage LIKE '%근린%' OR usage LIKE '%점포%')"
        elif ptype == "apartment":
            sql += " AND usage LIKE '%아파트%'"
        if max_price:
            sql += " AND winning_bid <= ?"
            params.append(max_price)

        sql += " ORDER BY result_date DESC, bidder_count DESC LIMIT ?"
        params.append(limit)

        cursor.execute(sql, params)
        rows = cursor.fetchall()
        for r in rows:
            d = dict(r)
            d["source_type"] = "result"
            # enrich
            res_analysis = analyze_post_auction(d)
            if res_analysis:
                d["post_auction_analysis"] = res_analysis
            if d.get("usage") and ("빌라" in d["usage"] or "다세대" in d["usage"] or "연립" in d["usage"]):
                v_info = get_villa_trade_info(d.get("location", ""), d.get("min_bid", 0), d.get("winning_bid", 0))
                if v_info:
                    d["villa_trade_info"] = v_info
            candidates.append(d)
    else:
        # Search active auction_items
        sql = "SELECT * FROM auction_items WHERE appraisal > 0 AND min_bid > 0 AND status_flag != 'CLOSED'"
        params = []
        if region:
            sql += " AND location LIKE ?"
            params.append(f"%{region}%")
        if ptype == "villa":
            sql += " AND (usage LIKE '%빌라%' OR usage LIKE '%다세대%' OR usage LIKE '%연립%' OR location LIKE '%빌라%' OR location LIKE '%다세대%')"
        elif ptype == "commercial":
            sql += " AND (usage LIKE '%상가%' OR usage LIKE '%근린%' OR usage LIKE '%점포%' OR usage LIKE '%오피스텔%')"
        elif ptype == "apartment":
            sql += " AND (usage LIKE '%아파트%' OR location LIKE '%아파트%')"

        if floor == "1f":
            sql += " AND floor = 1"
        elif floor == "b1":
            sql += " AND floor < 0"

        if max_price:
            sql += " AND min_bid <= ?"
            params.append(max_price)

        # Ordering based on focus
        if focus == "gap" or ptype == "villa":
            sql += " ORDER BY failed_count DESC, min_bid ASC LIMIT ?"
        elif focus == "cashflow":
            sql += " ORDER BY rental_yield DESC, safety_margin DESC LIMIT ?"
        else:
            sql += " ORDER BY safety_margin DESC, failed_count DESC LIMIT ?"
        params.append(limit)

        cursor.execute(sql, params)
        rows = cursor.fetchall()

        # Fallback if too few rows
        if len(rows) < 2 and (region or max_price):
            fallback_sql = "SELECT * FROM auction_items WHERE appraisal > 0 AND min_bid > 0 AND status_flag != 'CLOSED' ORDER BY safety_margin DESC LIMIT ?"
            cursor.execute(fallback_sql, (limit,))
            rows = cursor.fetchall()

        for r in rows:
            d = dict(r)
            d["source_type"] = "auction"
            loc = d.get("location") or ""
            usage = d.get("usage") or ""
            if "빌라" in loc or "다세대" in loc or "연립" in loc or "빌라" in usage or "다세대" in usage:
                v_info = get_villa_trade_info(loc, d.get("min_bid", 0))
                if v_info:
                    d["villa_trade_info"] = v_info
            candidates.append(d)

    conn.close()
    return candidates

def recommend_and_compare(user_prompt: str, chat_history: list = None) -> dict:
    """
    Main agentic engine:
    1. Parse intent
    2. Retrieve top candidates
    3. Generate side-by-side comparison and secretary pick
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return {"error": "OPENAI_API_KEY가 설정되어 있지 않습니다."}

    intent = parse_user_intent(user_prompt)
    candidates = search_candidate_items(intent, limit=3)

    if not candidates:
        return {
            "intent_summary": "조건에 맞는 매물을 찾지 못했습니다.",
            "secretary_pick": None,
            "candidates": [],
            "comparison_table": [],
            "briefing_markdown": "조건에 부합하는 매물이 현재 DB에 없습니다. 금액 한도를 높이거나 지역 범위를 넓혀 다시 질문해 주세요."
        }

    # Format candidates for LLM prompt
    candidates_text = []
    for i, c in enumerate(candidates, 1):
        c_no = c.get("case_number") or f"물건 #{i}"
        loc = c.get("location") or "-"
        usage = c.get("usage") or "상가/주택"
        fl = f"{c.get('floor', 0)}층" if c.get('floor') else "1층"
        py = f"{c.get('area_pyeong', 0)}평"
        appraisal = c.get("appraisal", 0)
        min_bid = c.get("min_bid", 0)
        winning_bid = c.get("winning_bid", 0)
        failed = c.get("failed_count", 0)
        margin = c.get("safety_margin", 0)
        yield_pct = c.get("rental_yield", 0)
        tenant = c.get("tenant_registration_date") or "임차인 없음 (소유자 점유 추정)"
        v_info = c.get("villa_trade_info")
        v_text = ""
        if v_info:
            v_text = f"국토부 인근실거래가 {v_info.get('recent_price', 0):,}원, 추정전세 {v_info.get('est_jeonse_price', 0):,}원, 필요갭 {v_info.get('gap_investment_cash', 0):,}원"

        candidates_text.append(f"""
[후보 {i}번 매물]
- 사건/관리번호: {c_no}
- 소재지: {loc}
- 용도/규모: {usage}, {fl}, 전용 {py}
- 감정가: {appraisal:,}원 / 최저입찰가: {min_bid:,}원 (유찰 {failed}회)
- {f'최종 낙찰가: {winning_bid:,}원' if winning_bid else f'안전마진: +{margin:,}원, 예상수익률: {yield_pct}%'}
- 권리/임차인: {tenant}
{f'- 실거래/갭정보: {v_text}' if v_text else ''}
""")

    comparison_prompt = f"""
당신은 대한민국 최고의 부동산 경매 및 실전 부동산 투자 수석 비서(Senior Investment Secretary Agent)입니다.
투자자(사용자)의 요청을 바탕으로, 데이터베이스에서 엄선한 후보 매물들을 비교 분석하여 명쾌한 데일리/온디맨드 브리핑을 작성하십시오.

[투자자의 요청]
"{user_prompt}"

[후보 매물 상세 데이터]
{"".join(candidates_text)}

반드시 다음 JSON 규격으로만 응답하십시오:
{{
  "intent_summary": "투자자의 요청 핵심 요약 (한 줄)",
  "secretary_pick": {{
    "case_number": "가장 추천하는 후보 매물의 사건/관리번호",
    "title": "비서의 원픽 물건 제목 (예: [원픽] 성남 상대원동 실거래 대비 -40% 빌라)",
    "reason": "왜 이 매물이 오늘 최고의 선택인지 핵심 이유 (2~3문장)"
  }},
  "comparison_table": [
    {{
      "metric": "비교 항목 (예: 입찰 최저가, 진짜 안전마진, 소요 실투자금/갭, 예상 임대수익률, 권리 및 공실 리스크 등)",
      "item1": "후보 1번 값",
      "item2": "후보 2번 값",
      "item3": "후보 3번 값 (해당 시)"
    }}
  ],
  "briefing_markdown": "투자자에게 보고하는 품격 있는 마크다운 형식의 종합 브리핑 리포트 (후보별 핵심 장단점, 비서의 최종 투자의견, 현장 임장 시 체크포인트 포함)"
}}
"""

    try:
        client = OpenAI(api_key=openai_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a top-tier real estate investment secretary agent. Respond in JSON only."},
                {"role": "user", "content": comparison_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        result = json.loads(resp.choices[0].message.content)
        result["candidates"] = candidates
        return result
    except Exception as e:
        print(f"Error in recommend_and_compare: {e}")
        return {
            "intent_summary": user_prompt,
            "secretary_pick": {"case_number": candidates[0].get("case_number", ""), "title": candidates[0].get("location", ""), "reason": "안전마진 및 가격 경쟁력이 가장 우수합니다."},
            "candidates": candidates,
            "comparison_table": [],
            "briefing_markdown": f"AI 분석 생성 중 일시적 오류가 발생했습니다. ({str(e)})"
        }

def chat_with_agent(user_message: str, chat_history: list = None, case_number: str = None) -> dict:
    """
    Interactive conversation with AI Investment Secretary about auction results or active auctions.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return {"error": "OPENAI_API_KEY가 설정되어 있지 않습니다."}

    conn = get_db()
    cursor = conn.cursor()

    item_dict = None
    target_case = case_number

    # 1. If case_number not specified, check if user mentioned a case number in the prompt
    if not target_case:
        match = re.search(r'(\d{4}타경\d+|\d{4}-\d{5}-\d{3})', user_message)
        if match:
            target_case = match.group(1)

    # 2. Fetch specific item if case identified
    if target_case:
        cursor.execute("SELECT * FROM auction_results WHERE case_number = ?", (target_case,))
        r = cursor.fetchone()
        if r:
            item_dict = dict(r)
            item_dict["source_type"] = "result"
        else:
            cursor.execute("SELECT * FROM auction_items WHERE case_number = ?", (target_case,))
            r = cursor.fetchone()
            if r:
                item_dict = dict(r)
                item_dict["source_type"] = "auction"

    # 3. If still no specific item, fetch recent notable auction results for general context
    recent_results = []
    if not item_dict:
        cursor.execute("""
            SELECT case_number, location, usage, appraisal, min_bid, winning_bid, winning_rate, 
                   bidder_count, runner_up_bid, result_date
            FROM auction_results 
            ORDER BY result_date DESC, bidder_count DESC 
            LIMIT 5
        """)
        recent_results = [dict(row) for row in cursor.fetchall()]

    conn.close()

    # Build context
    if item_dict:
        # Enrich
        if item_dict.get("source_type") == "result":
            res_analysis = analyze_post_auction(item_dict)
            if res_analysis:
                item_dict["post_auction_analysis"] = res_analysis
        if item_dict.get("usage") and ("빌라" in item_dict["usage"] or "다세대" in item_dict["usage"]):
            v_info = get_villa_trade_info(item_dict.get("location", ""), item_dict.get("min_bid", 0), item_dict.get("winning_bid", 0))
            if v_info:
                item_dict["villa_trade_info"] = v_info

        context_str = f"""
[특정 질문 대상 물건 상세 정보]
- 사건/관리번호: {item_dict.get('case_number')}
- 물건 소재지: {item_dict.get('location')}
- 용도 및 층수/면적: {item_dict.get('usage', '상가/주택')}, {item_dict.get('floor', 0)}층, 전용 {item_dict.get('area_pyeong', 0)}평
- 법원 감정가: {item_dict.get('appraisal', 0):,}원
- 입찰 최저가: {(format(item_dict.get('min_bid', 0), ',') + '원') if item_dict.get('min_bid') else '비공개/정보없음'}
- 최종 낙찰 금액: {item_dict.get('winning_bid', 0):,}원 (낙찰가율 {item_dict.get('winning_rate', 0)}%)
- 유효 입찰자수: {str(item_dict.get('bidder_count')) + '명' if item_dict.get('bidder_count') else '정보없음'}
- 2등 차순위 입찰가: {(format(item_dict.get('runner_up_bid'), ',') + '원 (격차: ' + format(max(0, item_dict.get('winning_bid', 0) - item_dict.get('runner_up_bid')), ',') + '원)') if item_dict.get('runner_up_bid') else '정보없음(공개되지 않음)'}
- 등기부 권리내역: {item_dict.get('rights_list') if item_dict.get('rights_list') not in (None, '', '[]') else '정보없음'}
- 임차인 현황: {item_dict.get('tenant_registration_date') or '정보없음'}
- 네이버/감정 시세: {(format(item_dict.get('market_price'), ',') + '원') if item_dict.get('market_price') else '정보없음'}
"""
    else:
        results_summary = "\n".join([
            f"- {r['case_number']} ({r['location']}): 감정가 {r['appraisal']:,}원 -> 낙찰가 {r['winning_bid']:,}원 (낙찰가율 {r['winning_rate']}%, 유효입찰 {r['bidder_count'] or '정보없음'}명)"
            for r in recent_results
        ])
        context_str = f"""
[최근 주요 낙찰 결과 실거래 데이터]
{results_summary}
"""

    system_prompt = f"""
당신은 대한민국 최고의 부동산 경매 및 실전 투자 수석 AI 비서(Investment Secretary Agent)입니다.
투자자가 "왜 이 가격에 낙찰됐어?", "2등과 왜 이렇게 차이가 적어?", "인수할 권리 없어?", "앞으로 어떻게 엑시트해?" 등 경매 낙찰 결과와 매물에 대해 자유롭게 묻고 대화합니다.

지침:
1. 상투적인 서론은 줄이고, 질문에 대한 날카롭고 깊이 있는 분석을 전문적이면서도 친절한 비서의 말투(~하셨습니다, ~로 판단됩니다)로 답변하십시오.
2. 금액은 억/만원 단위(예: 3억 5,200만원)를 함께 적어 가독성을 높이십시오.
3. 1등 낙찰자와 2등 차순위 입찰자의 심리, 유찰에 따른 가격 매력도, 임대수익률 및 갭투자 등 실무적 시각을 제시하십시오.
4. '정보없음'으로 표기된 항목(2등 입찰가, 권리내역 등)은 절대 추측하거나 지어내지 말고, 공개되지 않은 정보라고 솔직히 밝히십시오. 확인된 수치(감정가, 낙찰가, 낙찰가율, 입찰자수)만 근거로 분석하십시오.\n5. 만약 특정 물건이 아닌 일반 질문이라면, 보유한 실거래 낙찰 통계와 시장 흐름을 토대로 명쾌하게 조언하십시오.

데이터 컨텍스트:
{context_str}
"""

    messages = [{"role": "system", "content": system_prompt}]

    if chat_history and isinstance(chat_history, list):
        for msg in chat_history[-6:]:
            if isinstance(msg, dict) and msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    try:
        client = OpenAI(api_key=openai_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.3,
            max_tokens=850
        )
        return {
            "reply": resp.choices[0].message.content,
            "referenced_item": item_dict,
            "ai_model": "gpt-4o-mini"
        }
    except Exception as e:
        return {"error": f"AI 응답 생성 실패: {str(e)}"}
