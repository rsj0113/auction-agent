import asyncio
import json
import re
import sqlite3
import random
from datetime import datetime
from playwright.async_api import async_playwright
from rich.console import Console

console = Console()

DB_PATH = "auction_db.sqlite"

COURT_CODES = [
    'B000210', # 서울중앙지법
    'B000220', # 서울동부지법
    'B000230', # 서울남부지법
    'B000240', # 서울북부지법
    'B000250', # 서울서부지법
    'B000290', # 수원지법
    'B000280', # 인천지법
    'B000260', # 의정부지법
]

async def sync_tenants(limit: int = 50):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get items needing tenant sync
    cursor.execute("""
        SELECT case_number, location, appraisal, min_bid, rights_list, ai_report_json
        FROM auction_items
        WHERE tenant_registration_date IS NULL OR tenant_registration_date = ''
        ORDER BY last_updated DESC
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        console.print("[yellow]동기화할 물건이 없습니다.[/yellow]")
        return

    console.print(f"[bold cyan]🎯 임차인 데이터 동기화 대상: {len(rows)}건[/bold cyan]")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        console.print("[dim]1. 법원경매 사이트 접속 및 세션 초기화...[/dim]")
        await page.goto("https://www.courtauction.go.kr", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)

        for btn in await page.query_selector_all("text='닫기', text='오늘하루열지않기'"):
            try: await btn.click()
            except: pass

        quick_btn = page.locator("a.btn_adv, a[title*='물건상세검색']").first
        await quick_btn.wait_for(timeout=15000)
        await quick_btn.click()
        await page.wait_for_timeout(5000)

        frame = None
        for f in page.frames:
            if "PGJ151" in f.url or "pgj" in f.url or "index.on" in f.url:
                frame = f
                break

        search_btn = await frame.query_selector("text='검색'")
        if not search_btn:
            search_btn = await frame.query_selector("a#mf_wfm_mainFrame_btn_search")
        if search_btn:
            await search_btn.click()
        await frame.wait_for_selector("text='인쇄하기'", timeout=30000)
        await page.wait_for_timeout(3000)

        # Capture headers from moveDtlPage
        captured_headers = {}
        def on_resp(resp):
            if 'selectAuctnCsSrchRslt' in resp.url:
                for k, v in resp.request.headers.items():
                    if k not in ('content-type',):
                        captured_headers[k] = v

        page.on("response", on_resp)
        await frame.evaluate("() => moveDtlPage(0)")
        await page.wait_for_timeout(5000)

        fetch_curst_js = f"""
        async ([csNo, cortOfcCd]) => {{
            const extraHeaders = {json.dumps(captured_headers)};
            const resp = await fetch('/pgj/pgj15B/selectCurstExmndc.on', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json; charset=UTF-8',
                    ...extraHeaders
                }},
                credentials: 'same-origin',
                body: JSON.stringify({{
                    dma_srchCurstExmn: {{
                        cortOfcCd: cortOfcCd,
                        csNo: csNo,
                        auctnInfOriginDvsCd: '2',
                        ordTsCnt: ''
                    }}
                }})
            }});
            if (!resp.ok) return {{error: resp.status}};
            return await resp.json();
        }}
        """

        updated_count = 0
        tenant_found_count = 0

        for idx, row in enumerate(rows):
            case_no = row['case_number']
            loc = row['location']
            console.print(f"[{idx+1}/{len(rows)}] 🔍 {case_no} ({loc[:20]}...) 현황조사서 조회 중...")

            # Guess likely court code based on location
            likely_codes = list(COURT_CODES)
            if '동대문' in loc or '중랑' in loc or '노원' in loc or '도봉' in loc or '강북' in loc:
                likely_codes = ['B000240'] + [c for c in COURT_CODES if c != 'B000240']
            elif '강동' in loc or '송파' in loc or '광진' in loc or '성동' in loc:
                likely_codes = ['B000220'] + [c for c in COURT_CODES if c != 'B000220']
            elif '강서' in loc or '양천' in loc or '구로' in loc or '영등포' in loc or '금천' in loc or '동작' in loc or '관악' in loc:
                likely_codes = ['B000230'] + [c for c in COURT_CODES if c != 'B000230']
            elif '은평' in loc or '서대문' in loc or '마포' in loc:
                likely_codes = ['B000250'] + [c for c in COURT_CODES if c != 'B000250']
            elif '수원' in loc or '용인' in loc or '화성' in loc:
                likely_codes = ['B000290'] + [c for c in COURT_CODES if c != 'B000290']
            elif '인천' in loc or '부천' in loc:
                likely_codes = ['B000280'] + [c for c in COURT_CODES if c != 'B000280']
            elif '의정부' in loc or '남양주' in loc or '구리' in loc:
                likely_codes = ['B000260'] + [c for c in COURT_CODES if c != 'B000260']

            found_curst = None
            for c_code in likely_codes[:3]: # top 3 likely codes
                try:
                    res = await page.evaluate(fetch_curst_js, [case_no, c_code])
                    if res and not res.get('error'):
                        data = res.get('data') or {}
                        # Check if valid report returned
                        if data.get('dma_curstExmnMngInf') or data.get('dlt_ordTsLserLtn') or data.get('dlt_ordTsRlet'):
                            found_curst = data
                            break
                except Exception:
                    pass
                await asyncio.sleep(0.5)

            if found_curst:
                leases = found_curst.get('dlt_ordTsLserLtn') or []
                dates = []
                max_deposit = 0
                is_payout = False
                tenants_list = []

                for l in leases:
                    name = (l.get('intrpsNm') or '').strip()
                    move_in = (l.get('mvinDtlCtt') or '').strip()
                    dep_raw = (l.get('lesDposDts') or '').strip()
                    monthly = (l.get('mmrntAmtDts') or '').strip()
                    fixed = (l.get('rgstryCrtcpCfmtnCtt') or '').strip()
                    room = (l.get('bldDtlDts') or '').strip()
                    poss = (l.get('gdsPossCtt') or '').strip()

                    norm_date = ""
                    if move_in:
                        dm = re.search(r'(\d{4})[./-](\d{1,2})[./-](\d{1,2})', move_in)
                        if dm:
                            norm_date = f"{dm.group(1)}.{dm.group(2).zfill(2)}.{dm.group(3).zfill(2)}"
                            dates.append(norm_date)

                    dep_val = 0
                    if dep_raw:
                        num_matches = re.findall(r'[\d,]+', dep_raw)
                        for nm in num_matches:
                            try:
                                v = int(nm.replace(',', ''))
                                if v > dep_val: dep_val = v
                            except: pass
                    if dep_val > max_deposit:
                        max_deposit = dep_val

                    if any(k in poss or k in fixed for k in ('배당요구', '배당신청', '배당요구일')):
                        is_payout = True

                    tenants_list.append({
                        "name": name,
                        "move_in_date": norm_date or move_in,
                        "deposit": dep_val if dep_val > 0 else (dep_raw or "미상"),
                        "monthly_rent": monthly or "",
                        "fixed_date": fixed or "",
                        "room": room,
                    })

                best_date = min(dates) if dates else ""
                
                # Update AI report
                ai_rep = {}
                try:
                    if row['ai_report_json']:
                        ai_rep = json.loads(row['ai_report_json'])
                except:
                    pass
                ai_rep['tenants'] = tenants_list

                # Update SQLite
                with sqlite3.connect(DB_PATH) as conn2:
                    c2 = conn2.cursor()
                    c2.execute("""
                        UPDATE auction_items
                        SET tenant_registration_date = ?,
                            tenant_deposit = ?,
                            is_payout_requested = ?,
                            ai_report_json = ?
                        WHERE case_number = ?
                    """, (
                        best_date if best_date else "임차인없음",
                        max_deposit,
                        1 if is_payout else 0,
                        json.dumps(ai_rep, ensure_ascii=False),
                        case_no
                    ))
                    conn2.commit()

                updated_count += 1
                if tenants_list:
                    tenant_found_count += 1
                    console.print(f"  [bold green]✅ 임차인 {len(tenants_list)}명 등록 (전입일: {best_date or '미상'}, 보증금: {max_deposit:,}원)[/bold green]")
                else:
                    console.print(f"  [dim]ℹ️ 임차인 없음 (소유자 점유 확인)[/dim]")
            else:
                console.print(f"  [dim yellow]⚠️ 현황조사서 미확인 (미공시 또는 관할 불일치)[/dim yellow]")

            await asyncio.sleep(random.uniform(0.8, 1.5))

        console.print(f"\n[bold green]🎉 완료! 총 {updated_count}건 업데이트 (임차인 발견: {tenant_found_count}건)[/bold green]")
        await browser.close()

if __name__ == "__main__":
    import sys
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    asyncio.run(sync_tenants(limit))
