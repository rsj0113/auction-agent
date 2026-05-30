#!/usr/bin/env python3
"""
네이버 부동산 상가 매물 크롤링 + SQLite 저장 + 수익성 분석

크롤링 전략:
  - Playwright로 fin.land.naver.com 세션 획득 후
  - page.evaluate(fetch)로 내부 API 직접 호출 (UI 클릭 없음 → 안정적)
  - 커서 기반 페이지네이션으로 전체 매물 수집

API 정보 (역공학):
  BASE: https://fin.land.naver.com/front-api/v1
  매물목록: POST /article/legalDivisionArticleList
    body: { legalDivisionNumber, tradeTypes, realestateTypes,
            articlePagingRequest: { size, userChannelType, cursor? } }
  거래유형: A1=매매, B1=전세, B2=월세
  매물유형: D02=상가점포, D03=빌딩/건물, D04=상가건물, D05=상가주택

법정동 코드: 시도(2) + 시군구(3) + 읍면동(3) + 리(2) = 10자리
  → 경매 API gdsDspslObjctLst[0].rprsAdong{Sd,Sgg,Emd,Ri}Cd 이어붙이면 동일
"""

import asyncio
import json
import re
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from playwright.async_api import async_playwright

# ─────────────────────────────────────────────────────────────
# 상수
# ─────────────────────────────────────────────────────────────

COMMERCIAL_TYPES = ["D02", "D04", "D05"]  # 상가점포, 상가건물, 상가주택
TRADE_CODES: Dict[str, str] = {"A1": "매매", "B1": "전세", "B2": "월세"}

PYEONG = 3.3058
PAGE_SIZE = 20
API_BASE = "https://fin.land.naver.com/front-api/v1"
SITE_BASE = "https://fin.land.naver.com"

DB_FILE = "auction_db.sqlite"

# 수원/성남/안양 주요 상가 법정동 코드
# 법정동코드 체계: 경기도(41) + 시군구(3자리) + 읍면동(3자리) + 리(2자리)
GYEONGGI_REGIONS: Dict[str, str] = {
    # 수원시 팔달구 — 구도심/수원역 상권
    "수원시 팔달구 매산동": "4111556500",
    "수원시 팔달구 인계동": "4111557500",
    "수원시 팔달구 우만동": "4111553000",
    "수원시 팔달구 고등동": "4111551500",
    # 수원시 영통구 — 신도심 상권
    "수원시 영통구 영통동": "4117158500",
    "수원시 영통구 매탄동": "4117155000",
    # 성남시 분당구 — 판교·서현 상권
    "성남시 분당구 서현동": "4113563000",
    "성남시 분당구 야탑동": "4113564000",
    "성남시 분당구 정자동": "4113565000",
    "성남시 분당구 수내동": "4113561500",
    # 성남시 중원구 — 성남 구도심
    "성남시 중원구 성남동": "4113357500",
    "성남시 중원구 금광동": "4113352500",
    # 안양시 동안구 — 평촌 신도시 상권
    "안양시 동안구 평촌동": "4117157500",
    "안양시 동안구 관양동": "4117152500",
    # 안양시 만안구 — 안양역 상권
    "안양시 만안구 안양동": "4117152000",
}


# ─────────────────────────────────────────────────────────────
# 유틸리티
# ─────────────────────────────────────────────────────────────

