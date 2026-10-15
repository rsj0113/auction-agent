"""
Market Matcher & Safety Margin Engine
경매 물건 ↔ 네이버 부동산 시세 비교 및 진짜 안전마진 계산 모듈

핵심 로직:
1. 선순위 인수 보증금 계산:
   - 대항력 있는 선순위 임차인이 배당요구를 하지 않았거나 전액 배당받지 못하는 보증금 합산
2. 네이버 부동산 실매물 매칭:
   - 1순위: 동일동 (법정동 코드 또는 시/구 + 동/읍/면 일치, 전용면적 ±40%)
   - 2순위: 동일구 (시/구 일치, 전용면적 ±40%)
   - 3순위: 동일시 (시/군 일치, 전용면적 ±40%)
3. 진짜 안전마진 (Net Safety Margin) 산출:
   - 진짜 안전마진 = 네이버 추정 시세 - 최저입찰가 - 선순위 인수 보증금
   - 실질 할인율 = (네이버 시세 - 최저입찰가 - 인수보증금) / 네이버 시세 * 100
4. 임대수익률 산출:
   - 동일 지역 월세 매물 기반 예상 월세 및 연간 임대수익률 계산
"""

import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

PYEONG = 3.3058


def extract_assumed_deposit(item: Dict[str, Any]) -> int:
    """
    선순위 임차인 인수 보증금 총액 계산 (원 단위)
    """
    assumed = 0
    tenant_deposit = item.get("tenant_deposit") or 0
    is_payout_requested = bool(item.get("is_payout_requested"))
    ai_verdict = str(item.get("ai_verdict") or "")
    
    # 1. ai_report_json 내 tenants 상세 분석
    report_raw = item.get("ai_report_json")
    if report_raw:
        try:
            report = json.loads(report_raw) if isinstance(report_raw, str) else report_raw
            tenants = report.get("tenants", [])
            if isinstance(tenants, list) and tenants:
                tenant_sum = 0
                for t in tenants:
                    dep = t.get("deposit")
                    payout_req = t.get("is_payout_requested", False)
                    # 배당요구를 하지 않았거나 미배당인 경우
                    if not payout_req:
                        if isinstance(dep, (int, float)) and dep > 0:
                            tenant_sum += int(dep)
                        elif isinstance(dep, str):
                            clean_dep = re.sub(r"[^0-9]", "", dep)
                            if clean_dep:
                                val = int(clean_dep)
                                # 만원 단위 표기인 경우 보정
                                if "억" in dep or "만" in dep:
                                    if "억" in dep and "만" in dep:
                                        m = re.search(r"(\d+)억\s*(\d+)만", dep)
                                        if m:
                                            val = (int(m.group(1)) * 10000 + int(m.group(2))) * 10000
                                    elif "억" in dep:
                                        m = re.search(r"(\d+)억", dep)
                                        if m:
                                            val = int(m.group(1)) * 100000000
                                    elif "만" in dep:
                                        m = re.search(r"(\d+)만", dep)
                                        if m:
                                            val = int(m.group(1)) * 10000
                                tenant_sum += val
                if tenant_sum > 0:
                    assumed = max(assumed, tenant_sum)
        except Exception:
            pass

    # 2. ai_report_json에 없거나 계산 안 된 경우 기본 tenant_deposit 검토
    if assumed == 0 and tenant_deposit > 0:
        # 배당요구를 안 했거나 위험(인수) 판정인 경우
        if not is_payout_requested or "인수" in ai_verdict or "대항력" in ai_verdict:
            assumed = int(tenant_deposit)

    return assumed


