#!/usr/bin/env python3
"""
경매 물건 ↔ 네이버 부동산 시세 비교 분석

사용법:
    python compare.py                    # 전체 비교 출력
    python compare.py --min-yield 4.0    # 수익률 4% 이상만
    python compare.py --max-bid 3억      # 3억 이하 최저가
    python compare.py --region 수원      # 지역 필터

비교 로직:
  1. auction_items 테이블에서 면적(area_m2) + 법정동코드(legal_div_no) 있는 물건 로드
  2. legal_div_no 또는 addr_emd/addr_sgg로 naver_listings와 매칭
  3. 네이버 매매 시세 → 경매 할인율 계산
  4. 네이버 월세 시세 → 예상 수익률 계산
  5. 사용자 필터 조건 적용 후 랭킹 출력
"""

import argparse
import sqlite3
from typing import Dict, List, Optional, Tuple

PYEONG = 3.3058
DB_FILE = "auction_db.sqlite"


# ─────────────────────────────────────────────────────────────
# 데이터 로드
# ─────────────────────────────────────────────────────────────

def load_auction_items(db_path: str, region_filter: str = "") -> List[Dict]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        q = """
            SELECT case_number, location, appraisal, min_bid, failed_count,
                   area_m2, legal_div_no, addr_sgg, addr_emd,
                   ai_score, ai_grade, ai_verdict
            FROM auction_items
            WHERE area_m2 > 0
        """
        params: list = []
        if region_filter:
            q += " AND (location LIKE ? OR addr_sgg LIKE ? OR addr_emd LIKE ?)"
            like = f"%{region_filter}%"
            params = [like, like, like]
        rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


def load_naver_listings(db_path: str, region_filter: str = "") -> List[Dict]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        q = """
            SELECT article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                   trade_type, trade_type_cd, area_m2, area_pyeong,
                   price_sale_10k, deposit_10k, monthly_rent_10k,
                   floor, total_floor, detail_url
            FROM naver_listings
            WHERE area_m2 > 0
        """
        params: list = []
        if region_filter:
            q += " AND (region_name LIKE ? OR addr_sgg LIKE ? OR addr_emd LIKE ?)"
            like = f"%{region_filter}%"
            params = [like, like, like]
        rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────────────
# 매칭 + 시세 계산
# ─────────────────────────────────────────────────────────────

def _match_listings(auction_item: Dict, naver_all: List[Dict], trade_type_cd: str) -> Tuple[List[Dict], str]:
    """경매 물건 위치와 같은 지역의 네이버 매물 필터링 (면적 ±40% 이내, 동일동→동일구→동일시 fallback)"""
    target_area = auction_item.get("area_m2") or 0
    min_area = target_area * 0.6
    max_area = target_area * 1.4

    adiv = auction_item.get("legal_div_no") or ""
    aemd = auction_item.get("addr_emd") or ""
    asgg = auction_item.get("addr_sgg") or ""
    location = auction_item.get("location") or ""
    sido = location.split()[0] if location else ""

    matched_emd = []
    matched_sgg = []
    matched_sido = []

    for n in naver_all:
        if n["trade_type_cd"] != trade_type_cd:
            continue

        n_area = n.get("area_m2") or 0
        if not (min_area <= n_area <= max_area):
            continue

        n_div = n.get("legal_div_no")
        n_emd = n.get("addr_emd")
        n_sgg = n.get("addr_sgg")
        n_rn = n.get("region_name") or ""

        # 1. 법정동 일치
        if (adiv and n_div == adiv) or (aemd and asgg and n_emd == aemd and n_sgg == asgg):
            matched_emd.append(n)
        # 2. 구 일치
        elif asgg and n_sgg == asgg:
            matched_sgg.append(n)
        # 3. 시 일치
        elif sido and (n_rn.startswith(sido) or (sido in n_rn)):
            matched_sido.append(n)

    if len(matched_emd) > 0:
        return matched_emd, "동일동"
    elif len(matched_sgg) > 0:
        return matched_sgg, "동일구"
    elif len(matched_sido) > 0:
        return matched_sido, "동일시"

    return [], "매칭없음"


def _avg_price_per_m2(listings: List[Dict]) -> float:
    valid = [n for n in listings if n["price_sale_10k"] > 0 and n["area_m2"] > 0]
    if not valid:
        return 0.0
    return sum(n["price_sale_10k"] * 10000 / n["area_m2"] for n in valid) / len(valid)


def _avg_monthly_rent_per_pyeong(listings: List[Dict]) -> Tuple[float, float]:
    valid = [n for n in listings if n["monthly_rent_10k"] > 0 and n.get("area_pyeong", 0) > 0]
    if not valid:
        return 0.0, 0.0
    avg_rpp = sum(n["monthly_rent_10k"] / n["area_pyeong"] for n in valid) / len(valid)
    avg_dep = sum(n["deposit_10k"] for n in valid) / len(valid)
    return round(avg_rpp, 2), round(avg_dep, 0)


