#!/usr/bin/env python3
"""
core/naver_rent_enricher.py

경매·온비드 활성 매물이 밀집한 수도권 주요 법정동(최대 N개)을 자동 선정하여
네이버 부동산(fin.land.naver.com)에서 아파트(A01)·오피스텔(A02)·빌라/다세대(C02/C03)·상가(D02)
실제 월세(B2) 및 전세(B1) 시세 매물을 수집해 `naver_listings` 테이블에 보강한다.
"""

import argparse
import asyncio
import os
import sqlite3
import sys
from typing import Dict, List, Tuple

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from core.geocoder import geocode_address
from naver_land_scraper import (
    SITE_BASE,
    _init_naver_table,
    _upsert_listings,
    fetch_region_articles,
    lookup_region_code,
)

DB_PATH = os.path.join(ROOT_DIR, "auction_db.sqlite")

# 용도별 네이버 부동산 realEstateTypes 매핑
TYPE_GROUPS: List[Tuple[str, List[str], List[str]]] = [
    ("아파트", ["A01"], ["B2", "B1"]),
    ("오피스텔", ["A02"], ["B2", "B1"]),
    ("빌라/다세대", ["C02", "C03"], ["B2", "B1"]),
    ("상가", ["D02"], ["B2"]),
]


def pick_target_districts(db_path: str, max_districts: int = 35) -> List[Tuple[str, float, float, int]]:
    """
    활성 법원경매 + 온비드 공매 매각 물건이 가장 많이 몰려 있고
    아직 주거/오피스텔 월세 표본이 부족한 수도권 핵심 법정동을 우선 선정한다.
    반환: [(region_label, lng, lat, item_count), ...]
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 이미 주거용(A01/A02/C02/C03) 월세 표본이 충분한 동 확인
    existing_res_emd: Dict[str, int] = {}
    try:
        for emd, cnt in cur.execute("""
            SELECT addr_emd, COUNT(*)
            FROM naver_listings
            WHERE realty_type_cd IN ('A01', 'A02', 'C02', 'C03')
              AND trade_type IN ('월세', '전세')
            GROUP BY addr_emd
        """).fetchall():
            if emd:
                existing_res_emd[emd.strip()] = int(cnt)
    except Exception:
        pass

    counts: Dict[Tuple[str, str], int] = {}
    coords_acc: Dict[Tuple[str, str], List[Tuple[float, float]]] = {}

    # 1) 법원경매 활성 매물 (토지 제외)
    for sgg, emd, loc, lat, lng in cur.execute("""
        SELECT addr_sgg, addr_emd, location, lat, lng
        FROM auction_items
        WHERE COALESCE(status_flag, '') != 'CLOSED'
          AND appraisal > 0 AND min_bid >= 1000000
          AND usage NOT LIKE '%토지%'
    """).fetchall():
        sgg_c = (sgg or "").strip()
        emd_c = (emd or "").strip()
        if not sgg_c or not emd_c:
            continue
        key = (sgg_c, emd_c)
        counts[key] = counts.get(key, 0) + 1
        if lat and lng and lat != round(lat) and lng != round(lng):
            coords_acc.setdefault(key, []).append((float(lng), float(lat)))
        else:
            glat, glng = geocode_address(loc or f"{sgg_c} {emd_c}")
            if glat and glng:
                coords_acc.setdefault(key, []).append((float(glng), float(glat)))

    # 2) 온비드 공매 매각 활성 매물 (수도권, 토지 제외)
    for sido, sgg, emd, addr_full, lat, lng in cur.execute("""
        SELECT addr_sido, addr_sgg, addr_emd, addr_full, lat, lng
        FROM onbid_items
        WHERE disposal_method = '매각'
          AND COALESCE(bid_status, '') != '마감'
          AND bid_end_date >= date('now', 'localtime')
          AND min_bid >= 1000000
          AND (addr_sido LIKE '%서울%' OR addr_sido LIKE '%경기%' OR addr_sido LIKE '%인천%')
          AND usage NOT LIKE '%토지%'
    """).fetchall():
        sgg_c = (sgg or "").strip()
        emd_c = (emd or "").strip()
        if not sgg_c or not emd_c:
            continue
        key = (sgg_c, emd_c)
        counts[key] = counts.get(key, 0) + 1
        if lat and lng:
            coords_acc.setdefault(key, []).append((float(lng), float(lat)))
        else:
            glat, glng = geocode_address(addr_full or f"{sido} {sgg_c} {emd_c}")
            if glat and glng:
                coords_acc.setdefault(key, []).append((float(glng), float(glat)))

    conn.close()

    # 주거 표본이 부족한(<15건) 동을 우선으로, 매물 수 내림차순 정렬
    ranked: List[Tuple[int, int, str, float, float]] = []
    for (sgg_c, emd_c), cnt in counts.items():
        pts = coords_acc.get((sgg_c, emd_c))
        if not pts:
            glat, glng = geocode_address(f"{sgg_c} {emd_c}")
            if not glat or not glng:
                continue
            avg_lng, avg_lat = float(glng), float(glat)
        else:
            avg_lng = sum(p[0] for p in pts) / len(pts)
            avg_lat = sum(p[1] for p in pts) / len(pts)

        needs_fill = 0 if existing_res_emd.get(emd_c, 0) < 15 else 1
        ranked.append((needs_fill, -cnt, f"{sgg_c} {emd_c}", avg_lng, avg_lat))

    ranked.sort(key=lambda x: (x[0], x[1]))
    return [(r[2], r[3], r[4], -r[1]) for r in ranked[:max_districts]]


async def enrich_rentals(max_districts: int = 35, max_pages: int = 2, db_path: str = DB_PATH):
    _init_naver_table(db_path)
    targets = pick_target_districts(db_path, max_districts=max_districts)
    print(f"🎯 전월세 시세 보강 대상: 수도권 핵심 {len(targets)}개 법정동 (유형별 max_pages={max_pages})")

    if not targets:
        print("보강 대상 지역이 없습니다.")
        return

    total_saved = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
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

        print("🌐 네이버 부동산 세션 초기화 중...")
        try:
            await page.goto(f"{SITE_BASE}/map", wait_until="domcontentloaded", timeout=25000)
        except Exception:
            pass
        await asyncio.sleep(2.5)

        seen_codes = set()
        for idx, (region_name, lng, lat, cnt) in enumerate(targets, 1):
            try:
                legal_div_no = await lookup_region_code(page, lng, lat)
                if not legal_div_no:
                    print(f"  [{idx}/{len(targets)}] {region_name} (매물 {cnt}건) — 코드 조회 실패, 스킵")
                    continue
                if legal_div_no in seen_codes:
                    continue
                seen_codes.add(legal_div_no)

                batch: List[Dict] = []
                summary_parts = []
                for label, rtypes, ttypes in TYPE_GROUPS:
                    fetched = await fetch_region_articles(
                        page=page,
                        legal_div_no=legal_div_no,
                        lng=lng,
                        lat=lat,
                        region_name=region_name,
                        trade_types=ttypes,
                        max_pages=max_pages,
                        realty_types=rtypes,
                    )
                    if fetched:
                        batch.extend(fetched)
                        summary_parts.append(f"{label} {len(fetched)}")
                    await asyncio.sleep(0.35)

                if batch:
                    _upsert_listings(db_path, batch)
                    total_saved += len(batch)
                    print(f"  [{idx}/{len(targets)}] ✅ {region_name} (경공매 {cnt}건) → +{len(batch)}건 ({', '.join(summary_parts)})")
                else:
                    print(f"  [{idx}/{len(targets)}] ➖ {region_name} (경공매 {cnt}건) → 수집 0건")

                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"  [{idx}/{len(targets)}] ⚠️ {region_name} 오류: {e}")

        await browser.close()

    print(f"\n🏁 전월세 시세 보강 완료: 총 {total_saved}건 저장 ({db_path})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--districts", type=int, default=35, help="수집할 상위 법정동 개수")
    parser.add_argument("--pages", type=int, default=2, help="유형별 최대 페이지 수")
    args = parser.parse_args()
    asyncio.run(enrich_rentals(max_districts=args.districts, max_pages=args.pages))
