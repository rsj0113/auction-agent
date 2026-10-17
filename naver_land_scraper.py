#!/usr/bin/env python3
"""
네이버 부동산 상가 매물 크롤링 + SQLite 저장 + 수익성 분석

크롤링 전략:
  1. fin.land.naver.com 에서 세션/쿠키 획득 (Stealth 모드)
  2. searchByCoordinate API로 동 단위 legalDivisionNumber 획득
  3. article/boundedArticles API로 상가 매물 목록 수집 (page.evaluate fetch)
  4. lastInfo 기반 커서 페이지네이션

API (역공학):
  BASE: https://fin.land.naver.com/front-api/v1
  코드조회: GET  /legalDivision/searchByCoordinate?longitude=&latitude=&type=EUP
  매물목록: POST /article/boundedArticles
    body: {
      filter: { tradeTypes, realEstateTypes, legalDivisionNumbers, legalDivisionType, ... },
      boundingBox: { left, right, top, bottom },
      precision: 15,
      userChannelType: "PC",
      articlePagingRequest: { size, articleSortType, lastInfo }
    }
  상가 realEstateTypes: D03=상가/빌딩, D04=상가건물, E01=사무실, Z00=건물

가격 단위: 원(₩) — DB 저장은 만원으로 변환 (/ 10000)
"""

import asyncio
import json
import re
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# ─────────────────────────────────────────────────────────────
# 상수
# ─────────────────────────────────────────────────────────────

# 상가 전용 realEstateType 코드 (D02=일반상가/점포, D04=상가건물, D03=상업시설/빌딩)
COMMERCIAL_TYPES = ["D02", "D04", "D03"]

TRADE_CODES: Dict[str, str] = {"A1": "매매", "B1": "전세", "B2": "월세"}

PYEONG = 3.3058
API_BASE = "https://fin.land.naver.com/front-api/v1"
SITE_BASE = "https://fin.land.naver.com"

DB_FILE = "auction_db.sqlite"

# 성남/분당/판교/위례 + 서울/수원/안양 주요 상권 — (approx_lng, approx_lat)
# 런타임에 searchByCoordinate API로 정확한 legalDivisionNumber 조회
GYEONGGI_REGIONS: Dict[str, Tuple[float, float]] = {
    # 성남시 분당구 핵심 상권
    "성남시 분당구 서현동"   : (127.122, 37.383),
    "성남시 분당구 야탑동"   : (127.127, 37.410),
    "성남시 분당구 정자동"   : (127.113, 37.360),
    "성남시 분당구 수내동"   : (127.115, 37.378),
    "성남시 분당구 삼평동"   : (127.111, 37.401),
    "성남시 분당구 백현동"   : (127.111, 37.388),
    "성남시 분당구 구미동"   : (127.111, 37.340),
    "성남시 분당구 금곡동"   : (127.108, 37.350),
    "성남시 분당구 이매동"   : (127.128, 37.397),
    # 성남시 중원구·수정구 핵심 상권
    "성남시 중원구 성남동"   : (127.130, 37.432),
    "성남시 중원구 상대원동" : (127.169, 37.436),
    "성남시 수정구 신흥동"   : (127.145, 37.442),
    "성남시 수정구 태평동"   : (127.132, 37.445),
    "성남시 수정구 창곡동"   : (127.142, 37.468),
    "성남시 수정구 수진동"   : (127.134, 37.438),
    # 서울 핵심 상권
    "서울 강남구 역삼동"     : (127.036, 37.500),
    "서울 강남구 논현동"     : (127.028, 37.511),
    "서울 서초구 서초동"     : (127.015, 37.492),
    "서울 송파구 문정동"     : (127.122, 37.485),
    "서울 송파구 방이동"     : (127.115, 37.512),
    "서울 마포구 서교동"     : (126.921, 37.555),
    # 경기 남부 주요 상권
    "수원시 팔달구 인계동"   : (127.020, 37.264),
    "수원시 영통구 영통동"   : (127.059, 37.252),
    "안양시 동안구 평촌동"   : (126.952, 37.390),
    "안양시 동안구 관양동"   : (126.961, 37.400),
}

# 기본 필터 (빈 값 필드 포함 필요)
_BASE_FILTER_EXTRA = {
    "roomCount": [], "bathRoomCount": [], "optionTypes": [],
    "oneRoomShapeTypes": [], "moveInTypes": [],
    "filtersExclusiveSpace": False, "floorTypes": [],
    "directionTypes": [], "hasArticlePhoto": False,
    "isAuthorizedByOwner": False, "parkingTypes": [],
    "entranceTypes": [], "hasArticle": False,
}

# ─────────────────────────────────────────────────────────────
# JS fetch 헬퍼 (page.evaluate 사용 — 브라우저 same-origin 컨텍스트)
# ─────────────────────────────────────────────────────────────

