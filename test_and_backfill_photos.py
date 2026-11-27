#!/usr/bin/env python3
"""
test_and_backfill_photos.py

현재 mobile_feed.json에 등록된 활성 매물(83건)에 대해
대법원 경매정보(courtauction.go.kr) 상세 API(dma_result.csPicLst)를 호출하여
실제 감정평가서/현황 사진을 수집하고 DB(auction_items.photo_url)에 저장 및 확보 건수를 테스트한다.
"""

import os
import re
import json
import base64
import sqlite3
import asyncio
from datetime import datetime
from playwright.async_api import async_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "auction_db.sqlite")
FEED_PATH = os.path.join(BASE_DIR, "mobile_feed.json")
PHOTOS_DIR1 = os.path.join(BASE_DIR, "attachments", "photos")
PHOTOS_DIR2 = os.path.join(BASE_DIR, "frontend", "public", "photos")

os.makedirs(PHOTOS_DIR1, exist_ok=True)
os.makedirs(PHOTOS_DIR2, exist_ok=True)

# 지역 키워드 -> 법원 코드 매핑
COURT_CODE_MAP = {
    # 서울 5대 법원
    "강남": "B000210", "서초": "B000210", "종로": "B000210", "중구": "B000210", "용산": "B000210", "동작": "B000210", "관악": "B000210",
    "송파": "B000211", "강동": "B000211", "광진": "B000211", "성동": "B000211",
    "양천": "B000212", "강서": "B000212", "영등포": "B000212", "구로": "B000212", "금천": "B000212",
    "노원": "B000213", "도봉": "B000213", "강북": "B000213", "중랑": "B000213", "동대문": "B000213",
    "은평": "B000215", "마포": "B000215", "서대문": "B000215",
    
    # 경기/인천 법원
    "성남": "B000251", "분당": "B000251", "광주": "B000251", "하남": "B000251", "이천": "B000251",
    "수원": "B000250", "용인": "B000250", "화성": "B000250", "오산": "B000250",
    "안양": "B000254", "군포": "B000254", "의왕": "B000254", "과천": "B000254",
    "안산": "B000255", "시흥": "B000255", "광명": "B000255",
    "고양": "B214807", "일산": "B214807", "파주": "B214807",
    "남양주": "B214804", "구리": "B214804", "가평": "B214804",
    "의정부": "B214801", "양주": "B214801", "포천": "B214801", "동두천": "B214801",
    "평택": "B000253", "안성": "B000253",
    "여주": "B000252", "양평": "B000252",
    "부천": "B000262", "김포": "B000262",
    "인천": "B000260", "부평": "B000260", "계양": "B000260", "남동": "B000260", "연수": "B000260", "미추홀": "B000260", "서구": "B000260"
}

_CASE_KIND_CODES = {'타경': '0130', '타특': '0140', '타기': '0150'}

def to_api_cs_no(case_no: str) -> str:
    m = re.match(r'(\d{4})(타경|타특|타기)\s*(\d+)', case_no)
    if m:
        year, kind, num = m.groups()
        code = _CASE_KIND_CODES.get(kind, '0130')
        return f"{year}{code}{num.zfill(6)}"
    return case_no

def infer_court_code(location: str) -> str:
    for kw, code in COURT_CODE_MAP.items():
        if kw in location:
            return code
    return "B000210" # fallback: 서울중앙

