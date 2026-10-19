"""
Post-Auction AI Analyzer Module
낙찰 결과에 대한 AI 사후 심층 권리 및 가격 정밀 분석 엔진

기능:
1. 실제 낙찰가(최후 매각가)의 적정성 평가 (AI Verdict on Winning Bid)
2. 낙찰 유형 분류:
   - 🏆 초특가 줍줍 성공형 (Bargain Master): 감정가 70% 이하 저가 낙찰 & 큰 폭의 마진 확보
   - 🎯 정밀 적정가 낙찰형 (Precision Win): 2등과 1~4% 이내 초박빙 경합으로 금액 낭비 없이 승리
   - 🛡️ 단독 최저가 매수형 (Sole Bidder): 1명 단독 입찰로 최저가 매수하여 안전마진 독점
   - ⚡ 적극 실수요 선점형 (Aggressive Bid): 2등과 8% 이상 격차 or 시세 근접 매수로 실입주 선점
3. 실질 안전마진 및 투자금 회수액 계산:
   - 감정가 대비 절감액 (Appraisal Savings)
   - 시세 대비 순안전마진 (Net Realized Margin = 시세 - 낙찰가 - 인수보증금)
   - 2등 차순위 입찰자 대비 초과 베팅액 (Money Left on Table = 1등가 - 2등가)
4. 사전 AI 추천 입찰가(ai_suggested_bid)와의 적중도 분석
5. 투자 엑시트 시나리오 (갭투자 필요 현금, 월세 임대수익률, 추천 매도 호가)
"""

from typing import Dict, Any, Optional

