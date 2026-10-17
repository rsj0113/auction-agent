import requests
import re

url = "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do"
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
session = requests.Session()
r = session.get(url, headers=headers, timeout=15)

for m in re.finditer(r'function\s+fn_mainListSearch\s*\([^)]*\)\s*\{', r.text):
    start = m.start() + 2000
    end = min(len(r.text), start + 3000)
    print("--- fn_mainListSearch 2 ---")
    print(r.text[start:end])
