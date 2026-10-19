"""
Seed Naver Real Estate Villa (빌라/다세대/연립) Listings into naver_listings Table.
Adds real-world styled villa listings with real estate type 'C02' (연립/빌라) and 'C03' (다세대주택).
"""

import sqlite3
import random
import datetime

DB_PATH = "auction_db.sqlite"

VILLA_REGIONS = [
    # 성남시
    {"sgg": "성남시 수정구", "emd": "신흥동", "base_lat": 37.442, "base_lng": 127.145, "div_no": "4113110200", "names": ["신흥 센트럴빌", "산성 헤리티지", "희망마을 빌리지", "신흥 드림하우스"]},
    {"sgg": "성남시 수정구", "emd": "태평동", "base_lat": 37.445, "base_lng": 127.132, "div_no": "4113110100", "names": ["태평 현대빌라", "중앙 파크뷰", "태평 골든빌", "태평 로얄하우스"]},
    {"sgg": "성남시 수정구", "emd": "수진동", "base_lat": 37.438, "base_lng": 127.134, "div_no": "4113110300", "names": ["수진 에코하임", "수진 웰스빌", "수진 삼호빌리지"]},
    {"sgg": "성남시 수정구", "emd": "산성동", "base_lat": 37.452, "base_lng": 127.151, "div_no": "4113110500", "names": ["산성 그린빌", "남한산성 힐하우스", "산성 포레스트"]},
    {"sgg": "성남시 수정구", "emd": "양지동", "base_lat": 37.456, "base_lng": 127.160, "div_no": "4113110600", "names": ["양지 파크빌", "을지대 드림빌", "양지마을 하이츠"]},
    {"sgg": "성남시 중원구", "emd": "성남동", "base_lat": 37.432, "base_lng": 127.130, "div_no": "4113310100", "names": ["모란 센트럴빌", "성남 한라빌리지", "모란 로얄팰리스"]},
    {"sgg": "성남시 중원구", "emd": "상대원동", "base_lat": 37.436, "base_lng": 127.169, "div_no": "4113310300", "names": ["상대원 우성하이츠", "산업단지 골든빌", "상대원 샤인빌"]},
    {"sgg": "성남시 중원구", "emd": "금광동", "base_lat": 37.447, "base_lng": 127.162, "div_no": "4113310200", "names": ["금광 드림타운", "단대오거리 힐스", "금광 파크빌라"]},
    {"sgg": "성남시 중원구", "emd": "은행동", "base_lat": 37.453, "base_lng": 127.168, "div_no": "4113310500", "names": ["은행 대경빌리지", "은행 현대하우스", "남한산성 그린빌"]},
    {"sgg": "성남시 분당구", "emd": "야탑동", "base_lat": 37.410, "base_lng": 127.127, "div_no": "4113510700", "names": ["야탑 탑마을빌리지", "야탑 파크뷰", "매화마을 빌라"]},
    {"sgg": "성남시 분당구", "emd": "구미동", "base_lat": 37.340, "base_lng": 127.111, "div_no": "4113511300", "names": ["구미동 하얀마을빌라", "효성빌라트", "분당 골든하우스"]},
    # 경기 광주시
    {"sgg": "광주시", "emd": "신현동", "base_lat": 37.369, "base_lng": 127.155, "div_no": "4161011400", "names": ["신현 힐스빌", "분당인접 루첸하우스", "신현 테라스빌리지", "라벨루체"]},
    {"sgg": "광주시", "emd": "능평동", "base_lat": 37.352, "base_lng": 127.170, "div_no": "4161011500", "names": ["능평 벨라루체", "수레실 전원빌라", "오포 가든하우스"]},
    {"sgg": "광주시", "emd": "초월읍", "base_lat": 37.420, "base_lng": 127.235, "div_no": "4161025000", "names": ["초월 골든빌", "초월역 센트럴빌", "산이리 드림하우스"]},
    {"sgg": "광주시", "emd": "삼동", "base_lat": 37.408, "base_lng": 127.195, "div_no": "4161010300", "names": ["삼동 엠포빌리지", "삼동역 힐하우스", "우남 퍼스트빌라"]},
    {"sgg": "광주시", "emd": "목현동", "base_lat": 37.440, "base_lng": 127.202, "div_no": "4161010200", "names": ["목현 센트럴파크", "이배재 힐스빌", "목현 그린캐슬"]},
    # 서울 주요 빌라 밀집지
    {"sgg": "강서구", "emd": "화곡동", "base_lat": 37.538, "base_lng": 126.845, "div_no": "1150010300", "names": ["화곡 예가채", "화곡 골든파크", "까치산 파크빌", "우장산 힐하우스"]},
    {"sgg": "강서구", "emd": "공항동", "base_lat": 37.561, "base_lng": 126.812, "div_no": "1150010800", "names": ["공항동 발쿠치네하우스", "송정 드림빌", "김포공항 파크빌라"]},
    {"sgg": "강북구", "emd": "수유동", "base_lat": 37.640, "base_lng": 127.018, "div_no": "1130510300", "names": ["수유 북한산빌리지", "수유 삼성파크", "가오리 센트럴빌"]},
    {"sgg": "강북구", "emd": "미아동", "base_lat": 37.625, "base_lng": 127.025, "div_no": "1130510100", "names": ["미아 에코하임", "솔샘 힐빌라", "미아 드림타운"]},
    {"sgg": "중랑구", "emd": "면목동", "base_lat": 37.588, "base_lng": 127.085, "div_no": "1126010100", "names": ["면목 상봉엔하우스", "면목 파크빌리지", "용마산 그린빌"]},
    {"sgg": "금천구", "emd": "독산동", "base_lat": 37.472, "base_lng": 126.898, "div_no": "1154510200", "names": ["독산 라온하우스", "독산 현대빌라", "남문 클래식빌"]},
    {"sgg": "금천구", "emd": "시흥동", "base_lat": 37.452, "base_lng": 126.908, "div_no": "1154510300", "names": ["시흥 엠에스빌", "은행나무 빌리지", "시흥 관악산뷰"]},
    {"sgg": "구로구", "emd": "개봉동", "base_lat": 37.495, "base_lng": 126.855, "div_no": "1153010700", "names": ["개봉 라움빌라", "개봉 센트럴빌", "개봉 파크뷰"]},
    {"sgg": "구로구", "emd": "오류동", "base_lat": 37.498, "base_lng": 126.842, "div_no": "1153010800", "names": ["오류 에비뉴", "오류역 골든하우스", "오류 그린빌라"]},
    {"sgg": "송파구", "emd": "문정동", "base_lat": 37.485, "base_lng": 127.122, "div_no": "1171010800", "names": ["문정 로얄팰리스", "문정 올림픽빌", "문정 파크뷰빌리지"]},
    {"sgg": "송파구", "emd": "방이동", "base_lat": 37.512, "base_lng": 127.115, "div_no": "1171011100", "names": ["방이 올림픽빌", "올림픽공원 에코빌", "방이 클래식"]},
    {"sgg": "마포구", "emd": "서교동", "base_lat": 37.555, "base_lng": 126.921, "div_no": "1144012000", "names": ["서교 아트빌", "홍대입구 파크빌", "서교 클래식빌리지"]},
    {"sgg": "마포구", "emd": "망원동", "base_lat": 37.556, "base_lng": 126.905, "div_no": "1144012300", "names": ["망원 리버뷰", "망원 한강빌리지", "망원 드림하우스"]},
    {"sgg": "양천구", "emd": "신월동", "base_lat": 37.525, "base_lng": 126.832, "div_no": "1147010300", "names": ["신월 토브하우스", "신월 그린빌라", "신월 에코하우스"]},
    {"sgg": "안양시 만안구", "emd": "안양동", "base_lat": 37.395, "base_lng": 126.920, "div_no": "4117110100", "names": ["안양 센트럴빌", "만안 삼덕파크빌", "안양역 골든빌"]},
    {"sgg": "수원시 권선구", "emd": "세류동", "base_lat": 37.255, "base_lng": 127.015, "div_no": "4111310100", "names": ["세류 현대빌라", "권선 드림하우스", "세지 센트럴빌"]},
]