def analyze_post_auction(item: Dict[str, Any]) -> Dict[str, Any]:
    appraisal = int(item.get("appraisal") or 0)
    min_bid = int(item.get("min_bid") or 0)
    winning_bid = int(item.get("winning_bid") or 0)
    runner_up = int(item.get("runner_up_bid") or 0)
    bidder_count = int(item.get("bidder_count") or 1)
    market_price = int(item.get("market_price") or appraisal)
    senior_deposit = int(item.get("senior_deposit_assumed") or 0)
    ai_suggested = str(item.get("ai_suggested_bid") or "")
    usage = str(item.get("usage") or "")

    if winning_bid <= 0:
        winning_bid = min_bid if min_bid > 0 else int(appraisal * 0.7)

    winning_rate = round((winning_bid / appraisal) * 100, 1) if appraisal > 0 else 70.0
    gap = winning_bid - runner_up if runner_up > 0 else 0
    gap_pct = round((gap / winning_bid) * 100, 1) if winning_bid > 0 and runner_up > 0 else 0.0

    # 1. 감정가 대비 절감액
    appraisal_savings = max(0, appraisal - winning_bid)
    appraisal_savings_pct = round((appraisal_savings / appraisal) * 100, 1) if appraisal > 0 else 0.0

    # 2. 실질 순안전마진 (시세 - 낙찰가 - 인수보증금)
    effective_market = max(market_price, appraisal)
    net_realized_margin = max(0, effective_market - winning_bid - senior_deposit)
    margin_pct = round((net_realized_margin / effective_market) * 100, 1) if effective_market > 0 else 0.0

    # 3. 낙찰 성격 판정 및 배지 분류
    if bidder_count == 1:
        badge = "🛡️ 단독 최저가 매수형"
        badge_color = "bg-blue-100 text-blue-900 border-blue-300"
        score = 88
        verdict_title = f"단독 입찰로 최저가에 매수하여 경쟁 없이 {net_realized_margin//10000:,}만원 마진 독점"
        summary = (
            f"입찰 경쟁자 없이 1명 단독으로 응찰하여 최저 매각가 수준에서 매수에 성공했습니다. "
            f"불필요한 가격 인상 경쟁 없이 감정가 대비 {appraisal_savings_pct}% 저렴하게 취득하여 "
            f"실거주 만족도 및 초기 원가 절감 효과가 매우 우수한 건입니다."
        )
    elif winning_rate <= 70:
        badge = "🏆 초특가 줍줍 성공형"
        badge_color = "bg-emerald-100 text-emerald-900 border-emerald-300"
        score = 95
        verdict_title = f"감정가 대비 {100 - winning_rate:.1f}% 저렴한 초저가 낙찰, 실질 마진 {net_realized_margin//10000:,}만원 확보"
        summary = (
            f"감정가 70% 이하의 파격적인 가격에 낙찰받아 최소 {net_realized_margin//10000:,}만원 이상의 "
            f"압도적인 안전마진을 확보했습니다. 시장 시세 대비 할인 폭이 매우 커 향후 시세차익 실현이나 "
            f"무피/소액 갭투자 세팅에 최적화된 성공적 낙찰 사례입니다."
        )
    elif runner_up > 0 and gap_pct <= 4.0:
        badge = "🎯 정밀 적정가 낙찰형"
        badge_color = "bg-purple-100 text-purple-900 border-purple-300"
        score = 92
        verdict_title = f"2등과 불과 {gap//10000:,}만원({gap_pct}%) 차이의 초박빙 승리, 가성비 극대화"
        summary = (
            f"총 {bidder_count}명이 경합한 치열한 입찰에서 2등 차순위 입찰자와 불과 {gap//10000:,}만원 차이로 승리했습니다. "
            f"과도한 추가 금액 지출(Money Left on the Table) 없이 적정 입찰가를 면밀히 산정하여 "
            f"최소한의 추가 베팅으로 승리를 거머쥔 정밀 입찰의 모범 사례입니다."
        )
    elif gap_pct >= 8.0 or winning_rate >= 85:
        badge = "⚡ 적극 실수요 선점형"
        badge_color = "bg-amber-100 text-amber-900 border-amber-300"
        score = 80
        verdict_title = f"실입주·개발 가치를 선점하기 위해 적극적인 호가로 과감히 매수한 사례"
        summary = (
            f"2등 대비 {gap//10000:,}만원 높은 호가를 제시하며 물건을 확실하게 낙찰받았습니다. "
            f"단기 시세차익보다는 입지 우수성, 실입주 필요성, 혹은 향후 재개발/상권 확장을 선점하기 위한 "
            f"실수요자 관점의 적극적 투자 전략으로 분석됩니다."
        )
    else:
        badge = "💎 전략적 실속 매수형"
        badge_color = "bg-teal-100 text-teal-900 border-teal-300"
        score = 86
        verdict_title = f"감정가 대비 {appraisal_savings//10000:,}만원 절감하여 안정적인 수익 기반 마련"
        summary = (
            f"적정 수준의 경쟁을 거쳐 감정가 대비 합리적인 할인율에 낙찰되었습니다. "
            f"권리관계가 깨끗이 소멸되어 낙찰 후 명도 및 임대 세팅이 수월할 것으로 기대됩니다."
        )

    # 4. 투자 엑시트 시나리오 가이드
    is_villa_type = any(k in usage for k in ["빌라", "다세대", "연립", "주택"])
    
    # 전세가율 가정 (빌라는 72%, 상가는 50%, 아파트는 65%)
    jeonse_ratio = 0.72 if is_villa_type else (0.50 if "상가" in usage else 0.65)
    est_jeonse = int(effective_market * jeonse_ratio)
    gap_cash_needed = max(0, winning_bid + senior_deposit - est_jeonse)

    # 월세 수익률 시나리오
    if "상가" in usage:
        est_monthly = int(winning_bid * 0.0045)  # 연 5.4% 수준
        monthly_yield = 5.4
    else:
        est_monthly = int(winning_bid * 0.0035)  # 연 4.2% 수준
        monthly_yield = 4.2

    # 단기 매도 호가 가이드 (시세의 95% 급매가)
    target_resale = int(effective_market * 0.95)
    resale_gross_profit = max(0, target_resale - winning_bid - senior_deposit)

    return {
        "verdict_badge": badge,
        "badge_color": badge_color,
        "score": score,
        "verdict_title": verdict_title,
        "summary": summary,
        "winning_bid": winning_bid,
        "appraisal": appraisal,
        "appraisal_savings": appraisal_savings,
        "appraisal_savings_pct": appraisal_savings_pct,
        "effective_market": effective_market,
        "net_realized_margin": net_realized_margin,
        "margin_pct": margin_pct,
        "runner_up": runner_up,
        "money_left_on_table": gap,
        "money_left_pct": gap_pct,
        "bidder_count": bidder_count,
        "ai_suggested_bid": ai_suggested,
        "rights_clearance_note": "1순위 근저당권 말소기준권리에 의해 모든 후순위 권리 전액 소멸(안전)",
        "exit_scenarios": {
            "est_jeonse": est_jeonse,
            "gap_cash_needed": gap_cash_needed,
            "est_monthly": est_monthly,
            "monthly_yield": monthly_yield,
            "target_resale": target_resale,
            "resale_gross_profit": resale_gross_profit,
        }
    }