async def fetch_photos_for_feed():
    if not os.path.exists(FEED_PATH):
        print(f"Error: {FEED_PATH} not found.")
        return

    with open(FEED_PATH, "r", encoding="utf-8") as f:
        feed = json.load(f)

    items = feed.get("items", [])
    total_target = len(items)
    print(f"🎯 [사진 수집 테스트] 대상 활성 매물: 총 {total_target}건")

    success_count = 0
    failed_count = 0
    skipped_count = 0

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-web-security']
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        print("🌐 대법원 경매정보 접속 및 세션 초기화 중...")
        try:
            await page.goto("https://www.courtauction.go.kr", wait_until="networkidle", timeout=60000)
            await asyncio.sleep(2)
        except Exception as e:
            print(f"접속 지연 또는 타임아웃(계속 진행): {e}")

        # 상세 API fetch JavaScript 함수 준비
        fetch_js = """
        async ([csNo, cortOfcCd]) => {
            try {
                const resp = await fetch('/pgj/pgj15B/selectAuctnCsSrchRslt.on', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        dma_srchGdsDtlSrch: {
                            csNo: csNo,
                            cortOfcCd: cortOfcCd,
                            dspslGdsSeq: '1',
                            pgmId: 'PGJ151F01'
                        }
                    })
                });
                if (!resp.ok) return { error: resp.status };
                return await resp.json();
            } catch (err) {
                return { error: err.message };
            }
        }
        """

        for idx, item in enumerate(items, 1):
            case_no = item["case_number"]
            location = item.get("location", "")
            cs_no = to_api_cs_no(case_no)
            cort_code = infer_court_code(location)

            print(f"[{idx}/{total_target}] 사건번호: {case_no} (코드: {cort_code}) ... ", end="", flush=True)

            try:
                res = await page.evaluate(fetch_js, [cs_no, cort_code])
                if not res or res.get("error"):
                    # 법원 코드가 다를 수 있으므로 2순위 서울/수원 법원 시도
                    fallback_codes = [c for c in ["B000210", "B000211", "B000212", "B000213", "B000215", "B000250", "B000251", "B000254", "B214807"] if c != cort_code]
                    for fb in fallback_codes[:2]:
                        res = await page.evaluate(fetch_js, [cs_no, fb])
                        if res and not res.get("error") and (res.get("data") or {}).get("dma_result"):
                            cort_code = fb
                            break

                dma = (res.get("data") or {}).get("dma_result") or {}
                pic_list = dma.get("csPicLst") or []

                photos = []
                photo_rel_url = ""

                if pic_list and isinstance(pic_list, list):
                    for p_item in pic_list[:10]:
                        if not isinstance(p_item, dict):
                            continue
                        b64_str = (p_item.get("picFile") or "").strip()
                        p_seq = str(p_item.get("cortAuctnPicSeq") or len(photos) + 1)

                        if b64_str and len(b64_str) > 100:
                            clean_cs = re.sub(r'[^0-9a-zA-Z가-힣]', '_', case_no)
                            filename = f"{clean_cs}_{p_seq}.jpg"

                            path1 = os.path.join(PHOTOS_DIR1, filename)
                            path2 = os.path.join(PHOTOS_DIR2, filename)

                            try:
                                img_bytes = base64.b64decode(b64_str)
                                with open(path1, "wb") as f1:
                                    f1.write(img_bytes)
                                with open(path2, "wb") as f2:
                                    f2.write(img_bytes)

                                saved_path = f"/photos/{filename}"
                                photos.append(saved_path)
                                if not photo_rel_url:
                                    photo_rel_url = saved_path
                            except Exception as e_dec:
                                pass
                        elif p_item.get("picFileUrl") and p_item.get("picTitlNm"):
                            ext_url = f"https://www.courtauction.go.kr{p_item['picFileUrl']}{p_item['picTitlNm']}"
                            photos.append(ext_url)
                            if not photo_rel_url:
                                photo_rel_url = ext_url

                if photos:
                    photos_json = json.dumps(photos, ensure_ascii=False)
                    cursor.execute(
                        "UPDATE auction_items SET photo_url = ?, photos = ? WHERE case_number = ?",
                        (photo_rel_url, photos_json, case_no)
                    )
                    conn.commit()
                    success_count += 1
                    print(f"✅ 사진 확보 완료 ({len(photos)}장, 메인: {photo_rel_url})")
                else:
                    failed_count += 1
                    print("⚠️ 사진 없음 (API에 미등록/미제공)")

            except Exception as e_item:
                failed_count += 1
                print(f"❌ 오류: {e_item}")

            # 예의 있는 요청 딜레이
            await asyncio.sleep(0.4)

        await browser.close()

    conn.close()

    print("\n" + "=" * 50)
    print(f"📊 [테스트 결과 요약]")
    print(f"   • 전체 대상 매물: {total_target}건")
    print(f"   • 실제 사진 확보 성공: {success_count}건 ({round(success_count / total_target * 100, 1)}%)")
    print(f"   • 사진 미제공 / 미확보: {failed_count}건")
    print(f"   • 저장 디렉토리: {PHOTOS_DIR2}")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(fetch_photos_for_feed())