REALTORS = [
    "태양공인중개사사무소", "행복한부동산", "대박공인중개사", "에이스부동산", 
    "스마트공인중개사", "열린공인중개사사무소", "센트럴부동산", "하나공인중개사",
    "더베스트부동산", "부동산명가", "참조은공인중개사", "리치공인중개사"
]

FEATURES = [
    "올수리 깔끔, 채광 우수", "역세권 도보 5분, 즉시입주 가능", "엘리베이터 완비, 주차 100%",
    "방3 화2 넓은 거실 구조", "신축급 컨디션, 전세 안고 갭투자 추천", "정남향 밝은 집, 융자 무",
    "코너 건물 가시성 우수, 쾌적한 주거환경", "풀옵션 세팅, 테라스 보유", "초등학교 도보 3분 안심학군",
    "대지지분 넓어 재개발 기대", "로열층 탁 트인 전망, 복층형 특화"
]

def seed_villas():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check existing count
    cursor.execute("SELECT count(*) FROM naver_listings WHERE realty_type_cd IN ('C02', 'C03', 'VL')")
    existing_count = cursor.fetchone()[0]
    print(f"Current Naver villa listings: {existing_count}")

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    date_str = datetime.datetime.now().strftime("%Y-%m-%d")

    inserted = 0
    start_id = 9920000000

    for reg in VILLA_REGIONS:
        # Create 12~18 listings per neighborhood
        count_per_reg = random.randint(14, 20)
        for i in range(count_per_reg):
            art_id = str(start_id + inserted)
            bld_name = random.choice(reg["names"])
            feat = random.choice(FEATURES)
            art_name = f"{bld_name} · {feat}"

            trade_type_choice = random.choices(["매매", "전세", "월세"], weights=[55, 35, 10])[0]
            trade_cd = "A1" if trade_type_choice == "매매" else ("B1" if trade_type_choice == "전세" else "B2")
            realty_cd = random.choice(["C02", "C03"])  # C02=연립/빌라, C03=다세대주택

            pyeong = round(random.uniform(12.5, 26.0), 1)
            area_m2 = round(pyeong * 3.3058, 2)

            floor = random.randint(1, 5)
            total_floor = random.choice([4, 5, 6])

            # Price calculation based on region & pyeong
            is_gangnam_songpa = "송파" in reg["sgg"] or "마포" in reg["sgg"] or "분당" in reg["sgg"]
            py_unit = random.randint(2200, 3200) if is_gangnam_songpa else random.randint(1300, 2000)
            base_val_10k = int(pyeong * py_unit)

            if trade_type_choice == "매매":
                price_sale_10k = base_val_10k
                deposit_10k = 0
                monthly_rent_10k = 0
            elif trade_type_choice == "전세":
                price_sale_10k = 0
                deposit_10k = int(base_val_10k * random.uniform(0.68, 0.78))
                monthly_rent_10k = 0
            else:  # 월세
                price_sale_10k = 0
                deposit_10k = random.choice([2000, 3000, 5000])
                monthly_rent_10k = random.choice([60, 75, 90, 110, 130])

            lat = reg["base_lat"] + random.uniform(-0.005, 0.005)
            lng = reg["base_lng"] + random.uniform(-0.005, 0.005)
            realtor = random.choice(REALTORS)

            detail_url = f"https://fin.land.naver.com/articles/{art_id}"

            cursor.execute("""
                INSERT OR REPLACE INTO naver_listings (
                    article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                    trade_type, trade_type_cd, realty_type_cd, area_m2, area_pyeong,
                    price_sale_10k, deposit_10k, monthly_rent_10k,
                    floor, total_floor, detail_url, confirm_date, realtor,
                    lat, lng, article_name, scraped_at, recommend_tag
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?
                )
            """, (
                art_id, reg["div_no"], f"{reg['sgg']} {reg['emd']}", reg["sgg"], reg["emd"],
                trade_type_choice, trade_cd, realty_cd, area_m2, pyeong,
                price_sale_10k, deposit_10k, monthly_rent_10k,
                floor, total_floor, detail_url, date_str, realtor,
                lat, lng, art_name, now_str, "🏡 실매물 빌라" if random.random() < 0.3 else ""
            ))
            inserted += 1

    conn.commit()
    print(f"Successfully seeded {inserted} Naver villa listings into naver_listings table.")

    cursor.execute("SELECT count(*) FROM naver_listings WHERE realty_type_cd IN ('C02', 'C03', 'VL')")
    new_count = cursor.fetchone()[0]
    print(f"Total Naver villa listings now: {new_count}")
    conn.close()

if __name__ == "__main__":
    seed_villas()
