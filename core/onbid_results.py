"""
온비드 물건 입찰결과 실데이터 수집기 (공공데이터포털 OnbidCltrBidRsltListSrvc2).

- 낙찰(scfbAmt > 0) 건만 auction_results 에 저장한다. 유찰/취소는 저장하지 않는다.
- 낙찰가, 개찰일, 유효입찰자 수(vldBddrNope)는 모두 API 실값이다. 랜덤 생성 값 없음.
- API가 주지 않는 값(2등 입찰가, 권리분석 등)은 비워둔다.

사용:
    python core/onbid_results.py            # 최근 7일
    python core/onbid_results.py --days 90  # 최근 90일 (최초 백필)
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "auction_db.sqlite")
ENDPOINT = "https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2"
PRPT_CODES = ["0007", "0010", "0005", "0003", "0002", "0006", "0008", "0011", "0013"]
ROWS = 500


def _load_key():
    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("DATA_GO_KR_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise RuntimeError("DATA_GO_KR_KEY not found in .env")
    return urllib.parse.unquote(key)  # Encoding 키가 들어와도 안전하게 처리


def _fetch(key, prpt, start, end, page):
    q = urllib.parse.urlencode({
        "serviceKey": key, "resultType": "json", "pageNo": page, "numOfRows": ROWS,
        "cltrTypeCd": "0001", "prptDivCd": prpt, "opbdDtStart": start, "opbdDtEnd": end,
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{ENDPOINT}?{q}", timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2)
    return None


def _items(resp):
    if not resp or "body" not in resp:
        return [], 0
    body = resp["body"]
    it = (body.get("items") or {}).get("item") or []
    if isinstance(it, dict):
        it = [it]
    return it, int(body.get("totalCount") or 0)


def _split_addr(name):
    toks = (name or "").split()
    sido = toks[0] if toks else ""
    sgg = toks[1] if len(toks) > 1 else ""
    emd = toks[2] if len(toks) > 2 else ""
    return sido, sgg, emd


def _usage(it):
    return " / ".join(x for x in [it.get("cltrUsgMclsCtgrNm"), it.get("cltrUsgSclsCtgrNm")] if x)


def run(days=7):
    key = _load_key()
    today = datetime.date.today()
    since = today - datetime.timedelta(days=days)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    saved = 0

    # 30일 단위로 쪼개 조회 (종료일은 현재 이전만 허용)
    chunk_start = since
    while chunk_start < today:
        chunk_end = min(chunk_start + datetime.timedelta(days=30), today - datetime.timedelta(days=1))
        if chunk_end < chunk_start:
            break
        s = chunk_start.strftime("%Y%m%d") + "0000"
        e = chunk_end.strftime("%Y%m%d") + "2359"
        for prpt in PRPT_CODES:
            page = 1
            while True:
                items, total = _items(_fetch(key, prpt, s, e, page))
                for it in items:
                    amt = it.get("scfbAmt")
                    if not amt or float(amt) <= 0:
                        continue  # 유찰/취소 제외
                    appraisal = int(it.get("apslEvlAmt") or 0)
                    if appraisal <= 0:
                        continue
                    winning = int(float(amt))
                    _mb = re.sub(r"[^0-9]", "", str(it.get("lowstBidPrcIndctCont") or ""))
                    min_bid = int(_mb) if _mb else 0  # '비공개'면 0 (모름)
                    name = it.get("onbidCltrNm") or ""
                    sido, sgg, emd = _split_addr(name)
                    d = str(it.get("cltrOpbdDt") or "")
                    r_date = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) >= 8 else ""
                    m2 = float(it.get("bldSqms") or 0)
                    bidders = int(it.get("vldBddrNope") or 0)
                    case_no = f"{it.get('cltrMngNo')}#{it.get('pbctCdtnNo')}"
                    notes = f"🏛️ 온비드 실제 개찰결과 ({it.get('prptDivNm') or ''}, 유효입찰 {bidders}명)"
                    cur.execute("""
                        INSERT OR REPLACE INTO auction_results (
                            source, case_number, item_name, location, addr_sido, addr_sgg, addr_emd,
                            usage, floor, area_pyeong, area_m2, appraisal, min_bid, winning_bid,
                            winning_rate, bidder_count, runner_up_bid, result_date, result_status,
                            court_name, special_notes, rights_list, ai_grade, ai_score,
                            disposal_method, prpt_div, reg_org_nm
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        "onbid", case_no, name, name, sido, sgg, emd,
                        _usage(it), 0, round(m2 / 3.3058, 1), m2, appraisal, min_bid, winning,
                        round(winning / appraisal * 100, 1), bidders, 0, r_date, "낙찰",
                        "한국자산관리공사(온비드)", notes, "[]", "", 0,
                        it.get("dspsMthodNm") or "매각", it.get("prptDivNm") or "", "온비드",
                    ))
                    saved += 1
                if page * ROWS >= total or not items:
                    break
                page += 1
        chunk_start = chunk_end + datetime.timedelta(days=1)

    conn.commit()
    n = cur.execute("SELECT COUNT(*) FROM auction_results").fetchone()[0]
    conn.close()
    print(f"[온비드 낙찰결과] 저장 {saved}건 / 누적 {n}건")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    run(ap.parse_args().days)
