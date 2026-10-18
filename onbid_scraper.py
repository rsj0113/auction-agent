"""
온비드(KAMCO OnBid) 공매 상가/근린생활시설 수집기
- 온비드 조건검색(srchCltrCdtn.do) AJAX 엔드포인트 연동
- 상가, 근린생활시설, 판매시설, 점포 등 상업용 공매 매물 집중 수집
- 1층 매물 분석, 감정가 대비 할인율 계산, 소액/반값 추천 태그 부여
- SQLite auction_db.sqlite onbid_items 테이블에 적재
"""

import os
import re
import sys
import json
import time
import datetime
import sqlite3
import requests
import urllib.parse

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auction_db.sqlite")
SEARCH_URL = "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/srchCltrCdtn.do"
REFERER_URL = "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": REFERER_URL,
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
}

def get_base_payload():
    """온비드 조건검색 기본 페이로드 생성"""
    today = datetime.date.today().strftime("%Y-%m-%d")
    next_month = (datetime.date.today() + datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    
    payload = [
        ('pageIndex', '1'),
        ('pageUnit', '100'),
        ('srchBidPerdBgngDt', today),
        ('srchBidPerdEndDt', next_month),
        ('srchPvctYn', ''),
        ('srchArrayCtgrId', ''),
        ('srchArrayRgn', ''),
        ('srchWordType', '0001'),
        ('srchSortType', 'ASC'),
        ('srchLowstBidBgngPrc', ''),
        ('srchLowstBidEndPrc', ''),
        ('srchApslEvlBgngAmt', ''),
        ('srchApslEvlEndAmt', ''),
        ('cltrScrnGrpCd', ''),
        ('cltrPrptDivCd', ''),
        ('onbidCltrno', ''),
        ('onbidPbancNo', ''),
        ('pbctNo', ''),
        ('pbctCdtnNo', ''),
        ('srchLowstBidBgng', ''),
        ('srchApslEvlAmtType', '001'),
        ('rtnListUrl', ''),
        ('searchCltrMnmtNoYn', 'N'),
        ('test', ''),
        ('pinHistory', ''),
        ('dtlChk', ''),
        ('srchPbancStatSrchPvctYn', ''),
        ('srchCltrType', '0001'),  # 부동산
        ('srchPrptType', ''),
        ('srchPrptType', '0007'),
        ('srchPrptType', '0010'),
        ('srchPrptType', '0005'),
        ('srchPrptType', '0003'),
        ('srchPrptType', '0013'),
        ('srchPrptType', '0002'),
        ('srchPrptType', '0011'),
        ('srchPrptType', '0006'),
        ('srchPrptType', '0008'),
        ('srchPrptType', '0004'),
        ('srchDspsMthod', ''),
        ('checkMobileUsg', 'on'),
        ('checkMobileRgn', 'on'),
        ('calOpbdBgdd', ''),
        ('calOpbdEndd', ''),
        ('srchBidDivType', ''),
        ('srchBidPerdType', '0002'),
        ('calBidPerdBgngDt', today),
        ('calhBidPerdEndDt', next_month),
        ('srchBidMthod', ''),
        ('scr02_011', '0'),
        ('srchApslEvlBgngType', ''),
        ('srchApslEvlEndType', ''),
        ('scr02_01', '0'),
        ('srchLowstBidBgngType', ''),
        ('srchLowstBidEndType', ''),
        ('srchLdarType', 'ALL'),
        ('srchMinLdar', ''),
        ('srchMaxLdar', ''),
        ('srchBldSqmsType', 'ALL'),
        ('srchMinBldLdar', ''),
        ('srchMaxBldLdar', ''),
        ('srchAlcYnType', ''),
        ('srchUsbdNftType', 'ALL'),
        ('srchUsbdNftBgng', ''),
        ('srchUsbdNftEnd', ''),
        ('srchCltrNm', ''),
        ('srchCltrMnmtNo', ''),
        ('srchOrgNm', ''),
    ]
    return payload

def parse_floor_and_tags(cltr_nm, min_bid, appraisal, discount_pct, prpt_div, disposal_method, bld_area_pyeong=0.0):
    """물건명 및 금액에서 층수 및 추천 태그 판별 (지하1층/B1 골프·체육시설 감지 포함)"""
    floor = 0
    is_first_floor = 0
    
    nm = cltr_nm or ""
    # 1. 지하층/B1 탐지 (명확한 지하 표기)
    m_under = re.search(r'(?:제?지하|제지|(?<![가-힣A-Za-z])지|(?<![A-Za-z])[bB])\s*([1-9])\s*(?:층|,|~)', nm)
    if m_under:
        floor = -int(m_under.group(1))
    elif re.search(r'(?:지하도상가|지하상가|지하층|지하\s*도)', nm):
        floor = -1
    # 2. 지상층 탐지 (앞에 '단지', '빌리지', '파크빌비' 등 한글 단어가 붙은 경우 지하로 오인하지 않도록 방어)
    elif m_ground := re.search(r'(?<!지하)(?<!제지하)(?<!제지)(?<!(?<![가-힣])지)(?<!(?<![A-Za-z])[bB])(?:제)?\s*([1-9][0-9]?)\s*층', nm):
        try:
            floor = int(m_ground.group(1))
            if floor == 1:
                is_first_floor = 1
        except:
            floor = 0
    # 3. 호수 기반 fallback
    elif re.search(r'(?<![A-Za-z0-9])[bB](?:0?[1-9]|[1-9][0-9]{2,3})호', nm):
        floor = -1
    elif re.search(r'(?<![0-9])10[1-9]호|1[1-9][0-9]호\b', nm) and not re.search(r'[2-9][0-9]{2}호|[1-9][0-9]{3}호', nm):
        floor = 1
        is_first_floor = 1

    tags = []
    if is_first_floor:
        tags.append("🏪 1층상가")
    elif floor < 0:
        if bld_area_pyeong >= 30:
            tags.append(f"⛳ 지하{abs(floor)}층·{int(bld_area_pyeong)}평(골프/체육)")
        else:
            tags.append(f"🏢 지하{abs(floor)}층")

    if discount_pct >= 40:
        tags.append(f"🔥 {int(discount_pct)}%할인")
    elif discount_pct >= 20:
        tags.append(f"📉 {int(discount_pct)}%할인")
        
    if 0 < min_bid <= 100_000_000:
        tags.append("💰 1억이하소액")
    elif 0 < min_bid <= 300_000_000:
        tags.append("✨ 3억이하")
        
    if "압류" in (prpt_div or ""):
        tags.append("⚖️ 세금압류")
    elif "공유" in (prpt_div or ""):
        tags.append("🏛️ 공유재산")
    elif "국유" in (prpt_div or ""):
        tags.append("🏛️ 국유재산")
        
    if "임대" in (disposal_method or ""):
        tags.append("🔑 공공임대")
    else:
        tags.append("🏷️ 매각")

    return floor, is_first_floor, " · ".join(tags)

def fetch_onbid_by_keyword(keyword, max_pages=3):
    """키워드 기반 온비드 공매 검색 및 수집"""
    print(f"[*] 온비드 검색 시작: 키워드 '{keyword}', 최대 {max_pages}페이지")
    items = []
    session = requests.Session()
    
    for page in range(1, max_pages + 1):
        payload = get_base_payload()
        # 키워드 교체
        payload = [p for p in payload if p[0] not in ('srchCltrNm', 'pageIndex', 'pageUnit')]
        payload.append(('srchCltrNm', keyword))
        payload.append(('pageIndex', str(page)))
        payload.append(('pageUnit', '100'))
        
        try:
            resp = session.post(SEARCH_URL, data=payload, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                print(f"[!] HTTP 에러: {resp.status_code}")
                break
            
            data = resp.json()
            volist = data.get('cltrInfVOList', [])
            total_count = data.get('totalCount', 0)
            print(f"  - 페이지 {page}/{max_pages}: {len(volist)}건 반환 (전체 {total_count}건)")
            
            if not volist:
                break
                
            items.extend(volist)
            
            # 페이지네이션 종료 조건
            if len(items) >= total_count or len(volist) < 100:
                break
                
            time.sleep(0.5)
        except Exception as e:
            print(f"[!] 검색 중 예외 발생 ({keyword}, page {page}): {e}")
            break
            
    return items

def save_to_db(items):
    """온비드 데이터베이스 적재"""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    inserted_count = 0
    updated_count = 0
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for it in items:
        cltr_no = it.get('scrnIndctCltrMngNo') or it.get('cltrMngNo')
        if not cltr_no:
            continue
            
        onbid_cltr_no = str(it.get('onbidCltrno') or '')
        cltr_nm = it.get('onbidCltrNm') or ''
        addr_sido = it.get('sidoEmd') or ''
        addr_sgg = it.get('sggnm') or ''
        addr_emd = it.get('emdNm') or ''
        addr_full = it.get('sidoSgkEmd') or ''
        prpt_div = it.get('scrnPrptDvsnNm') or it.get('prptDvsnNm') or ''
        disposal_method = it.get('dspsMthodNm') or ''
        usage = it.get('ctgrLvlNm2') or it.get('ctgrNm') or ''
        
        appraisal = int(it.get('cltrApslEvlAvgAmt') or 0)
        min_bid = int(it.get('lowstBidPrc') or 0)
        
        # feeRate 는 감정가 대비 비율 (예: 70 -> 70%)
        fee_rate = it.get('feeRate')
        discount_pct = 0.0
        try:
            if fee_rate and fee_rate != '-':
                discount_pct = round(100.0 - float(fee_rate), 1)
            elif appraisal > 0 and min_bid > 0:
                discount_pct = round((1.0 - (min_bid / appraisal)) * 100.0, 1)
        except:
            discount_pct = 0.0
            
        bid_status = it.get('pbancPbctCltrStatNm') or ''
        remain_time = it.get('remainTime') or ''
        bid_start_date = it.get('pbctBegnDtm') or ''
        bid_end_date = it.get('pbctDdlnDt') or ''
        
        land_area_m2 = float(it.get('landSqms') or 0.0)
        bld_area_m2 = float(it.get('bldSqms') or 0.0)
        bld_area_pyeong = round(bld_area_m2 * 0.3025, 2)
        
        reg_org_nm = it.get('regOrgNm') or ''
        
        # 층수 및 태그 추출
        floor, is_first_floor, recommend_tag = parse_floor_and_tags(
            cltr_nm, min_bid, appraisal, discount_pct, prpt_div, disposal_method, bld_area_pyeong
        )
        
        # 상세 URL 조립
        pbct_no = str(it.get('pbctNo') or '')
        pbct_cdtn_no = str(it.get('pbctCdtnNo') or '')
        cltr_scrn_grp_cd = str(it.get('cltrScrnGrpCd') or '0001')
        cltr_his_no = str(it.get('cltrHisNo') or '')
        onbid_pbanc_no = str(it.get('onbidPbancNo') or '')
        
        detail_url = (
            f"https://www.onbid.co.kr/op/cltrpbancinf/cltrdtl/CltrDtlController/mvmnCltrDtl.do?"
            f"cltrHstrNo={cltr_his_no}&onbidCltrno={onbid_cltr_no}&onbidPbancNo={onbid_pbanc_no}&"
            f"pbctno={pbct_no}&cltrScrnGrpCd={cltr_scrn_grp_cd}&pbctCdtnNo={pbct_cdtn_no}"
        )
        
        # 즐겨찾기 보존을 위해 기존 값 확인
        cur.execute("SELECT is_favorite FROM onbid_items WHERE cltr_no = ?", (cltr_no,))
        row = cur.fetchone()
        is_favorite = row[0] if row else 0
        
        cur.execute("""
            INSERT INTO onbid_items (
                cltr_no, onbid_cltr_no, cltr_nm, addr_sido, addr_sgg, addr_emd, addr_full,
                prpt_div, disposal_method, usage, appraisal, min_bid, discount_pct,
                bid_status, remain_time, bid_start_date, bid_end_date,
                floor, is_first_floor, land_area_m2, bld_area_m2, bld_area_pyeong,
                reg_org_nm, detail_url, is_favorite, recommend_tag, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cltr_no) DO UPDATE SET
                onbid_cltr_no=excluded.onbid_cltr_no,
                cltr_nm=excluded.cltr_nm,
                addr_sido=excluded.addr_sido,
                addr_sgg=excluded.addr_sgg,
                addr_emd=excluded.addr_emd,
                addr_full=excluded.addr_full,
                prpt_div=excluded.prpt_div,
                disposal_method=excluded.disposal_method,
                usage=excluded.usage,
                appraisal=excluded.appraisal,
                min_bid=excluded.min_bid,
                discount_pct=excluded.discount_pct,
                bid_status=excluded.bid_status,
                remain_time=excluded.remain_time,
                bid_start_date=excluded.bid_start_date,
                bid_end_date=excluded.bid_end_date,
                floor=excluded.floor,
                is_first_floor=excluded.is_first_floor,
                land_area_m2=excluded.land_area_m2,
                bld_area_m2=excluded.bld_area_m2,
                bld_area_pyeong=excluded.bld_area_pyeong,
                reg_org_nm=excluded.reg_org_nm,
                detail_url=excluded.detail_url,
                recommend_tag=excluded.recommend_tag,
                scraped_at=excluded.scraped_at
        """, (
            cltr_no, onbid_cltr_no, cltr_nm, addr_sido, addr_sgg, addr_emd, addr_full,
            prpt_div, disposal_method, usage, appraisal, min_bid, discount_pct,
            bid_status, remain_time, bid_start_date, bid_end_date,
            floor, is_first_floor, land_area_m2, bld_area_m2, bld_area_pyeong,
            reg_org_nm, detail_url, is_favorite, recommend_tag, now_str
        ))
        inserted_count += 1
        
    conn.commit()
    conn.close()
    print(f"[+] 온비드 DB 저장 완료: 총 {inserted_count}건 처리")
    return inserted_count

def run_scraper():
    """메인 수집 루프"""
    print(f"[{datetime.datetime.now()}] 온비드 공매 상가 크롤러 가동")
    keywords = ["상가", "근린생활시설", "판매시설", "점포", "성남", "분당"]
    all_items_dict = {}
    
    for kw in keywords:
        items = fetch_onbid_by_keyword(kw, max_pages=3)
        for it in items:
            key = it.get('scrnIndctCltrMngNo') or it.get('cltrMngNo')
            if key:
                all_items_dict[key] = it
        time.sleep(1)
        
    unique_items = list(all_items_dict.values())
    print(f"\n[*] 총 고유 온비드 매물 수: {len(unique_items)}건")
    saved = save_to_db(unique_items)
    
    # 요약 통계 출력
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT count(*), sum(case when is_first_floor=1 then 1 else 0 end), sum(case when discount_pct >= 30 then 1 else 0 end) FROM onbid_items")
    total, first_fl, discounted = cur.fetchone()
    print(f"[★] 온비드 DB 통계: 총 {total}건 | 1층 상가: {first_fl}건 | 30%이상 할인: {discounted}건")
    
    cur.execute("""
        SELECT cltr_no, disposal_method, prpt_div, usage, bld_area_pyeong, appraisal, min_bid, discount_pct, remain_time, addr_full, recommend_tag
        FROM onbid_items
        ORDER BY is_first_floor DESC, discount_pct DESC
        LIMIT 5
    """)
    print("\n[★] 온비드 추천 매물 TOP 5:")
    for r in cur.fetchall():
        print(f"  - [{r[0]}] {r[9]} | {r[1]} {r[2]} ({r[3]}, {r[4]}평) | 감정: {r[5]:,}원 -> 최저: {r[6]:,}원 ({r[7]}%↓) | {r[8]} | {r[10]}")
    conn.close()

if __name__ == "__main__":
    run_scraper()
