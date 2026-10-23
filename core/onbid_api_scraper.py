"""
공공데이터포털 온비드 차세대 부동산 물건목록 API (OnbidRlstListSrvc2) 수집기.
기존 웹 엔드포인트 크롤링 방식과 호환되며, 공식 OpenAPI를 통해 안정적으로 물건을 수집 및 최신화합니다.
"""
import os
import re
import json
import time
import datetime
import sqlite3
import urllib.parse
import sys
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
from onbid_scraper import parse_floor_and_tags

DB_PATH = os.path.join(ROOT_DIR, "auction_db.sqlite")
ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
PRPT_CODES = ["0007", "0010", "0005", "0003", "0002", "0006", "0008", "0011", "0013"]
ROWS = 100

def _load_key():
    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        env_path = os.path.join(ROOT_DIR, ".env")
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("DATA_GO_KR_KEY="):
                        key = line.split("=", 1)[1].strip()
    if not key:
        raise RuntimeError("DATA_GO_KR_KEY not found in .env")
    return urllib.parse.unquote(key)

def fetch_page(key, prpt_cd, pvct_yn="N", page=1):
    params = {
        "serviceKey": key,
        "resultType": "json",
        "pageNo": page,
        "numOfRows": ROWS,
        "prptDivCd": prpt_cd,
        "pvctTrgtYn": pvct_yn
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except Exception as e:
            time.sleep(1.5)
    return None

def run(max_pages_per_type=3):
    key = _load_key()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    total_inserted = 0
    total_updated = 0

    print(f"=== [{now_str}] 온비드 공식 부동산 물건목록 API 수집 시작 ===")

    for prpt in PRPT_CODES:
        for pvct in ["N", "Y"]:
            page = 1
            while page <= max_pages_per_type:
                resp = fetch_page(key, prpt, pvct, page)
                if not resp or "body" not in resp:
                    break
                body = resp["body"]
                raw_items = (body.get("items") or {}).get("item") or []
                if isinstance(raw_items, dict):
                    raw_items = [raw_items]
                if not raw_items:
                    break

                for it in raw_items:
                    cltr_no = it.get("cltrMngNo")
                    if not cltr_no:
                        continue
                    onbid_cltr_no = str(it.get("onbidCltrno") or "")
                    cltr_nm = it.get("onbidCltrNm") or ""
                    addr_sido = it.get("lctnSdnm") or ""
                    addr_sgg = it.get("lctnSggnm") or ""
                    addr_emd = it.get("lctnEmdNm") or ""
                    addr_full = f"{addr_sido} {addr_sgg} {addr_emd} {cltr_nm}".strip()
                    prpt_div = it.get("prptDivNm") or ""
                    disposal_method = it.get("dspsMthodNm") or ""
                    usage = it.get("cltrUsgMclsCtgrNm") or it.get("cltrUsgSclsCtgrNm") or "부동산"

                    appraisal = int(it.get("apslEvlAmt") or 0)
                    _raw_lowst = re.sub(r"[^0-9]", "", str(it.get("lowstBidPrcIndctCont") or ""))
                    min_bid = int(_raw_lowst) if _raw_lowst else 0

                    discount_pct = 0.0
                    if appraisal > 0 and min_bid > 0:
                        discount_pct = round((1.0 - (min_bid / appraisal)) * 100.0, 1)

                    bid_status = it.get("pbctStatNm") or "입찰진행"
                    
                    # 날짜 포맷팅 (yyyyMMddHHmm -> YYYY-MM-DD HH:MM)
                    bgng_raw = str(it.get("cltrBidBgngDt") or "")
                    end_raw = str(it.get("cltrBidEndDt") or "")
                    bid_start_date = f"{bgng_raw[:4]}-{bgng_raw[4:6]}-{bgng_raw[6:8]} {bgng_raw[8:10]}:{bgng_raw[10:12]}" if len(bgng_raw) >= 12 else bgng_raw
                    bid_end_date = f"{end_raw[:4]}-{end_raw[4:6]}-{end_raw[6:8]} {end_raw[8:10]}:{end_raw[10:12]}" if len(end_raw) >= 12 else end_raw
                    remain_time = "진행중"

                    land_area_m2 = float(it.get("landSqms") or 0.0)
                    bld_area_m2 = float(it.get("bldSqms") or 0.0)
                    bld_area_pyeong = round(bld_area_m2 * 0.3025, 2)
                    reg_org_nm = it.get("rqstOrgNm") or it.get("orgNm") or "온비드"

                    floor, is_first_floor, recommend_tag = parse_floor_and_tags(
                        cltr_nm, min_bid, appraisal, discount_pct, prpt_div, disposal_method, bld_area_pyeong
                    )

                    pbct_no = str(it.get("pbctNo") or "")
                    pbct_cdtn_no = str(it.get("pbctCdtnNo") or "")
                    onbid_pbanc_no = str(it.get("onbidPbancNo") or "")
                    detail_url = (
                        f"https://www.onbid.co.kr/op/cltrpbancinf/cltrdtl/CltrDtlController/mvmnCltrDtl.do?"
                        f"onbidCltrno={onbid_cltr_no}&onbidPbancNo={onbid_pbanc_no}&"
                        f"pbctno={pbct_no}&pbctCdtnNo={pbct_cdtn_no}"
                    )

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
                    if cur.rowcount == 1:
                        total_inserted += 1
                    else:
                        total_updated += 1

                total_count = int(body.get("totalCount") or 0)
                if page * ROWS >= total_count:
                    break
                page += 1

    conn.commit()
    conn.close()
    print(f"=== 온비드 API 수집 완료: 신규 등록 {total_inserted}건, 갱신 {total_updated}건 ===")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=2, help="유형별 최대 수집 페이지수")
    args = parser.parse_args()
    run(max_pages_per_type=args.pages)
