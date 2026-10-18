import requests
import urllib.parse
import json

with open("onbid_initial_payload.txt", "r", encoding="utf-8") as f:
    raw_payload = f.read().strip()

parsed = urllib.parse.parse_qs(raw_payload)
# Convert list values to single values or keep multiple if needed
# Note that srchPrptType has multiple values
payload = []
for k, vals in parsed.items():
    for v in vals:
        payload.append((k, v))

search_url = "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/srchCltrCdtn.do"
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do",
    "X-Requested-With": "XMLHttpRequest"
}

# 1. Test search with keyword "상가"
test_payload_1 = [p for p in payload if p[0] not in ('srchCltrNm', 'pageUnit', 'pageIndex')]
test_payload_1.append(('srchCltrNm', '상가'))
test_payload_1.append(('pageUnit', '50'))
test_payload_1.append(('pageIndex', '1'))

resp1 = requests.post(search_url, data=test_payload_1, headers=headers, timeout=15)
data1 = resp1.json()
print("Search '상가' totalCount:", data1.get('totalCount'), "Returned items:", len(data1.get('cltrInfVOList', [])))
for idx, it in enumerate(data1.get('cltrInfVOList', [])[:5]):
    print(f"[{idx+1}] {it.get('scrnIndctCltrMngNo')} | {it.get('dspsMthodNm')} | {it.get('scrnPrptDvsnNm')} | {it.get('ctgrLvlNm2')} | {it.get('sidoSgkEmd')} | {it.get('onbidCltrNm')} | 감정가: {it.get('cltrApslEvlAvgAmt'):,} | 최저가: {it.get('lowstBidPrc'):,} ({it.get('feeRate')}%) | {it.get('remainTime')}")

# 2. Test search with keyword "근린생활시설"
test_payload_2 = [p for p in payload if p[0] not in ('srchCltrNm', 'pageUnit', 'pageIndex')]
test_payload_2.append(('srchCltrNm', '근린생활시설'))
test_payload_2.append(('pageUnit', '50'))
test_payload_2.append(('pageIndex', '1'))

resp2 = requests.post(search_url, data=test_payload_2, headers=headers, timeout=15)
data2 = resp2.json()
print("\nSearch '근린생활시설' totalCount:", data2.get('totalCount'), "Returned items:", len(data2.get('cltrInfVOList', [])))
for idx, it in enumerate(data2.get('cltrInfVOList', [])[:5]):
    print(f"[{idx+1}] {it.get('scrnIndctCltrMngNo')} | {it.get('dspsMthodNm')} | {it.get('scrnPrptDvsnNm')} | {it.get('ctgrLvlNm2')} | {it.get('sidoSgkEmd')} | {it.get('onbidCltrNm')} | 감정가: {it.get('cltrApslEvlAvgAmt'):,} | 최저가: {it.get('lowstBidPrc'):,} ({it.get('feeRate')}%) | {it.get('remainTime')}")

# 3. Test search with keyword "성남"
test_payload_3 = [p for p in payload if p[0] not in ('srchCltrNm', 'pageUnit', 'pageIndex')]
test_payload_3.append(('srchCltrNm', '성남'))
test_payload_3.append(('pageUnit', '50'))
test_payload_3.append(('pageIndex', '1'))

resp3 = requests.post(search_url, data=test_payload_3, headers=headers, timeout=15)
data3 = resp3.json()
print("\nSearch '성남' totalCount:", data3.get('totalCount'), "Returned items:", len(data3.get('cltrInfVOList', [])))
for idx, it in enumerate(data3.get('cltrInfVOList', [])[:5]):
    print(f"[{idx+1}] {it.get('scrnIndctCltrMngNo')} | {it.get('dspsMthodNm')} | {it.get('scrnPrptDvsnNm')} | {it.get('ctgrLvlNm2')} | {it.get('sidoSgkEmd')} | {it.get('onbidCltrNm')} | 감정가: {it.get('cltrApslEvlAvgAmt'):,} | 최저가: {it.get('lowstBidPrc'):,} ({it.get('feeRate')}%) | {it.get('remainTime')}")
