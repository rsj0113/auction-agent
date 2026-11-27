#!/usr/bin/env python3
"""
fetch_streetview_photos.py

DB에서 photo_url이 비어 있고 lat, lng가 있는 매물에 한해
Google Street View Static API를 호출하여 이미지 파일로 직접 다운로드하고,
frontend/public/photos/{사건번호}_sv.jpg 및 attachments/photos/{사건번호}_sv.jpg 로 저장한다.
DB의 photo_url 및 photos 에는 https://frontend-nine-gules-14.vercel.app/photos/{사건번호}_sv.jpg 만 저장한다.

보안 규칙:
- GOOGLE_STREETVIEW_API_KEY 는 로컬 .env 에서만 읽어오며, 코드나 로그에 키 문자열을 절대 노출하지 않는다.
- Google Street View 원본 API URL(키 포함)을 DB나 피드 JSON에 저장하지 않는다.
"""

import os
import re
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
DB_PATH = os.path.join(BASE_DIR, "auction_db.sqlite")
FEED_PATH = os.path.join(BASE_DIR, "mobile_feed.json")
PHOTOS_DIR1 = os.path.join(BASE_DIR, "attachments", "photos")
PHOTOS_DIR2 = os.path.join(BASE_DIR, "frontend", "public", "photos")

os.makedirs(PHOTOS_DIR1, exist_ok=True)
os.makedirs(PHOTOS_DIR2, exist_ok=True)

def load_streetview_api_key() -> str:
    """로컬 .env 파일에서 GOOGLE_STREETVIEW_API_KEY 추출"""
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GOOGLE_STREETVIEW_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GOOGLE_STREETVIEW_API_KEY", "").strip()

def check_streetview_metadata(lat: float, lng: float, api_key: str) -> bool:
    """Street View 메타데이터 API를 호출하여 해당 좌표에 실제 거리뷰 이미지가 존재하는지 확인"""
    meta_url = (
        f"https://maps.googleapis.com/maps/api/streetview/metadata"
        f"?location={lat},{lng}&key={api_key}"
    )
    try:
        req = urllib.request.Request(meta_url, headers={"User-Agent": "EasyAuction/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("status") == "OK"
    except Exception as e:
        print(f"    ⚠️ 메타데이터 확인 오류: {e}")
        return False

def download_streetview_image(lat: float, lng: float, api_key: str, dest_paths: list[str]) -> bool:
    """Street View Static API에서 이미지를 다운로드하여 로컬 파일에 저장"""
    img_url = (
        f"https://maps.googleapis.com/maps/api/streetview"
        f"?size=800x600&location={lat},{lng}&key={api_key}"
    )
    try:
        req = urllib.request.Request(img_url, headers={"User-Agent": "EasyAuction/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            img_bytes = resp.read()
            if len(img_bytes) < 1000:
                return False
            for p in dest_paths:
                with open(p, "wb") as f_out:
                    f_out.write(img_bytes)
            return True
    except Exception as e:
        print(f"    ⚠️ 이미지 다운로드 실패: {e}")
        return False

def main():
    api_key = load_streetview_api_key()
    if not api_key:
        print("❌ 오류: GOOGLE_STREETVIEW_API_KEY 가 .env 에 설정되어 있지 않습니다.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 활성 피드 매물 목록 읽기
    target_cases = []
    if os.path.exists(FEED_PATH):
        with open(FEED_PATH, "r", encoding="utf-8") as f:
            feed_data = json.load(f)
            target_cases = [item["case_number"] for item in feed_data.get("items", [])]

    if not target_cases:
        cursor.execute("SELECT case_number FROM auction_items")
        target_cases = [r[0] for r in cursor.fetchall()]

    print(f"🎯 전체 활성 피드 매물: 총 {len(target_cases)}건")

    # 대상 중 photo_url 이 비어있거나 _sv.jpg 가 아닌 법원 사진이 없는 건 필터링
    placeholders = ",".join(["?"] * len(target_cases))
    cursor.execute(
        f"SELECT case_number, photo_url, lat, lng, location FROM auction_items WHERE case_number IN ({placeholders})",
        target_cases
    )
    rows = cursor.fetchall()

    court_photo_count = 0
    sv_target_items = []

    for r in rows:
        cs, p_url, lat, lng, loc = r
        if p_url and not p_url.endswith("_sv.jpg"):
            court_photo_count += 1
        else:
            if lat and lng:
                sv_target_items.append({"case_number": cs, "lat": lat, "lng": lng, "location": loc})

    print(f"   • 법원 공식 감정평가서 사진 보유: {court_photo_count}건")
    print(f"   • 구글 거리뷰 수집 대상: {len(sv_target_items)}건 (좌표 보유)")

    sv_success_count = 0
    sv_skipped_count = 0

    for idx, item in enumerate(sv_target_items, 1):
        cs = item["case_number"]
        lat = item["lat"]
        lng = item["lng"]
        loc = item["location"]
        print(f"[{idx}/{len(sv_target_items)}] 사건번호 {cs} ({loc}) (좌표: {lat:.5f}, {lng:.5f}) ... ", end="", flush=True)

        # 1. 메타데이터 사전 검증 (Street View 이미지 존재 여부)
        has_sv = check_streetview_metadata(lat, lng, api_key)
        if not has_sv:
            print("⚠️ 거리뷰 없음 (metadata status != OK, 건너뜀)")
            sv_skipped_count += 1
            continue

        # 2. 이미지 다운로드 및 저장
        clean_cs = re.sub(r'[^0-9a-zA-Z가-힣]', '_', cs)
        filename = f"{clean_cs}_sv.jpg"
        path1 = os.path.join(PHOTOS_DIR1, filename)
        path2 = os.path.join(PHOTOS_DIR2, filename)

        downloaded = download_streetview_image(lat, lng, api_key, [path1, path2])
        if downloaded:
            public_url = f"https://frontend-nine-gules-14.vercel.app/photos/{filename}"
            photos_json = json.dumps([public_url], ensure_ascii=False)
            cursor.execute(
                "UPDATE auction_items SET photo_url = ?, photos = ? WHERE case_number = ?",
                (public_url, photos_json, cs)
            )
            conn.commit()
            sv_success_count += 1
            print(f"✅ 거리뷰 확보 완료 ({filename})")
        else:
            print("❌ 다운로드 실패")
            sv_skipped_count += 1

    conn.close()

    total_count = len(target_cases)
    unsecured_count = total_count - court_photo_count - sv_success_count

    print("\n" + "=" * 50)
    print("📊 [사진 확보 최종 통계]")
    print(f"   • 총 대상 매물: {total_count}건")
    print(f"   • 🏛️ 대법원 감정평가서 사진: {court_photo_count}건 ({round(court_photo_count / total_count * 100, 1)}%)")
    print(f"   • 🌐 Google Street View 거리뷰: {sv_success_count}건 ({round(sv_success_count / total_count * 100, 1)}%)")
    print(f"   • ⚠️ 미확보(스톡 대체): {unsecured_count}건 ({round(unsecured_count / total_count * 100, 1)}%)")
    print("=" * 50)

if __name__ == "__main__":
    main()