_FETCH_JS = """
async ([url, bodyObj]) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'include',
        body: JSON.stringify(bodyObj),
    });
    if (!res.ok) return {error: res.status};
    return await res.json();
}
"""

_GET_JS = """
async ([url]) => {
    const res = await fetch(url, {credentials: 'include'});
    if (!res.ok) return {error: res.status};
    return await res.json();
}
"""

# ─────────────────────────────────────────────────────────────
# 유틸리티
# ─────────────────────────────────────────────────────────────

def won_to_10k(val) -> int:
    """원 → 만원 변환 (DB 저장 단위)"""
    try:
        return int(val) // 10000
    except (TypeError, ValueError):
        return 0


def fmt_price(val_10k: float) -> str:
    if val_10k <= 0:
        return "정보없음"
    if val_10k >= 10000:
        eok, rem = int(val_10k // 10000), int(val_10k % 10000)
        return f"{eok}억 {rem:,}만원" if rem else f"{eok}억원"
    return f"{int(val_10k):,}만원"


# ─────────────────────────────────────────────────────────────
# 지역 코드 조회
# ─────────────────────────────────────────────────────────────

async def lookup_region_code(page, lng: float, lat: float) -> Optional[str]:
    """좌표 → Naver 내부 legalDivisionNumber (EUP 단위)"""
    url = f"{API_BASE}/legalDivision/searchByCoordinate?longitude={lng}&latitude={lat}&type=EUP"
    result = await page.evaluate(_GET_JS, [url])
    if isinstance(result, dict) and not result.get("error"):
        r = result.get("result", result)
        return r.get("legalDivisionNumber") or r.get("sectorLegalDivisionNumber")
    return None


# ─────────────────────────────────────────────────────────────
# 파서
# ─────────────────────────────────────────────────────────────

def _parse_floor_part(part: str) -> Optional[int]:
    part = part.strip().upper()
    if not part or part == "-":
        return None
    if part.startswith("B") or part.startswith("지"):
        num_str = re.sub(r"[^0-9]", "", part)
        return -int(num_str) if num_str else None
    try:
        return int(part)
    except ValueError:
        return None


def _parse_article(raw: Dict[str, Any], region_name: str, legal_div_no: str) -> Optional[Dict[str, Any]]:
    info = raw.get("representativeArticleInfo")
    if not info:
        return None

    trade_cd  = str(info.get("tradeType") or "")
    realty_cd = str(info.get("realEstateType") or "")
    article_id = str(info.get("articleNumber") or "")

    price_node = info.get("priceInfo", {})
    price_sale = won_to_10k(price_node.get("dealPrice") or 0)
    deposit    = won_to_10k(price_node.get("warrantyPrice") or 0)
    monthly    = won_to_10k(price_node.get("rentPrice") or 0)

    space = info.get("spaceInfo", {})
    # 일반상가(D02)는 exclusiveSpace(전용면적) 우선, 통건물은 floorSpace(연면적) 우선
    area_m2 = float(space.get("exclusiveSpace") or space.get("floorSpace") or space.get("supplySpace") or space.get("landSpace") or 0)
    area_pyeong = round(area_m2 / PYEONG, 2) if area_m2 > 0 else 0.0

    detail = info.get("articleDetail", {})
    floor_raw = detail.get("floorInfo") or ""          # e.g. "1/5", "2/6", "B1/5", "-2/6"
    floor_parts = floor_raw.replace(" ", "").split("/")
    floor       = None
    total_floor = None
    if len(floor_parts) == 2:
        floor       = _parse_floor_part(floor_parts[0])
        total_floor = _parse_floor_part(floor_parts[1])

    addr = info.get("address", {})
    addr_sgg = addr.get("division") or ""
    addr_emd = addr.get("sector") or ""
    coords   = addr.get("coordinates", {})

    base_name = str(info.get("articleName") or "상가")
    desc = str(detail.get("articleFeatureDescription") or "").strip()
    full_name = f"{base_name} · {desc}" if desc else base_name

    return {
        "article_id"       : article_id,
        "legal_div_no"     : legal_div_no,
        "region_name"      : region_name,
        "addr_sgg"         : addr_sgg,
        "addr_emd"         : addr_emd,
        "trade_type"       : TRADE_CODES.get(trade_cd, trade_cd),
        "trade_type_cd"    : trade_cd,
        "realty_type_cd"   : realty_cd,
        "area_m2"          : area_m2,
        "area_pyeong"      : area_pyeong,
        "price_sale_10k"   : price_sale,
        "deposit_10k"      : deposit,
        "monthly_rent_10k" : monthly,
        "floor"            : floor,
        "total_floor"      : total_floor,
        "detail_url"       : f"https://fin.land.naver.com/articles/{article_id}" if article_id else "",
        "confirm_date"     : str(info.get("verificationInfo", {}).get("articleConfirmDate") or ""),
        "realtor"          : str(info.get("brokerInfo", {}).get("brokerageName") or ""),
        "lat"              : coords.get("yCoordinate"),
        "lng"              : coords.get("xCoordinate"),
        "article_name"     : full_name[:80],
    }


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
                realty_type_cd    TEXT,
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
                lat               REAL,
                lng               REAL,
                article_name      TEXT,
                scraped_at        TEXT
            )
        """)
        for col in ["realty_type_cd TEXT", "lat REAL", "lng REAL", "article_name TEXT"]:
            try:
                conn.execute(f"ALTER TABLE naver_listings ADD COLUMN {col}")
            except Exception:
                pass
        conn.commit()


def _upsert_listings(db_path: str, items: List[Dict]):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with sqlite3.connect(db_path) as conn:
        conn.executemany("""
            INSERT INTO naver_listings (
                article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                trade_type, trade_type_cd, realty_type_cd, area_m2, area_pyeong,
                price_sale_10k, deposit_10k, monthly_rent_10k,
                floor, total_floor, detail_url, confirm_date, realtor,
                lat, lng, article_name, scraped_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(article_id) DO UPDATE SET
                realty_type_cd=excluded.realty_type_cd,
                area_m2=excluded.area_m2,
                area_pyeong=excluded.area_pyeong,
                price_sale_10k=excluded.price_sale_10k,
                deposit_10k=excluded.deposit_10k,
                monthly_rent_10k=excluded.monthly_rent_10k,
                floor=excluded.floor,
                total_floor=excluded.total_floor,
                lat=excluded.lat,
                lng=excluded.lng,
                article_name=excluded.article_name,
                scraped_at=excluded.scraped_at
        """, [
            (
                p["article_id"], p["legal_div_no"], p["region_name"],
                p["addr_sgg"], p["addr_emd"],
                p["trade_type"], p["trade_type_cd"], p["realty_type_cd"],
                p["area_m2"], p["area_pyeong"],
                p["price_sale_10k"], p["deposit_10k"], p["monthly_rent_10k"],
                p["floor"], p["total_floor"],
                p["detail_url"], p["confirm_date"], p["realtor"],
                p.get("lat"), p.get("lng"), p.get("article_name"), now,
            )
            for p in items if p and p.get("article_id")
        ])
        conn.commit()


# ─────────────────────────────────────────────────────────────
# 크롤러
# ─────────────────────────────────────────────────────────────

async def fetch_region_articles(
    page,
    legal_div_no: str,
    lng: float,
    lat: float,
    region_name: str,
    trade_types: List[str],
    max_pages: int = 5,
    realty_types: List[str] = None,
) -> List[Dict]:
    """
    article/boundedArticles 로 한 지역·거래유형 매물 수집.
    lastInfo 커서 기반 페이지네이션.
    """
    if realty_types is None:
        realty_types = COMMERCIAL_TYPES
    margin = 0.025
    bbox   = {"left": lng-margin, "right": lng+margin,
              "top": lat+margin,  "bottom": lat-margin}

    collected: List[Dict] = []
    seen_ids:  set = set()
    last_info: list = []

    for _ in range(max_pages):
        payload = {
            "filter": {
                "tradeTypes": trade_types,
                "realEstateTypes": realty_types,
                "legalDivisionNumbers": [legal_div_no],
                "legalDivisionType": "EUP",
                **_BASE_FILTER_EXTRA,
            },
            "boundingBox": bbox,
            "precision": 15,
            "userChannelType": "PC",
            "articlePagingRequest": {
                "size": 30,
                "articleSortType": "RANKING_DESC",
                "lastInfo": last_info,
            },
        }

        result = await page.evaluate(_FETCH_JS, [f"{API_BASE}/article/boundedArticles", payload])

        if not isinstance(result, dict) or result.get("error"):
            break

        r = result.get("result", result)
        raw_list = r.get("list", [])

        for raw in raw_list:
            p = _parse_article(raw, region_name, legal_div_no)
            if p and p["article_id"] and p["article_id"] not in seen_ids:
                seen_ids.add(p["article_id"])
                collected.append(p)

        if not r.get("hasNextPage"):
            break
        last_info = r.get("lastInfo") or []
        if not last_info:
            break
        await asyncio.sleep(0.5)

    return collected


async def crawl_all_regions(
    regions: Dict[str, Tuple[float, float]] = None,
    trade_types: List[str] = None,
    max_pages: int = 3,
    headless: bool = True,
    db_path: str = DB_FILE,
) -> Dict[str, List[Dict]]:
    if regions is None:
        regions = GYEONGGI_REGIONS
    if trade_types is None:
        trade_types = ["A1", "B2"]

    _init_naver_table(db_path)
    all_results: Dict[str, List[Dict]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = await ctx.new_page()
        await Stealth().apply_stealth_async(page)

        print("세션 초기화 중...")
        try:
            await page.goto(f"{SITE_BASE}/map", wait_until="networkidle", timeout=25000)
        except Exception:
            pass
        await asyncio.sleep(2.5)

        for region_name, (lng, lat) in regions.items():
            print(f"\n[{region_name}] 코드 조회 중...")
            try:
                legal_div_no = await lookup_region_code(page, lng, lat)
                if not legal_div_no:
                    print(f"  코드 조회 실패 — 건너뜀")
                    continue
                print(f"  코드: {legal_div_no}")

                region_items: List[Dict] = []
                for trade_cd in trade_types:
                    trade_name = TRADE_CODES.get(trade_cd, trade_cd)
                    # 일반상가(D02) 우선 수집 + 상가건물(D04)
                    items_shop = await fetch_region_articles(
                        page, legal_div_no, lng, lat, region_name,
                        [trade_cd], max_pages, realty_types=["D02"]
                    )
                    print(f"  {trade_name} 일반상가(D02): {len(items_shop)}건")
                    region_items.extend(items_shop)
                    await asyncio.sleep(0.5)

                all_results[region_name] = region_items

                if region_items:
                    _upsert_listings(db_path, region_items)
                    print(f"  → DB 저장: {len(region_items)}건")

                await asyncio.sleep(0.8)

            except Exception as e:
                print(f"  [오류] {region_name}: {e}")

        await browser.close()

    return all_results


# ─────────────────────────────────────────────────────────────
# 수익성 분석
# ─────────────────────────────────────────────────────────────

def calc_market_stats(items: List[Dict], trade_cd: str) -> Tuple[float, float]:
    """월세 매물에서 평당 평균 월세 + 평균 보증금 계산"""
    valid = [
        d for d in items
        if d["trade_type_cd"] == trade_cd
        and d["area_pyeong"] > 0
        and d["monthly_rent_10k"] > 0
    ]
    if not valid:
        return 0.0, 0.0
    avg_rpp = sum(d["monthly_rent_10k"] / d["area_pyeong"] for d in valid) / len(valid)
    avg_dep = sum(d["deposit_10k"] for d in valid) / len(valid)
    return round(avg_rpp, 2), round(avg_dep, 0)


def print_insight(region_name: str, items: List[Dict]):
    by_trade: Dict[str, List] = {}
    for item in items:
        by_trade.setdefault(item["trade_type"], []).append(item)

    avg_rpp, avg_dep = calc_market_stats(items, "B2")

    print(f"\n{'═'*60}")
    print(f"  {region_name}")
    print(f"{'═'*60}")
    for name, lst in by_trade.items():
        print(f"  {name}: {len(lst)}건")
    if avg_rpp:
        print(f"  평당 평균 월세: {avg_rpp:.1f}만원/평  평균 보증금: {fmt_price(avg_dep)}")

    sales = sorted(
        [i for i in by_trade.get("매매", []) if i["price_sale_10k"] > 0 and i["area_pyeong"] > 0],
        key=lambda x: x["price_sale_10k"] / x["area_pyeong"]
    )
    if sales:
        cheapest = sales[:3]
        print(f"\n  ■ 매매 평당 저가 Top 3")
        for p in cheapest:
            ppp = round(p["price_sale_10k"] / p["area_pyeong"], 0)
            print(f"    {p['article_name'] or '(무제)'} {p['area_pyeong']:.1f}평 "
                  f"{fmt_price(p['price_sale_10k'])} (평당 {ppp:.0f}만원)")
            print(f"      {p['detail_url']}")


# ─────────────────────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────────────────────

async def run_async(
    regions: Dict[str, Tuple[float, float]] = None,
    max_pages: int = 5,
    headless: bool = True,
    db_path: str = DB_FILE,
):
    if regions is None:
        regions = GYEONGGI_REGIONS
    print(f"대상: {len(regions)}개 지역")
    all_results = await crawl_all_regions(regions, max_pages=max_pages, headless=headless, db_path=db_path)

    total = sum(len(v) for v in all_results.values())
    for region_name, items in all_results.items():
        print_insight(region_name, items)
    print(f"\n총 {total}건 → {db_path} (naver_listings 테이블)")


def run(**kwargs):
    asyncio.run(run_async(**kwargs))


if __name__ == "__main__":
    # 테스트: 수원 인계동 1개, 빠르게
    # run(regions={"수원시 팔달구 인계동": (127.020, 37.264)}, max_pages=2, headless=True)

    # 전체 실행
    run(max_pages=5, headless=True)
