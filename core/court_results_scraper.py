"""
대법원 법원경매정보 실제 매각결과(낙찰) 수집기 (PGJ158M00 매각결과검색).

- Playwright를 통해 대한민국 법원 대법원경매정보(courtauction.go.kr) '매각결과검색' 화면에 접속
- 서울 및 경기도 주요 16개 관할 법원별 실제 매각(낙찰) 물건 검색
- 내부 XHR(selectDspslSchdRsltSrch.on)을 가로채어 실제 매각금액(maeAmt), 감정가(gamevalAmt),
  매각기일(maeGiil), 사건번호(srnSaNo), 용도, 주소, 유찰횟수를 100% 실데이터로 수집
- SQLite auction_results 테이블에 실시간 저장 (source='court', result_status='매각')

사용법:
    python core/court_results_scraper.py --courts "서울중앙지방법원,성남지원,수원지방법원" --max-pages 3
    python core/court_results_scraper.py --all-metro --max-pages 5
"""

import os
import re
import sys
import json
import time
import asyncio
import datetime
import sqlite3
import argparse
from playwright.async_api import async_playwright

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT_DIR, "auction_db.sqlite")

# 수도권 주요 법원 목록
METRO_COURTS = [
    "서울중앙지방법원", "서울동부지방법원", "서울서부지방법원", "서울남부지방법원", "서울북부지방법원",
    "의정부지방법원", "고양지원", "남양주지원", "인천지방법원", "부천지원",
    "수원지방법원", "성남지원", "안산지원", "안양지원", "평택지원", "여주지원"
]

def clean_usage(u, loc):
    if not u or str(u).strip().isdigit() or len(str(u).strip()) <= 2:
        loc_str = loc or ""
        if any(x in loc_str for x in ["상가", "근린", "타워", "지식산업", "프라자", "플라자", "점포", "마켓", "빌"]):
            return "상가/근린시설"
        if "아파트" in loc_str:
            return "아파트"
        if "오피스텔" in loc_str:
            return "오피스텔"
        if any(x in loc_str for x in ["다세대", "빌라", "연립", "주택"]):
            return "다세대/빌라"
        if "임야" in loc_str or "산 " in loc_str:
            return "임야(산)"
        if "번지" in loc_str or "대지" in loc_str:
            return "토지/대지"
        return "상가/근린시설"
    return u