def to_int(val: Any) -> int:
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def to_float(val: Any) -> float:
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def fmt_price(val_10k: float) -> str:
    if val_10k <= 0:
        return "정보 없음"
    if val_10k >= 10000:
        eok, rem = int(val_10k // 10000), int(val_10k % 10000)
        return f"{eok}억 {rem:,}만원" if rem else f"{eok}억원"
    return f"{int(val_10k):,}만원"


def _g(d: dict, *keys, default=0):
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return default


# ─────────────────────────────────────────────────────────────
# 파서
# ─────────────────────────────────────────────────────────────

def _parse_article(raw: Dict[str, Any], legal_div_no: str, region_name: str) -> Dict[str, Any]:
    trade_cd = str(_g(raw, "tradeTypeCode", "tradeTpCd", "tradeType", default=""))

    price_node = raw.get("price", raw)
    price_sale = to_int(_g(price_node, "dealPrice", "prc", default=0))
    deposit    = to_int(_g(price_node, "warrantPrice", "warrantAmt", "dpstPrc", default=0))
    monthly    = to_int(_g(price_node, "rentPrice", "rentPrc", default=0))

    if trade_cd == "B1" and deposit == 0:
        deposit = price_sale

    area_node   = raw.get("area", raw)
    area_m2     = to_float(_g(area_node, "exclusiveArea", "spc1", "spcBic", default=0))
    area_pyeong = round(area_m2 / PYEONG, 2) if area_m2 > 0 else 0.0

    floor_node  = raw.get("floorInfo", raw)
    floor       = to_int(_g(floor_node, "floor", "flrNo", default=0)) or None
    total_floor = to_int(_g(floor_node, "maxFloor", "totFlrNo", default=0)) or None

    article_id = str(_g(raw, "articleId", "articleNo", "atclNo", default=""))

    # 동 이름: region_name 에서 마지막 단어 추출 (e.g. "수원시 팔달구 인계동" → "인계동")
    addr_parts = region_name.split()
    addr_emd = addr_parts[-1] if addr_parts else ""
    addr_sgg = addr_parts[-2] if len(addr_parts) >= 2 else ""

    return {
        "article_id"       : article_id,
        "legal_div_no"     : legal_div_no,
        "region_name"      : region_name,
        "addr_sgg"         : addr_sgg,
        "addr_emd"         : addr_emd,
        "trade_type"       : TRADE_CODES.get(trade_cd, trade_cd),
        "trade_type_cd"    : trade_cd,
        "area_m2"          : area_m2,
        "area_pyeong"      : area_pyeong,
        "price_sale_10k"   : price_sale,
        "deposit_10k"      : deposit,
        "monthly_rent_10k" : monthly,
        "floor"            : floor,
        "total_floor"      : total_floor,
        "detail_url"       : f"https://fin.land.naver.com/articles/{article_id}" if article_id else "",
        "confirm_date"     : str(_g(raw, "articleConfirmYmd", "atclCfmYmd", default="")),
        "realtor"          : str(_g(raw, "realtorName", "rltrNm", default="")),
    }


def _extract_list(body: dict) -> Tuple[List[dict], bool, Optional[str]]:
    """응답 body → (매물리스트, 다음페이지여부, 커서)"""
    for path in [["result"], ["data"], []]:
        node = body
        for key in path:
            if isinstance(node, dict):
                node = node.get(key, {})
        if isinstance(node, dict):
            raw_list = node.get("list", node.get("articles", []))
            has_next = bool(node.get("hasNextPage", node.get("hasMore", False)))
            cursor   = node.get("cursor") or node.get("nextCursor") or node.get("lastId")
            if raw_list:
                return raw_list, has_next, cursor
    return [], False, None


# ─────────────────────────────────────────────────────────────
# DB
# ─────────────────────────────────────────────────────────────

def _init_naver_table(db_path: str):
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS naver_listings (
                article_id        TEXT PRIMARY KEY,
                legal_div_no      TEXT,
                region_name       TEXT,
                addr_sgg          TEXT,
                addr_emd          TEXT,
                trade_type        TEXT,
                trade_type_cd     TEXT,
                area_m2           REAL,
                area_pyeong       REAL,
                price_sale_10k    INTEGER,
                deposit_10k       INTEGER,
                monthly_rent_10k  INTEGER,
                floor             INTEGER,
                total_floor       INTEGER,
                detail_url        TEXT,
                confirm_date      TEXT,
                realtor           TEXT,
                scraped_at        TEXT
            )
        """)
        conn.commit()


def _upsert_listings(db_path: str, items: List[Dict]):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with sqlite3.connect(db_path) as conn:
        conn.executemany("""
            INSERT INTO naver_listings (
                article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                trade_type, trade_type_cd, area_m2, area_pyeong,
                price_sale_10k, deposit_10k, monthly_rent_10k,
                floor, total_floor, detail_url, confirm_date, realtor, scraped_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(article_id) DO UPDATE SET
                price_sale_10k=excluded.price_sale_10k,
                deposit_10k=excluded.deposit_10k,
                monthly_rent_10k=excluded.monthly_rent_10k,
                scraped_at=excluded.scraped_at
        """, [
            (
                p["article_id"], p["legal_div_no"], p["region_name"],
                p["addr_sgg"], p["addr_emd"],
                p["trade_type"], p["trade_type_cd"],
                p["area_m2"], p["area_pyeong"],
                p["price_sale_10k"], p["deposit_10k"], p["monthly_rent_10k"],
                p["floor"], p["total_floor"],
                p["detail_url"], p["confirm_date"], p["realtor"], now,
            )
            for p in items if p["article_id"]
        ])
        conn.commit()


# ─────────────────────────────────────────────────────────────
# Playwright 크롤러 (직접 API 호출 방식)
# ─────────────────────────────────────────────────────────────

_FETCH_JS = """
async ([url, payload]) => {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        if (!res.ok) return {error: res.status};
        return await res.json();
    } catch (e) {
        return {error: String(e)};
    }
}
"""


async def _fetch_page(
    page,
    legal_div_no: str,
    trade_cd: str,
    cursor: Optional[str] = None,
) -> Tuple[List[dict], bool, Optional[str]]:
    payload: Dict[str, Any] = {
        "legalDivisionNumber": legal_div_no,
        "tradeTypes": [trade_cd],
        "realestateTypes": COMMERCIAL_TYPES,
        "articlePagingRequest": {
            "size": PAGE_SIZE,
            "userChannelType": "PC",
        },
    }
    if cursor:
        payload["articlePagingRequest"]["cursor"] = cursor

    try:
        body = await page.evaluate(_FETCH_JS, [f"{API_BASE}/article/legalDivisionArticleList", payload])
    except Exception:
        return [], False, None

    if not body or isinstance(body, dict) and body.get("error"):
        return [], False, None

    return _extract_list(body)


async def crawl_region(
    page,
    legal_div_no: str,
    region_name: str,
    max_pages: int = 5,
) -> Dict[str, List[Dict]]:
    result: Dict[str, List[Dict]] = {"매매": [], "전세": [], "월세": []}

    for trade_cd, trade_name in [("A1", "매매"), ("B1", "전세"), ("B2", "월세")]:
        collected: List[Dict] = []
        seen_ids: set = set()
        cursor: Optional[str] = None

        for page_no in range(max_pages):
            raw_list, has_next, cursor = await _fetch_page(page, legal_div_no, trade_cd, cursor)
            for item in raw_list:
                p = _parse_article(item, legal_div_no, region_name)
                if p["article_id"] and p["article_id"] not in seen_ids:
                    seen_ids.add(p["article_id"])
                    collected.append(p)

            if not has_next or not cursor:
                break
            await asyncio.sleep(1.5)

        result[trade_name] = collected
        print(f"    {trade_name}: {len(collected)}건")
        await asyncio.sleep(2.0)

    return result


async def crawl_all_regions(
    regions: Dict[str, str] = None,
    max_pages: int = 5,
    headless: bool = True,
    db_path: str = DB_FILE,
) -> Dict[str, Dict[str, List[Dict]]]:
    """여러 법정동 크롤링. regions = {지역명: 법정동코드}"""
    if regions is None:
        regions = GYEONGGI_REGIONS

    _init_naver_table(db_path)

    all_results: Dict[str, Dict[str, List[Dict]]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = await ctx.new_page()
        await page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )

        # 세션/쿠키 초기화
        print("세션 초기화 중...")
        try:
            await page.goto(f"{SITE_BASE}/map", wait_until="load", timeout=30000)
        except Exception:
            pass
        await asyncio.sleep(3)

        for region_name, legal_div_no in regions.items():
            print(f"\n[{region_name}] ({legal_div_no}) 크롤링 중...")
            try:
                region_result = await crawl_region(page, legal_div_no, region_name, max_pages)
                all_results[region_name] = region_result

                # DB 저장
                all_items = [item for items in region_result.values() for item in items]
                if all_items:
                    _upsert_listings(db_path, all_items)
                    print(f"  → DB 저장: {len(all_items)}건")

                # 지역 간 딜레이 (레이트리밋 방지)
                await asyncio.sleep(4.0)

            except Exception as e:
                print(f"  [오류] {region_name}: {e}")

        await browser.close()

    return all_results


# ─────────────────────────────────────────────────────────────
# 수익성 분석
# ─────────────────────────────────────────────────────────────

def calc_market_stats(monthly_data: List[Dict]) -> Tuple[float, float]:
    valid = [d for d in monthly_data if d["area_pyeong"] > 0 and d["monthly_rent_10k"] > 0]
    if not valid:
        return 0.0, 0.0
    avg_rpp = sum(d["monthly_rent_10k"] / d["area_pyeong"] for d in valid) / len(valid)
    avg_dep = sum(d["deposit_10k"] for d in valid) / len(valid)
    return round(avg_rpp, 2), round(avg_dep, 0)


def _find_matching_rent(sale: Dict, monthly_data: List[Dict]) -> Optional[Dict]:
    candidates = []
    for rent in monthly_data:
        if not rent["monthly_rent_10k"]:
            continue
        if sale["area_pyeong"] > 0 and rent["area_pyeong"] > 0:
            if abs(sale["area_pyeong"] - rent["area_pyeong"]) / sale["area_pyeong"] > 0.30:
                continue
        if sale["floor"] and rent["floor"]:
            if abs(sale["floor"] - rent["floor"]) > 2:
                continue
        candidates.append(rent)
    if not candidates:
        return None
    return min(candidates, key=lambda r: abs((r["area_pyeong"] or 0) - (sale["area_pyeong"] or 0)))


def analyze_profitability(region_result: Dict[str, List[Dict]]) -> List[Dict]:
    monthly_data = region_result.get("월세", [])
    sale_data    = region_result.get("매매", [])
    avg_rpp, avg_dep = calc_market_stats(monthly_data)

    results = []
    for sale in sale_data:
        sp = sale["price_sale_10k"]
        if sp <= 0:
            continue
        matched = _find_matching_rent(sale, monthly_data)
        if matched:
            est_rent  = matched["monthly_rent_10k"]
            used_dep  = matched["deposit_10k"] or avg_dep
            match_type = "직접매칭"
        else:
            est_rent  = avg_rpp * sale["area_pyeong"] if avg_rpp and sale["area_pyeong"] else 0.0
            used_dep  = avg_dep
            match_type = "평균시세추정"

        denom = sp - used_dep
        yld = round((est_rent * 12 / denom) * 100, 2) if denom > 0 and est_rent > 0 else 0.0
        results.append({
            **sale,
            "estimated_monthly_rent_10k": round(est_rent, 1),
            "yield_pct": yld,
            "rent_match_type": match_type,
        })

    results.sort(key=lambda x: x["yield_pct"], reverse=True)
    return results


def print_insight(region_name: str, region_result: Dict[str, List[Dict]], yield_list: List[Dict]):
    monthly = region_result.get("월세", [])
    avg_rpp, avg_dep = calc_market_stats(monthly)
    sep = "─" * 60

    print(f"\n{'═'*60}")
    print(f"  {region_name}")
    print(f"{'═'*60}")
    print(f"  수집: 매매 {len(region_result.get('매매',[]))}건  "
          f"전세 {len(region_result.get('전세',[]))}건  "
          f"월세 {len(region_result.get('월세',[]))}건")
    if avg_rpp:
        print(f"  평당 평균 월세: {avg_rpp:.1f}만원/평  |  평균 보증금: {fmt_price(avg_dep)}")

    top = [r for r in yield_list if r["yield_pct"] > 0][:3]
    if top:
        print(f"\n  ■ 수익률 Top {len(top)}")
        for i, r in enumerate(top, 1):
            label = r.get("name") or r.get("building_name") or "(무제)"
            fl = f"{r['floor']}층" if r.get("floor") else "층수미상"
            print(f"  [{i}] {label}  {fl}  {r['area_pyeong']:.1f}평")
            print(f"      매매 {fmt_price(r['price_sale_10k'])}  "
                  f"예상월세 {fmt_price(r['estimated_monthly_rent_10k'])}  "
                  f"수익률 {r['yield_pct']:.2f}%")
            print(f"      {r['detail_url']}")
    print(sep)


# ─────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────

async def run_async(
    regions: Dict[str, str] = None,
    max_pages: int = 5,
    headless: bool = True,
    db_path: str = DB_FILE,
):
    if regions is None:
        regions = GYEONGGI_REGIONS

    print(f"대상 지역: {len(regions)}개 법정동")
    all_results = await crawl_all_regions(regions, max_pages, headless, db_path)

    for region_name, region_result in all_results.items():
        yield_list = analyze_profitability(region_result)
        print_insight(region_name, region_result, yield_list)

    total = sum(
        len(items)
        for r in all_results.values()
        for items in r.values()
    )
    print(f"\n총 수집: {total}건 → {db_path} (naver_listings 테이블)")


def run(**kwargs):
    asyncio.run(run_async(**kwargs))


if __name__ == "__main__":
    # 테스트: 수원 인계동 1개 지역, 헤드리스 해제해서 확인
    # run(regions={"수원시 팔달구 인계동": "4111557500"}, max_pages=2, headless=False)

    # 전체 경기 실행
    run(max_pages=5, headless=True)
