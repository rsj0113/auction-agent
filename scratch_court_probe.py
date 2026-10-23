"""법원경매 사건 상세(selectAuctnCsSrchRslt) 응답에서 기일별 결과 필드 구조 확인용 프로토타입."""
import asyncio, json, sys
from playwright.async_api import async_playwright

CASES = sys.argv[1:] or ["2023타경104875"]
CODES = ["B000210","B000240"]
KIND = {"타경": "0130", "타특": "0140", "타기": "0150"}


def api_no(c):
    import re
    y, k, n = re.match(r"(\d{4})(타경|타특|타기)\s*(\d+)", c).groups()
    return f"{y}{KIND[k]}{n.zfill(6)}"


JS = """async ([csNo, cort]) => {
  const r = await fetch('/pgj/pgj15B/selectAuctnCsSrchRslt.on', {method:'POST',
    headers:{'Content-Type':'application/json; charset=UTF-8','Accept':'application/json','SC-Userid':'NONUSER','submissionid':'mf_wfm_mainFrame_sbm_selectAuctnCsSrchRslt'},
    credentials:'same-origin',
    body: JSON.stringify({dma_srchGdsDtlSrch:{csNo:csNo, cortOfcCd:cort, dspslGdsSeq:'1', pgmId:'PGJ151F01'}})});
  if(!r.ok) return {error:r.status};
  return await r.json();
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
        ctx = await b.new_context(locale="ko-KR", timezone_id="Asia/Seoul",
                                  user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        page = await ctx.new_page()
        await page.goto("https://www.courtauction.go.kr", wait_until="networkidle", timeout=60000)
        for c in CASES:
            for code in CODES:
                d = await page.evaluate(JS, [api_no(c), code])
                dma = ((d or {}).get("data") or {}).get("dma_result") or {}
                print("RAW", json.dumps(d, ensure_ascii=False)[:1500])
                print(c, code, "error" if d.get("error") else (d.get("message") or "")[:40], "has_info" if dma.get("dspslGdsDxdyInfo") else "-")
                if dma.get("dspslGdsDxdyInfo"):
                    print(json.dumps(dma.get("gdsDspslDxdyLst"), ensure_ascii=False, indent=1)[:2500])
                    print(json.dumps(dma.get("dspslGdsDxdyInfo"), ensure_ascii=False)[:1200])
                    break
                await asyncio.sleep(1.5)
        await b.close()

asyncio.run(main())