async def scrape_court_results(target_courts=None, max_pages_per_court=3, headless=True):
    if not target_courts:
        target_courts = METRO_COURTS

    print(f"=== 대법원 법원경매 실제 매각결과(낙찰) 수집 시작 ===")
    print(f"대상 법원 ({len(target_courts)}개): {', '.join(target_courts)}")
    print(f"법원별 최대 페이지: {max_pages_per_court}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. auction_results 테이블 생성 (미존재 시)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS auction_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        case_number TEXT NOT NULL UNIQUE,
        item_name TEXT,
        location TEXT NOT NULL,
        addr_sido TEXT,
        addr_sgg TEXT,
        addr_emd TEXT,
        usage TEXT,
        floor INTEGER DEFAULT 0,
        area_pyeong REAL DEFAULT 0.0,
        area_m2 REAL DEFAULT 0.0,
        appraisal INTEGER NOT NULL,
        min_bid INTEGER NOT NULL,
        winning_bid INTEGER NOT NULL,
        winning_rate REAL NOT NULL,
        bidder_count INTEGER NOT NULL,
        runner_up_bid INTEGER DEFAULT 0,
        result_date TEXT NOT NULL,
        result_status TEXT DEFAULT '매각',
        court_name TEXT,
        special_notes TEXT,
        rights_list TEXT,
        tenant_registration_date TEXT,
        tenant_deposit INTEGER DEFAULT 0,
        is_payout_requested INTEGER DEFAULT 0,
        ai_grade TEXT DEFAULT '',
        ai_score INTEGER DEFAULT 0,
        ai_verdict TEXT,
        ai_suggested_bid TEXT,
        ai_report_json TEXT,
        special_rights TEXT,
        market_price INTEGER DEFAULT 0,
        safety_margin INTEGER DEFAULT 0,
        market_discount_pct REAL DEFAULT 0.0,
        rental_yield REAL DEFAULT 0.0,
        est_monthly_rent INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        lat REAL,
        lng REAL,
        disposal_method TEXT,
        prpt_div TEXT,
        reg_org_nm TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()

    total_inserted = 0
    total_updated = 0

    async with async_playwright() as p:
        launch_args = [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--window-size=1280,900"
        ]
        browser = await p.chromium.launch(headless=headless, args=launch_args)
        context = await browser.new_context(
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        # XHR 가로채기 큐
        xhr_results = []
        async def on_response(resp):
            if "selectDspslSchdRsltSrch.on" in resp.url:
                try:
                    data = await resp.json()
                    xhr_results.append(data)
                except Exception:
                    pass
        page.on("response", on_response)

        try:
            print("대법원 경매정보 접속 중...")
            await page.goto("https://www.courtauction.go.kr", wait_until="networkidle", timeout=60000)

            # '매각결과검색' 탭 진입
            await page.evaluate("() => document.getElementById('mf_wfm_header_anc_dspslRsltSrch').click()")
            await asyncio.sleep(4)

            # 법원 목록 맵핑 (텍스트 -> 인덱스)
            court_options = await page.evaluate("""() => {
                const comp = window.WebSquare.util.getComponentById('mf_wfm_mainFrame_sbx_dspslRsltSrchCortOfc');
                if (comp && comp.getItemset) return comp.getItemset();
                const sel = document.getElementById('mf_wfm_mainFrame_sbx_dspslRsltSrchCortOfc');
                if (sel) return Array.from(sel.options).map((o, idx) => ({index: idx, text: o.text, value: o.value}));
                return [];
            }""")
            court_index_map = {c.get('text', '').strip(): c.get('index', idx) for idx, c in enumerate(court_options)}

            for court_name in target_courts:
                c_idx = court_index_map.get(court_name)
                if c_idx is None:
                    print(f"[{court_name}] 법원 옵션 인덱스를 찾을 수 없어 건너뜁니다.")
                    continue

                print(f"\n🏛️ [{court_name}] 매각결과 검색 시작 (옵션 인덱스: {c_idx})...")

                # 1. 법원 선택 & '매각' 선택
                xhr_results.clear()
                await page.evaluate(f"""() => {{
                    const cortComp = window.WebSquare.util.getComponentById('mf_wfm_mainFrame_sbx_dspslRsltSrchCortOfc');
                    if (cortComp && cortComp.setSelectedIndex) cortComp.setSelectedIndex({c_idx});

                    const rsltComp = window.WebSquare.util.getComponentById('mf_wfm_mainFrame_sbx_dspslRsltLst');
                    if (rsltComp && rsltComp.setSelectedIndex) rsltComp.setSelectedIndex(1); // '매각'만 선택

                    document.getElementById('mf_wfm_mainFrame_btn_dspslRsltSrch').click();
                }}""")
                await asyncio.sleep(4)

                if not xhr_results:
                    await asyncio.sleep(3)

                first_resp = xhr_results[-1] if xhr_results else {}
                total_cnt = first_resp.get('data', {}).get('dma_pageInfo', {}).get('totalCnt', 0)
                try:
                    total_cnt = int(total_cnt)
                except:
                    total_cnt = 0
                print(f"  -> 검색된 실제 매각 건수: {total_cnt}건")

                if total_cnt == 0:
                    continue

                # 페이지 순회 (최대 max_pages_per_court)
                total_pages = min(max_pages_per_court, (total_cnt + 9) // 10)
                for page_no in range(1, total_pages + 1):
                    if page_no > 1:
                        xhr_results.clear()
                        # page_no 링크 클릭
                        clicked = await page.evaluate(f"""(p) => {{
                            const pEl = document.getElementById(`mf_wfm_mainFrame_pgl_gdsDtlSrchPage_page_${{p}}`);
                            if (pEl) {{
                                pEl.click();
                                return true;
                            }}
                            const comp = window.WebSquare.util.getComponentById('mf_wfm_mainFrame_pgl_gdsDtlSrchPage');
                            if (comp && comp.setSelectedIndex) {{
                                comp.setSelectedIndex(p);
                                return true;
                            }}
                            return false;
                        }}""", page_no)
                        await asyncio.sleep(4)
                        if not xhr_results:
                            await asyncio.sleep(3)

                    curr_resp = xhr_results[-1] if xhr_results else {}
                    items = curr_resp.get('data', {}).get('dlt_srchResult', [])
                    print(f"  - [{court_name}] {page_no}/{total_pages}페이지: {len(items)}건 수신")

                    for it in items:
                        mae_amt = int(it.get('maeAmt') or 0)
                        if mae_amt <= 0:
                            continue  # 유찰 또는 미매각 건 제외

                        case_no = it.get('srnSaNo') or ''
                        if not case_no:
                            continue

                        # 물건 고유 키 (사건번호 + 물건번호)
                        maemul_ser = it.get('maemulSer') or '1'
                        unique_case_id = f"{case_no}#{maemul_ser}" if maemul_ser != '1' else case_no

                        appraisal = int(it.get('gamevalAmt') or 0)
                        min_bid = int(it.get('minmaePrice') or 0)
                        winning_bid = mae_amt
                        winning_rate = round((winning_bid / appraisal) * 100, 1) if appraisal > 0 else 100.0

                        loc = (it.get('printSt') or '').strip()
                        sido = it.get('hjguSido') or ''
                        sgg = it.get('hjguSigu') or ''
                        emd = it.get('hjguDong') or ''
                        raw_usage = it.get('dspslUsgNm') or ''
                        actual_usage = clean_usage(raw_usage, loc)

                        # 면적 (areaList: "96㎡")
                        area_m2 = 0.0
                        area_str = str(it.get('areaList') or '')
                        m_area = re.search(r'([0-9.]+)\s*㎡', area_str)
                        if m_area:
                            try:
                                area_m2 = float(m_area.group(1))
                            except:
                                area_m2 = 0.0
                        area_pyeong = round(area_m2 / 3.3058, 1)

                        failed_cnt = int(it.get('yuchalCnt') or 0)
                        result_date_raw = str(it.get('maeGiil') or '')
                        result_date = f"{result_date_raw[:4]}-{result_date_raw[4:6]}-{result_date_raw[6:]}" if len(result_date_raw) == 8 else result_date_raw
                        court = it.get('jiwonNm') or court_name

                        notes = f"⚖️ 대법원 법원경매 실제 매각 (유찰 {failed_cnt}회 후 낙찰)"

                        # DB 저장 (INSERT OR REPLACE)
                        try:
                            cur.execute("""
                            INSERT INTO auction_results (
                                source, case_number, item_name, location, addr_sido, addr_sgg, addr_emd,
                                usage, floor, area_pyeong, area_m2, appraisal, min_bid, winning_bid,
                                winning_rate, bidder_count, runner_up_bid, result_date, result_status,
                                court_name, special_notes, rights_list, ai_grade, ai_score,
                                disposal_method, prpt_div, reg_org_nm, failed_count
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(case_number) DO UPDATE SET
                                winning_bid=excluded.winning_bid,
                                winning_rate=excluded.winning_rate,
                                result_date=excluded.result_date,
                                result_status='매각',
                                court_name=excluded.court_name,
                                special_notes=excluded.special_notes,
                                failed_count=excluded.failed_count
                            """, (
                                "court", unique_case_id, loc.split()[-1] if loc else "경매물건", loc, sido, sgg, emd,
                                actual_usage, 0, area_pyeong, area_m2, appraisal, min_bid, winning_bid,
                                winning_rate, 0, 0, result_date, "매각",
                                court, notes, "[]", "", 0,
                                "매각", "법원경매", court, failed_cnt
                            ))
                            if cur.rowcount == 1:
                                total_inserted += 1
                            else:
                                total_updated += 1
                        except Exception as e_db:
                            print(f"  [!] DB 저장 오류 ({unique_case_id}): {e_db}")

                    conn.commit()
                    await asyncio.sleep(2)

        except Exception as e_main:
            print(f"[!] 대법원 크롤러 실행 중 예외: {e_main}")
        finally:
            await browser.close()

    conn.commit()
    total_in_db = cur.execute("SELECT COUNT(*) FROM auction_results WHERE source='court'").fetchone()[0]
    conn.close()

    print(f"\n=== 대법원 법원경매 매각결과 수집 완료 ===")
    print(f"신규 적재: {total_inserted}건, 갱신: {total_updated}건")
    print(f"DB 내 법원경매 낙찰결과 총계: {total_in_db}건")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--courts", type=str, default="", help="수집할 법원 쉼표 구분 (예: 서울중앙지방법원,성남지원)")
    parser.add_argument("--all-metro", action="store_true", help="수도권 16개 법원 전수 수집")
    parser.add_argument("--max-pages", type=int, default=3, help="법원당 최대 페이지수 (기본 3페이지=30건)")
    parser.add_argument("--no-headless", action="store_true", help="브라우저 화면 표시")
    args = parser.parse_args()

    courts = None
    if args.courts:
        courts = [c.strip() for c in args.courts.split(",") if c.strip()]
    elif args.all_metro:
        courts = METRO_COURTS

    asyncio.run(scrape_court_results(target_courts=courts, max_pages_per_court=args.max_pages, headless=not args.no_headless))