class MarketMatcher:
    def __init__(self, db_path: str = "auction_db.sqlite"):
        self.db_path = db_path
        self.naver_listings: List[Dict[str, Any]] = []
        self._load_naver_listings()

    def _load_naver_listings(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                       trade_type, trade_type_cd, area_m2, area_pyeong,
                       price_sale_10k, deposit_10k, monthly_rent_10k,
                       floor, total_floor, detail_url, article_name
                FROM naver_listings
                WHERE area_m2 > 0
            """).fetchall()
        self.naver_listings = [dict(r) for r in rows]

    def match_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """
        단일 경매 물건에 대해 네이버 시세 및 안전마진을 계산하여 반환
        """
        area_m2 = float(item.get("area_m2") or 0.0)
        min_bid = int(item.get("min_bid") or 0)
        appraisal = int(item.get("appraisal") or 0)
        
        adiv = str(item.get("legal_div_no") or "")
        aemd = str(item.get("addr_emd") or "")
        asgg = str(item.get("addr_sgg") or "")
        loc = str(item.get("location") or "")
        sido = loc.split()[0] if loc else ""

        # 면적 범위 설정 (면적 정보가 있을 경우 ±40%)
        has_area = area_m2 > 0
        min_area = area_m2 * 0.6 if has_area else 0
        max_area = area_m2 * 1.4 if has_area else 999999

        matched_emd_sale = []
        matched_sgg_sale = []
        matched_sido_sale = []

        matched_emd_rent = []
        matched_sgg_rent = []
        matched_sido_rent = []

        for n in self.naver_listings:
            n_area = float(n.get("area_m2") or 0.0)
            if has_area and not (min_area <= n_area <= max_area):
                continue

            n_div = str(n.get("legal_div_no") or "")
            n_emd = str(n.get("addr_emd") or "")
            n_sgg = str(n.get("addr_sgg") or "")
            n_rn = str(n.get("region_name") or "")
            trade_cd = str(n.get("trade_type_cd") or "")

            is_emd = False
            is_sgg = False
            is_sido = False

            # 1. 동일동 매칭 (법정동코드 일치 또는 동일 시/구 + 읍/면/동)
            if (adiv and n_div == adiv) or (aemd and asgg and n_emd == aemd and (n_sgg == asgg or asgg in n_sgg or n_sgg in asgg)):
                is_emd = True
            # 2. 동일구 매칭
            elif asgg and (n_sgg == asgg or asgg in n_sgg or n_sgg in asgg):
                is_sgg = True
            # 3. 동일시 매칭
            elif sido and (n_rn.startswith(sido) or sido in n_rn or (asgg and asgg[:2] in n_sgg)):
                is_sido = True

            if trade_cd == "A1" or n.get("trade_type") == "매매":
                if is_emd:
                    matched_emd_sale.append(n)
                elif is_sgg:
                    matched_sgg_sale.append(n)
                elif is_sido:
                    matched_sido_sale.append(n)

            elif trade_cd == "B2" or n.get("trade_type") == "월세":
                if is_emd:
                    matched_emd_rent.append(n)
                elif is_sgg:
                    matched_sgg_rent.append(n)
                elif is_sido:
                    matched_sido_rent.append(n)

        # 매매 매칭 우선순위 선정
        if matched_emd_sale:
            chosen_sales = matched_emd_sale
            match_level = "동일동"
        elif matched_sgg_sale:
            chosen_sales = matched_sgg_sale
            match_level = "동일구"
        elif matched_sido_sale:
            chosen_sales = matched_sido_sale
            match_level = "동일시"
        else:
            chosen_sales = []
            match_level = "매칭없음"

        # 시세 단가 계산 (원/㎡)
        valid_sales = [s for s in chosen_sales if (s.get("price_sale_10k") or 0) > 0 and (s.get("area_m2") or 0) > 0]
        market_price = 0
        min_market_price = 0
        if valid_sales:
            prices_per_m2 = [s["price_sale_10k"] * 10000 / s["area_m2"] for s in valid_sales]
            avg_ppm2 = sum(prices_per_m2) / len(prices_per_m2)
            min_ppm2 = min(prices_per_m2)
            
            if has_area:
                market_price = int(avg_ppm2 * area_m2)
                min_market_price = int(min_ppm2 * area_m2)
            else:
                # 면적이 없는 경우 매물들의 평균 매매가
                market_price = int(sum(s["price_sale_10k"] * 10000 for s in valid_sales) / len(valid_sales))
                min_market_price = int(min(s["price_sale_10k"] * 10000 for s in valid_sales))

        # 월세 매칭 우선순위 선정
        if matched_emd_rent:
            chosen_rents = matched_emd_rent
        elif matched_sgg_rent:
            chosen_rents = matched_sgg_rent
        elif matched_sido_rent:
            chosen_rents = matched_sido_rent
        else:
            chosen_rents = []

        valid_rents = [
            r for r in chosen_rents
            if (r.get("monthly_rent_10k") or 0) > 0 and (r.get("area_pyeong") or 0) > 0
        ]
        
        est_monthly_rent = 0
        rental_yield = 0.0
        area_pyeong = area_m2 / PYEONG if has_area else 0.0
        
        if valid_rents:
            avg_rpp = sum(r["monthly_rent_10k"] / r["area_pyeong"] for r in valid_rents) / len(valid_rents)
            avg_dep_10k = sum(r.get("deposit_10k") or 0 for r in valid_rents) / len(valid_rents)
            
            target_pyeong = area_pyeong if area_pyeong > 0 else sum(r["area_pyeong"] for r in valid_rents) / len(valid_rents)
            est_monthly_rent = int(avg_rpp * target_pyeong * 10000)
            
            denom = min_bid - int(avg_dep_10k * 10000)
            if denom > 0 and est_monthly_rent > 0:
                rental_yield = round((est_monthly_rent * 12 / denom) * 100, 2)

        # 선순위 인수 보증금
        senior_deposit = extract_assumed_deposit(item)
        net_cost = min_bid + senior_deposit

        # 안전마진 계산
        if market_price > 0:
            safety_margin = market_price - net_cost
            market_discount_pct = round((market_price - net_cost) / market_price * 100, 1)
        else:
            # 네이버 매칭이 없는 경우 감정가 기준 보조 계산
            safety_margin = appraisal - net_cost if appraisal > 0 else 0
            market_discount_pct = round((appraisal - net_cost) / appraisal * 100, 1) if appraisal > 0 else 0.0

        # 대표 비교 매물 (최대 3건)
        sample_listings = []
        for s in valid_sales[:3]:
            sample_listings.append({
                "article_id": s.get("article_id"),
                "article_name": s.get("article_name") or f"{s.get('addr_emd','')} 매물",
                "trade_type": s.get("trade_type", "매매"),
                "price_sale_10k": s.get("price_sale_10k"),
                "area_m2": round(float(s.get("area_m2") or 0), 1),
                "area_pyeong": round(float(s.get("area_pyeong") or 0), 1),
                "floor": s.get("floor"),
                "total_floor": s.get("total_floor"),
                "detail_url": s.get("detail_url")
            })

        return {
            "market_price": market_price,
            "min_market_price": min_market_price,
            "safety_margin": safety_margin,
            "market_discount_pct": market_discount_pct,
            "market_match_count": len(valid_sales),
            "market_match_level": match_level if len(valid_sales) > 0 else "미매칭",
            "senior_deposit_assumed": senior_deposit,
            "est_monthly_rent": est_monthly_rent,
            "rental_yield": rental_yield,
            "sample_listings": sample_listings,
        }

    def update_database(self) -> Dict[str, int]:
        """
        auction_items 테이블의 전체 물건에 대해 시세 및 안전마진 지표를 일괄 계산하여 저장
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            items = cursor.execute("""
                SELECT case_number, location, appraisal, min_bid, area_m2,
                       legal_div_no, addr_sgg, addr_emd, tenant_deposit,
                       is_payout_requested, ai_verdict, ai_report_json
                FROM auction_items
            """).fetchall()
            
            stats = {"total": len(items), "matched": 0, "positive_margin": 0}
            
            update_data = []
            for row in items:
                item_dict = dict(row)
                metrics = self.match_item(item_dict)
                
                if metrics["market_match_count"] > 0:
                    stats["matched"] += 1
                if metrics["safety_margin"] > 0:
                    stats["positive_margin"] += 1
                    
                update_data.append((
                    metrics["market_price"],
                    metrics["safety_margin"],
                    metrics["market_discount_pct"],
                    metrics["market_match_count"],
                    metrics["market_match_level"],
                    metrics["est_monthly_rent"],
                    metrics["rental_yield"],
                    item_dict["case_number"]
                ))
            
            cursor.executemany("""
                UPDATE auction_items
                SET market_price = ?,
                    safety_margin = ?,
                    market_discount_pct = ?,
                    market_match_count = ?,
                    market_match_level = ?,
                    est_monthly_rent = ?,
                    rental_yield = ?
                WHERE case_number = ?
            """, update_data)
            
            conn.commit()
            return stats


if __name__ == "__main__":
    matcher = MarketMatcher()
    stats = matcher.update_database()
    print("Market Matcher Batch Update Complete:", stats)