def compare_one(auction_item: Dict, naver_all: List[Dict]) -> Optional[Dict]:
    area_m2 = auction_item.get("area_m2") or 0
    if area_m2 <= 0:
        return None

    min_bid   = auction_item.get("min_bid") or 0
    appraisal = auction_item.get("appraisal") or 0
    if min_bid <= 0:
        return None

    area_pyeong = area_m2 / PYEONG

    # 매매 시세
    sale_matches, sale_match_level = _match_listings(auction_item, naver_all, "A1")
    avg_price_per_m2 = _avg_price_per_m2(sale_matches)
    est_market_value = avg_price_per_m2 * area_m2 if avg_price_per_m2 else 0

    # 할인율: (시세 - 최저가) / 시세
    market_discount_pct = 0.0
    if est_market_value > 0:
        market_discount_pct = round((est_market_value - min_bid) / est_market_value * 100, 1)

    # 감정가 기준 할인율 (기존)
    appraisal_discount_pct = round((appraisal - min_bid) / appraisal * 100, 1) if appraisal > 0 else 0

    # 월세 시세 → 수익률
    rent_matches, rent_match_level = _match_listings(auction_item, naver_all, "B2")
    avg_rpp, avg_dep = _avg_monthly_rent_per_pyeong(rent_matches)
    est_monthly_rent_10k = round(avg_rpp * area_pyeong, 1) if avg_rpp and area_pyeong else 0.0
    denom = min_bid / 10000 - avg_dep  # 단위: 만원
    yield_pct = round((est_monthly_rent_10k * 12 / denom) * 100, 2) if denom > 0 and est_monthly_rent_10k > 0 else 0.0

    return {
        **auction_item,
        "area_pyeong"             : round(area_pyeong, 1),
        "min_bid_10k"             : min_bid // 10000,
        "appraisal_10k"           : appraisal // 10000,
        "appraisal_discount_pct"  : appraisal_discount_pct,
        "est_market_value_10k"    : round(est_market_value / 10000, 0),
        "market_discount_pct"     : market_discount_pct,
        "sale_match_count"        : len(sale_matches),
        "sale_match_level"        : sale_match_level,
        "avg_price_per_m2"        : round(avg_price_per_m2, 0),
        "est_monthly_rent_10k"    : est_monthly_rent_10k,
        "yield_pct"               : yield_pct,
        "rent_match_count"        : len(rent_matches),
        "rent_match_level"        : rent_match_level,
    }


# ─────────────────────────────────────────────────────────────
# 필터 + 랭킹
# ─────────────────────────────────────────────────────────────

def filter_and_rank(
    results: List[Dict],
    min_yield: float = 0.0,
    max_bid_10k: Optional[int] = None,
    min_market_discount: float = -999,
) -> List[Dict]:
    out = []
    for r in results:
        if r["yield_pct"] < min_yield:
            continue
        if max_bid_10k and r["min_bid_10k"] > max_bid_10k:
            continue
        if r["market_discount_pct"] < min_market_discount:
            continue
        out.append(r)
    # 수익률 우선, 시세할인율 차순
    out.sort(key=lambda x: (x["yield_pct"], x["market_discount_pct"]), reverse=True)
    return out


# ─────────────────────────────────────────────────────────────
# 출력
# ─────────────────────────────────────────────────────────────

def fmt_price(val_10k: float) -> str:
    if val_10k <= 0:
        return "정보없음"
    if val_10k >= 10000:
        eok, rem = int(val_10k // 10000), int(val_10k % 10000)
        return f"{eok}억 {rem:,}만원" if rem else f"{eok}억원"
    return f"{int(val_10k):,}만원"


def print_results(results: List[Dict], top_n: int = 10):
    sep = "═" * 70
    print(f"\n{sep}")
    print(f"  경매 물건 × 네이버 시세 비교 결과  (상위 {min(top_n, len(results))}건)")
    print(sep)

    if not results:
        print("  조건에 맞는 물건이 없습니다.")
        print("  → naver_land_scraper.py 를 먼저 실행해 네이버 데이터를 수집하세요.")
        return

    for i, r in enumerate(results[:top_n], 1):
        print(f"\n  [{i}] {r['case_number']}  AI: {r.get('ai_grade','?')} {r.get('ai_score','?')}점")
        print(f"      소재지  : {r['location']}")
        print(f"      면적    : {r['area_m2']:.1f}㎡ ({r['area_pyeong']:.1f}평)")
        print(f"      최저가  : {fmt_price(r['min_bid_10k'])}")
        print(f"      감정가  : {fmt_price(r['appraisal_10k'])}  "
              f"(감정가 대비 할인 {r['appraisal_discount_pct']:.1f}%)")

        if r["sale_match_count"] > 0:
            print(f"      네이버시세: {fmt_price(r['est_market_value_10k'])}  "
                  f"(시세 대비 {'할인' if r['market_discount_pct'] > 0 else '프리미엄'} "
                  f"{abs(r['market_discount_pct']):.1f}%,  "
                  f"비교매물 {r['sale_match_count']}건 [{r.get('sale_match_level', '알수없음')}])")
        else:
            print(f"      네이버시세: 비교 매물 없음 (해당 지역 크롤링 필요)")

        if r["rent_match_count"] > 0 and r["est_monthly_rent_10k"] > 0:
            print(f"      예상월세 : {fmt_price(r['est_monthly_rent_10k'])}/월  "
                  f"→ 예상수익률 {r['yield_pct']:.2f}% (비교매물 {r['rent_match_count']}건 [{r.get('rent_match_level', '알수없음')}])")
        else:
            print(f"      예상수익률: 월세 데이터 부족")

        if r.get("ai_verdict"):
            verdict = r["ai_verdict"][:60] + "..." if len(r.get("ai_verdict","")) > 60 else r.get("ai_verdict","")
            print(f"      AI 의견  : {verdict}")

    print(f"\n{sep}")


def print_region_stats(naver_all: List[Dict]):
    """수집된 네이버 데이터 지역별 통계"""
    from collections import defaultdict
    stats: Dict[str, Dict] = defaultdict(lambda: {"매매": 0, "전세": 0, "월세": 0, "avg_m2_price": []})

    for n in naver_all:
        rn = n.get("region_name") or f"{n.get('addr_sgg','')} {n.get('addr_emd','')}"
        stats[rn][n["trade_type"]] = stats[rn].get(n["trade_type"], 0) + 1
        if n["trade_type"] == "매매" and n["price_sale_10k"] > 0 and n["area_m2"] > 0:
            stats[rn]["avg_m2_price"].append(n["price_sale_10k"] * 10000 / n["area_m2"])

    print(f"\n{'─'*60}")
    print("  네이버 수집 현황 (지역별)")
    print(f"{'─'*60}")
    for rn, s in sorted(stats.items()):
        prices = s.get("avg_m2_price", [])
        avg_str = f"평균 {sum(prices)/len(prices)/10000:.1f}만/㎡" if prices else "시세없음"
        print(f"  {rn:20s}  매매:{s.get('매매',0):3d}  전세:{s.get('전세',0):3d}  "
              f"월세:{s.get('월세',0):3d}  ({avg_str})")


# ─────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="경매 × 네이버 시세 비교")
    ap.add_argument("--db", default=DB_FILE, help="SQLite DB 경로")
    ap.add_argument("--region", default="", help="지역 필터 (예: 수원, 성남, 분당)")
    ap.add_argument("--min-yield", type=float, default=0.0, help="최소 수익률 %%")
    ap.add_argument("--max-bid", type=str, default="", help="최고 최저가 (예: 3억, 5000만)")
    ap.add_argument("--min-discount", type=float, default=-999, help="최소 시세 할인율 %%")
    ap.add_argument("--top", type=int, default=10, help="출력 상위 N건")
    ap.add_argument("--stats", action="store_true", help="지역별 네이버 수집 통계 출력")
    args = ap.parse_args()

    # 최고 최저가 파싱
    max_bid_10k = None
    if args.max_bid:
        s = args.max_bid.replace(",", "").replace(" ", "")
        if "억" in s:
            parts = s.split("억")
            eok = int(parts[0]) * 10000
            rem = int(parts[1].replace("만", "").replace("원", "") or 0) if parts[1] else 0
            max_bid_10k = eok + rem
        elif "만" in s:
            max_bid_10k = int(s.replace("만", "").replace("원", ""))
        else:
            max_bid_10k = int(s) // 10000

    auction_items = load_auction_items(args.db, args.region)
    naver_all     = load_naver_listings(args.db, args.region)

    print(f"경매 물건(면적있음): {len(auction_items)}건")
    print(f"네이버 매물:         {len(naver_all)}건")

    if args.stats:
        print_region_stats(naver_all)

    if not naver_all:
        print("\n[주의] 네이버 데이터가 없습니다. naver_land_scraper.py 를 먼저 실행하세요.")
        return

    results = []
    for item in auction_items:
        r = compare_one(item, naver_all)
        if r:
            results.append(r)

    filtered = filter_and_rank(
        results,
        min_yield=args.min_yield,
        max_bid_10k=max_bid_10k,
        min_market_discount=args.min_discount,
    )

    print_results(filtered, top_n=args.top)


if __name__ == "__main__":
    main()
