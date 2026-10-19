import sqlite3
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="AI Auction Agent API", version="1.0.0")

# CORS setup for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'auction_db.sqlite')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI Auction Agent API"}

from typing import Optional

@app.get("/api/auctions")
def get_auctions(
    limit: int = 20, 
    offset: int = 0,
    grade: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    sort: Optional[str] = 'recent',
    property_type: Optional[str] = None,
    region: Optional[str] = None,
    has_tenant: Optional[str] = None,
    quick_filter: Optional[str] = None,
    floor_type: Optional[str] = None,
    min_pyeong: Optional[float] = None,
    max_pyeong: Optional[float] = None,
    date_range: Optional[str] = None,
    include_closed: bool = False,
):
    """
    Get a list of auction items with filtering and sorting.
    By default, only active upcoming auctions are returned (expired/closed items excluded).
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = '''
            SELECT case_number, location, usage, appraisal, min_bid, 
                   auction_date, failed_count, ai_grade, ai_verdict, status_flag,
                   tenant_registration_date, tenant_deposit, is_payout_requested, rights_list,
                   remarks, special_rights,
                   market_price, safety_margin, market_discount_pct,
                   market_match_count, market_match_level, est_monthly_rent, rental_yield,
                   last_updated, created_at, ai_model, lat, lng,
                   floor, area_m2, area_pyeong,
                   COALESCE(is_favorite, 0) as is_favorite,
                   COALESCE(recommend_tag, '') as recommend_tag
            FROM auction_items 
            WHERE 1=1
        '''
        params = []

        if not include_closed:
            query += " AND COALESCE(status_flag, '') != 'CLOSED' AND (auction_date IS NULL OR auction_date = '' OR auction_date >= strftime('%Y%m%d', 'now', 'localtime'))"
        
        if grade:
            query += " AND ai_grade = ?"
            params.append(grade.upper())
            
        if min_price is not None:
            query += " AND min_bid >= ?"
            params.append(min_price)
            
        if max_price is not None:
            query += " AND min_bid <= ?"
            params.append(max_price)
            

        if property_type:
            if property_type == 'apartment':
                query += " AND (usage LIKE '%아파트%' OR location LIKE '%아파트%')"
            elif property_type == 'officetel':
                query += " AND (usage LIKE '%오피스텔%' OR location LIKE '%오피스텔%')"
            elif property_type == 'villa':
                query += " AND (usage LIKE '%다세대%' OR usage LIKE '%빌라%' OR location LIKE '%다세대%' OR location LIKE '%빌라%')"
            elif property_type == 'commercial':
                query += " AND (usage LIKE '%상가%' OR usage LIKE '%근린%' OR location LIKE '%상가%' OR location LIKE '%근린%' OR location LIKE '%타워%' OR location LIKE '%지식산업%' OR location LIKE '%프라자%' OR location LIKE '%플라자%' OR location LIKE '%센터%' OR location LIKE '%에이스%')"
            elif property_type == 'land':
                query += " AND (usage LIKE '%임야%' OR usage LIKE '%대지%' OR location LIKE '%임야%' OR location LIKE '%산 %' OR location LIKE '%번지%')"
                
        if region:
            import re as _re
            tokens = [t.strip() for t in _re.split(r"[·,/|\s]+", region) if t.strip() and t.strip() not in ("전체", "서울", "경기")]
            if not tokens:
                tokens = [region.strip()]
            sub_clauses = ["location LIKE ?" for _ in tokens]
            query += " AND (" + " OR ".join(sub_clauses) + ")"
            params.extend([f"%{t}%" for t in tokens])

        if has_tenant:
            if has_tenant.lower() in ('yes', 'true', '1', 'y'):
                query += " AND ((tenant_registration_date IS NOT NULL AND tenant_registration_date != '') OR (tenant_deposit IS NOT NULL AND tenant_deposit > 0))"
            elif has_tenant.lower() in ('no', 'false', '0', 'n'):
                query += " AND ((tenant_registration_date IS NULL OR tenant_registration_date = '') AND (tenant_deposit IS NULL OR tenant_deposit = 0))"

        if quick_filter:
            if quick_filter == 'favorite':
                query += " AND COALESCE(is_favorite, 0) = 1"
            elif quick_filter == 'safe':
                query += " AND ai_grade IN ('S', 'A', 'B')"
            elif quick_filter == 'half_price':
                query += " AND min_bid * 2 <= appraisal"
            elif quick_filter == 'owner':
                query += " AND ((tenant_registration_date IS NULL OR tenant_registration_date IN ('', '임차인없음', '해당없음')) AND (tenant_deposit IS NULL OR tenant_deposit = 0))"
            elif quick_filter == 'apartment':
                query += " AND (usage LIKE '%아파트%' OR location LIKE '%아파트%') AND usage NOT LIKE '%상가%' AND location NOT LIKE '%상가%'"
            elif quick_filter == 'first_floor_shop':
                query += " AND usage = '상가/근린시설' AND floor = 1"
            elif quick_filter == 'small_budget':
                query += " AND min_bid <= 100000000"
            elif quick_filter == 'top_grade':
                query += " AND ai_grade IN ('S', 'A')"
            elif quick_filter == 'special':
                query += " AND special_rights IS NOT NULL AND special_rights != '[]' AND special_rights != ''"
            elif quick_filter == 'clean':
                query += " AND (special_rights IS NULL OR special_rights = '[]' OR special_rights = '')"
            elif quick_filter == 'margin_100m':
                query += " AND safety_margin >= 100000000"
            elif quick_filter == 'market_matched':
                query += " AND market_match_count > 0"
            elif quick_filter == 'golf_b1':
                query += " AND floor < 0 AND area_pyeong >= 30"
            elif quick_filter == 'underground':
                query += " AND floor < 0"

        # 층수 필터 (1층 / 지하1층 / 2층이상)
        if floor_type:
            if floor_type == '1f':
                query += " AND floor = 1"
            elif floor_type == 'b1':
                query += " AND floor < 0"
            elif floor_type == 'upper':
                query += " AND floor >= 2"

        # 평수 필터 (area_pyeong)
        if min_pyeong is not None and min_pyeong > 0:
            query += " AND area_pyeong >= ?"
            params.append(min_pyeong)
        if max_pyeong is not None and max_pyeong > 0:
            query += " AND area_pyeong <= ?"
            params.append(max_pyeong)

        # 등록일자 필터 (date_range: today, 3days, 7days, 30days)
        if date_range:
            if date_range == 'today':
                query += " AND date(created_at) >= date('now', 'localtime')"
            elif date_range == '3days':
                query += " AND date(created_at) >= date('now', 'localtime', '-3 days')"
            elif date_range == '7days':
                query += " AND date(created_at) >= date('now', 'localtime', '-7 days')"
            elif date_range == '30days':
                query += " AND date(created_at) >= date('now', 'localtime', '-30 days')"

        # Sorting
        if sort == 'recommend':
            query += """
                ORDER BY
                    CASE WHEN recommend_tag IS NOT NULL AND recommend_tag != '' THEN 0 ELSE 1 END ASC,
                    CASE WHEN COALESCE(is_favorite, 0) = 1 THEN 0 ELSE 1 END ASC,
                    CASE WHEN ai_grade='S' THEN 1 WHEN ai_grade='A' THEN 2 WHEN ai_grade='B' THEN 3 WHEN ai_grade='C' THEN 4 WHEN ai_grade='D' THEN 5 ELSE 6 END ASC,
                    last_updated DESC
            """
        elif sort == 'margin_desc':
            query += " ORDER BY safety_margin DESC, last_updated DESC"
        elif sort == 'market_discount':
            query += " ORDER BY market_discount_pct DESC, last_updated DESC"
        elif sort == 'yield_desc':
            query += " ORDER BY rental_yield DESC, last_updated DESC"
        elif sort == 'price_asc':
            query += " ORDER BY min_bid ASC"
        elif sort == 'price_desc':
            query += " ORDER BY min_bid DESC"
        elif sort == 'oldest':
            query += " ORDER BY last_updated ASC"
        else: # default recent
            query += " ORDER BY last_updated DESC"
            
        query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        
        items = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        try:
            from core.villa_transactions import get_villa_trade_info
            for it in items:
                v_info = get_villa_trade_info(it)
                if v_info:
                    it["villa_trade_info"] = v_info
        except Exception:
            pass

        return {"data": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/auctions/quick-counts")
def get_quick_filter_counts():
    """
    Get item counts for quick filter chips.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        counts = {}
        
        # total
        cursor.execute("SELECT COUNT(*) FROM auction_items")
        counts["total"] = cursor.fetchone()[0]

        # favorite (관심매물)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE COALESCE(is_favorite, 0) = 1")
        fav_auc = cursor.fetchone()[0]
        try:
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE COALESCE(is_favorite, 0) = 1")
            fav_nav = cursor.fetchone()[0]
        except Exception:
            fav_nav = 0
        counts["favorite"] = fav_auc
        counts["favorite_naver"] = fav_nav
        counts["favorite_total"] = fav_auc + fav_nav
        
        # safe (S, A, B 등급)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE ai_grade IN ('S', 'A', 'B')")
        counts["safe"] = cursor.fetchone()[0]
        
        # half_price (min_bid * 2 <= appraisal)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE min_bid * 2 <= appraisal")
        counts["half_price"] = cursor.fetchone()[0]
        
        # owner (소유자 점유)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE ((tenant_registration_date IS NULL OR tenant_registration_date IN ('', '임차인없음', '해당없음')) AND (tenant_deposit IS NULL OR tenant_deposit = 0))")
        counts["owner"] = cursor.fetchone()[0]
        
        # apartment (아파트)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE (usage LIKE '%아파트%' OR location LIKE '%아파트%') AND usage NOT LIKE '%상가%' AND location NOT LIKE '%상가%'")
        counts["apartment"] = cursor.fetchone()[0]

        # first_floor_shop (1층 상가)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE usage = '상가/근린시설' AND floor = 1")
        counts["first_floor_shop"] = cursor.fetchone()[0]
        
        # small_budget (1억 이하)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE min_bid <= 100000000")
        counts["small_budget"] = cursor.fetchone()[0]
        
        # top_grade (S/A 등급)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE ai_grade IN ('S', 'A')")
        counts["top_grade"] = cursor.fetchone()[0]

        # special (특수권리 태그 매물)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE special_rights IS NOT NULL AND special_rights != '[]' AND special_rights != ''")
        counts["special"] = cursor.fetchone()[0]

        # clean (특수권리 없는 매물)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE special_rights IS NULL OR special_rights = '[]' OR special_rights = ''")
        counts["clean"] = cursor.fetchone()[0]

        # margin_100m (진짜 안전마진 1억+)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE safety_margin >= 100000000")
        counts["margin_100m"] = cursor.fetchone()[0]

        # market_matched (네이버 시세 검증 완료)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE market_match_count > 0")
        counts["market_matched"] = cursor.fetchone()[0]

        # golf_b1 (골프연습장/체육시설용 지하 30평 이상)
        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE floor < 0 AND area_pyeong >= 30")
        counts["golf_b1"] = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE floor < 0")
        counts["auction_b1"] = cursor.fetchone()[0]

        # naver_shops & naver_villas (네이버 실매물 총 건수)
        try:
            cursor.execute("SELECT COUNT(*) FROM naver_listings")
            counts["naver_total"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('C02', 'C03', 'VL')")
            counts["naver_villas"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03')")
            counts["naver_shops"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03') AND floor = 1")
            counts["naver_first_floor"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE floor < 0")
            counts["naver_b1"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE floor < 0 AND area_pyeong >= 30")
            counts["naver_golf_b1"] = cursor.fetchone()[0]
        except Exception:
            counts["naver_total"] = 0
            counts["naver_villas"] = 0
            counts["naver_shops"] = 0
            counts["naver_first_floor"] = 0
            counts["naver_b1"] = 0
            counts["naver_golf_b1"] = 0

        # onbid_items (온비드 공매 상가 건수)
        try:
            cursor.execute("SELECT COUNT(*) FROM onbid_items")
            counts["onbid_total"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE is_first_floor = 1")
            counts["onbid_first_floor"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE floor < 0")
            counts["onbid_b1"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE discount_pct >= 30")
            counts["onbid_discounted"] = cursor.fetchone()[0]
        except Exception:
            counts["onbid_total"] = 0
            counts["onbid_first_floor"] = 0
            counts["onbid_b1"] = 0
            counts["onbid_discounted"] = 0

        counts["b1_total"] = counts.get("auction_b1", 0) + counts.get("naver_b1", 0) + counts.get("onbid_b1", 0)

        # inflow / outflow counts (일일 신규 유입 및 마감/삭제 건수)
        try:
            cursor.execute("SELECT COUNT(*) FROM auction_items WHERE date(created_at) >= date('now', 'localtime')")
            today_new_court = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM auction_items WHERE auction_date = strftime('%Y%m%d', 'now', 'localtime')")
            today_closed_court = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE date(scraped_at) >= date('now', 'localtime')")
            today_new_onbid = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE remain_time LIKE '%마감%' OR bid_end_date LIKE strftime('%Y-%m-%d', 'now', 'localtime') || '%'")
            today_closed_onbid = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE date(scraped_at) >= date('now', 'localtime')")
            today_new_naver = cursor.fetchone()[0]

            counts["inflow_outflow"] = {
                "today_new_court": today_new_court,
                "today_closed_court": today_closed_court,
                "today_new_onbid": today_new_onbid,
                "today_closed_onbid": today_closed_onbid,
                "today_new_naver": today_new_naver,
                "today_new_total": today_new_court + today_new_onbid + today_new_naver,
                "today_closed_total": today_closed_court + today_closed_onbid,
            }
        except Exception:
            counts["inflow_outflow"] = {
                "today_new_court": 0,
                "today_closed_court": 0,
                "today_new_onbid": 0,
                "today_closed_onbid": 0,
                "today_new_naver": 0,
                "today_new_total": 0,
                "today_closed_total": 0,
            }

        # 낙찰 결과 총 건수
        try:
            cursor.execute("SELECT COUNT(*) FROM auction_results")
            counts["results_total"] = cursor.fetchone()[0]
        except Exception:
            counts["results_total"] = 0
        
        conn.close()
        return counts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FavoriteToggleRequest(BaseModel):
    item_type: str  # "auction", "naver", or "onbid"
    item_id: str


@app.post("/api/favorites/toggle")
def toggle_favorite(req: FavoriteToggleRequest):
    """
    Toggle star/favorite status for a court auction item, Naver listing, or OnBid item.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if req.item_type == "naver":
            cursor.execute("SELECT COALESCE(is_favorite, 0) FROM naver_listings WHERE article_id = ?", (req.item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                raise HTTPException(status_code=404, detail="Naver listing not found")
            new_val = 0 if row[0] == 1 else 1
            cursor.execute("UPDATE naver_listings SET is_favorite = ? WHERE article_id = ?", (new_val, req.item_id))
        elif req.item_type == "onbid":
            cursor.execute("SELECT COALESCE(is_favorite, 0) FROM onbid_items WHERE cltr_no = ?", (req.item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                raise HTTPException(status_code=404, detail="OnBid item not found")
            new_val = 0 if row[0] == 1 else 1
            cursor.execute("UPDATE onbid_items SET is_favorite = ? WHERE cltr_no = ?", (new_val, req.item_id))
        else:
            cursor.execute("SELECT COALESCE(is_favorite, 0) FROM auction_items WHERE case_number = ?", (req.item_id,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                raise HTTPException(status_code=404, detail="Auction item not found")
            new_val = 0 if row[0] == 1 else 1
            cursor.execute("UPDATE auction_items SET is_favorite = ? WHERE case_number = ?", (new_val, req.item_id))

        conn.commit()
        conn.close()
        return {"item_type": req.item_type, "item_id": req.item_id, "is_favorite": new_val}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/naver-listings")
def get_naver_listings(
    region: Optional[str] = None,
    trade_type: Optional[str] = None,
    property_type: Optional[str] = None,
    first_floor_only: bool = False,
    floor_type: Optional[str] = None,
    favorite_only: bool = False,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    min_pyeong: Optional[float] = None,
    max_pyeong: Optional[float] = None,
    date_range: Optional[str] = None,
    sort: Optional[str] = "default",
    limit: int = 500,
    offset: int = 0,
):
    """
    Get Naver Real Estate commercial (상가) and villa (빌라/다세대) listings.
    Supports multi-keyword region filtering, favorite filtering, floor filtering, and pyeong range.
    """
    try:
        import re as _re
        conn = get_db_connection()
        cursor = conn.cursor()

        where_clause = " WHERE 1=1"
        params = []

        if property_type:
            if any(k in property_type for k in ("villa", "빌라", "다세대", "연립")):
                where_clause += " AND realty_type_cd IN ('C02', 'C03', 'VL')"
            elif any(k in property_type for k in ("commercial", "상가", "근린")):
                where_clause += " AND realty_type_cd IN ('D02', 'D04', 'D03')"
            elif property_type not in ("all", ""):
                where_clause += " AND realty_type_cd IN ('D02', 'D04', 'D03', 'C02', 'C03', 'VL')"
        else:
            where_clause += " AND realty_type_cd IN ('D02', 'D04', 'D03', 'C02', 'C03', 'VL')"

        if favorite_only:
            where_clause += " AND COALESCE(is_favorite, 0) = 1"

        if region and region.strip():
            raw_reg = region.strip()
            cleaned_reg = raw_reg.replace("전체", "").replace("남부", "").replace("북부", "").strip()
            tokens = [t.strip() for t in _re.split(r"[·,/|()\s]+", cleaned_reg) if len(t.strip()) >= 2]
            if not tokens:
                tokens = [raw_reg]
            token_ors = []
            for t in tokens:
                like = f"%{t}%"
                token_ors.append("(region_name LIKE ? OR addr_sgg LIKE ? OR addr_emd LIKE ? OR article_name LIKE ?)")
                params.extend([like, like, like, like])
            where_clause += " AND (" + " OR ".join(token_ors) + ")"

        if trade_type and trade_type in ("매매", "월세", "전세"):
            where_clause += " AND trade_type = ?"
            params.append(trade_type)

        # 층수 필터 (하위 호환 first_floor_only 포함)
        if floor_type:
            if floor_type == '1f':
                where_clause += " AND floor = 1"
            elif floor_type == 'b1':
                where_clause += " AND floor < 0"
            elif floor_type == 'upper':
                where_clause += " AND floor >= 2"
        elif first_floor_only:
            where_clause += " AND floor = 1"

        # 평수 필터
        if min_pyeong is not None and min_pyeong > 0:
            where_clause += " AND area_pyeong >= ?"
            params.append(min_pyeong)
        if max_pyeong is not None and max_pyeong > 0:
            where_clause += " AND area_pyeong <= ?"
            params.append(max_pyeong)

        if min_price is not None and min_price > 0:
            min_10k = min_price // 10000
            where_clause += " AND ((trade_type = '매매' AND price_sale_10k >= ?) OR (trade_type != '매매' AND (deposit_10k + monthly_rent_10k * 100) >= ?))"
            params.extend([min_10k, min_10k])

        if max_price is not None and max_price > 0:
            max_10k = max_price // 10000
            where_clause += " AND ((trade_type = '매매' AND price_sale_10k > 0 AND price_sale_10k <= ?) OR (trade_type != '매매' AND (deposit_10k + monthly_rent_10k * 100) <= ?))"
            params.extend([max_10k, max_10k])

        # 등록/수집일자 필터 (date_range: today, 3days, 7days, 30days)
        if date_range:
            if date_range == 'today':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime')"
            elif date_range == '3days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-3 days')"
            elif date_range == '7days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-7 days')"
            elif date_range == '30days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-30 days')"

        count_query = "SELECT COUNT(*) FROM naver_listings" + where_clause
        cursor.execute(count_query, params)
        total_matching = cursor.fetchone()[0]

        if sort == "price_asc":
            order_clause = " ORDER BY CASE WHEN trade_type='매매' THEN price_sale_10k ELSE deposit_10k END ASC"
        elif sort == "price_desc":
            order_clause = " ORDER BY CASE WHEN trade_type='매매' THEN price_sale_10k ELSE deposit_10k END DESC"
        elif sort == "area_desc":
            order_clause = " ORDER BY area_pyeong DESC"
        else:
            order_clause = """
                ORDER BY
                    CASE WHEN recommend_tag IS NOT NULL AND recommend_tag != '' THEN 0 ELSE 1 END ASC,
                    CASE WHEN COALESCE(is_favorite, 0) = 1 THEN 0 ELSE 1 END ASC,
                    CASE WHEN realty_type_cd = 'D02' THEN 0 ELSE 1 END ASC,
                    CASE WHEN floor = 1 THEN 0 ELSE 1 END ASC,
                    scraped_at DESC
            """

        query = """
            SELECT article_id, legal_div_no, region_name, addr_sgg, addr_emd,
                   trade_type, trade_type_cd, realty_type_cd, area_m2, area_pyeong,
                   price_sale_10k, deposit_10k, monthly_rent_10k,
                   floor, total_floor, detail_url, confirm_date, realtor,
                   lat, lng, article_name, scraped_at,
                   COALESCE(is_favorite, 0) as is_favorite,
                   COALESCE(recommend_tag, '') as recommend_tag
            FROM naver_listings
        """ + where_clause + order_clause + " LIMIT ? OFFSET ?"

        cursor.execute(query, params + [limit, offset])
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return {"data": rows, "count": len(rows), "total_matching": total_matching}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onbid-items")
def get_onbid_items(
    region: Optional[str] = None,
    disposal_method: Optional[str] = None,
    prpt_div: Optional[str] = None,
    first_floor_only: bool = False,
    floor_type: Optional[str] = None,
    favorite_only: bool = False,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    min_pyeong: Optional[float] = None,
    max_pyeong: Optional[float] = None,
    date_range: Optional[str] = None,
    include_closed: bool = False,
    sort: Optional[str] = "default",
    limit: int = 100,
    offset: int = 0,
):
    """
    Get KAMCO OnBid (온비드 공매) commercial properties.
    Supports filtering by region, disposal method (매각/임대), floor (1F, B1, upper), pyeong range, favorites, and price.
    By default, closed/ended items are excluded.
    """
    try:
        import re as _re
        conn = get_db_connection()
        cursor = conn.cursor()

        where_clause = " WHERE 1=1"
        params = []

        if not include_closed:
            where_clause += " AND COALESCE(bid_status, '') != '마감'"

        if favorite_only:
            where_clause += " AND COALESCE(is_favorite, 0) = 1"

        # 층수 필터 (하위 호환 first_floor_only 포함)
        if floor_type:
            if floor_type == '1f':
                where_clause += " AND (is_first_floor = 1 OR floor = 1)"
            elif floor_type == 'b1':
                where_clause += " AND floor < 0"
            elif floor_type == 'upper':
                where_clause += " AND floor >= 2"
        elif first_floor_only:
            where_clause += " AND (is_first_floor = 1 OR floor = 1)"

        # 평수 필터 (bld_area_pyeong)
        if min_pyeong is not None and min_pyeong > 0:
            where_clause += " AND bld_area_pyeong >= ?"
            params.append(min_pyeong)
        if max_pyeong is not None and max_pyeong > 0:
            where_clause += " AND bld_area_pyeong <= ?"
            params.append(max_pyeong)

        # 등록/수집일자 필터 (date_range: today, 3days, 7days, 30days)
        if date_range:
            if date_range == 'today':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime')"
            elif date_range == '3days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-3 days')"
            elif date_range == '7days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-7 days')"
            elif date_range == '30days':
                where_clause += " AND date(scraped_at) >= date('now', 'localtime', '-30 days')"

        if disposal_method:
            where_clause += " AND disposal_method LIKE ?"
            params.append(f"%{disposal_method}%")

        if prpt_div:
            where_clause += " AND prpt_div LIKE ?"
            params.append(f"%{prpt_div}%")

        if region and region.strip():
            raw_reg = region.strip()
            cleaned_reg = raw_reg.replace("전체", "").replace("남부", "").replace("북부", "").strip()
            tokens = [t.strip() for t in _re.split(r"[·,/|()\s]+", cleaned_reg) if len(t.strip()) >= 2]
            if not tokens:
                tokens = [raw_reg]
            token_ors = []
            for t in tokens:
                like = f"%{t}%"
                token_ors.append("(addr_sido LIKE ? OR addr_sgg LIKE ? OR addr_emd LIKE ? OR addr_full LIKE ? OR cltr_nm LIKE ?)")
                params.extend([like, like, like, like, like])
            where_clause += " AND (" + " OR ".join(token_ors) + ")"

        if min_price is not None and min_price > 0:
            where_clause += " AND min_bid >= ?"
            params.append(min_price)

        if max_price is not None and max_price > 0:
            where_clause += " AND min_bid <= ?"
            params.append(max_price)

        count_query = "SELECT COUNT(*) FROM onbid_items" + where_clause
        cursor.execute(count_query, params)
        total_matching = cursor.fetchone()[0]

        if sort == "price_asc":
            order_clause = " ORDER BY min_bid ASC"
        elif sort == "price_desc":
            order_clause = " ORDER BY min_bid DESC"
        elif sort == "discount_desc":
            order_clause = " ORDER BY discount_pct DESC"
        elif sort == "area_desc":
            order_clause = " ORDER BY bld_area_pyeong DESC"
        else:
            order_clause = """
                ORDER BY
                    CASE WHEN COALESCE(is_favorite, 0) = 1 THEN 0 ELSE 1 END ASC,
                    CASE WHEN is_first_floor = 1 THEN 0 ELSE 1 END ASC,
                    CASE WHEN discount_pct >= 30 THEN 0 ELSE 1 END ASC,
                    discount_pct DESC,
                    scraped_at DESC
            """

        query = """
            SELECT cltr_no, onbid_cltr_no, cltr_nm, addr_sido, addr_sgg, addr_emd, addr_full,
                   prpt_div, disposal_method, usage, appraisal, min_bid, discount_pct,
                   bid_status, remain_time, bid_start_date, bid_end_date,
                   floor, is_first_floor, land_area_m2, bld_area_m2, bld_area_pyeong,
                   reg_org_nm, detail_url,
                   COALESCE(is_favorite, 0) as is_favorite,
                   COALESCE(recommend_tag, '') as recommend_tag,
                   scraped_at
            FROM onbid_items
        """ + where_clause + order_clause + " LIMIT ? OFFSET ?"

        cursor.execute(query, params + [limit, offset])
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return {"data": rows, "count": len(rows), "total_matching": total_matching}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auction-results")
def get_auction_results(
    region: Optional[str] = None,
    usage: Optional[str] = None,
    floor_type: Optional[str] = None,
    source: Optional[str] = None,
    min_pyeong: Optional[float] = None,
    max_pyeong: Optional[float] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    sort: Optional[str] = "recent",
    limit: int = 50,
    offset: int = 0,
):
    """
    Get completed auction results (법원경매 매각결과 & 온비드 개찰결과).
    Displays actual property information, winning bid price, winning rate (%), and number of bidders (경쟁률).
    """
    try:
        import re as _re
        conn = get_db_connection()
        cursor = conn.cursor()

        where_clause = " WHERE 1=1"
        params = []

        if source and source in ("court", "onbid"):
            where_clause += " AND source = ?"
            params.append(source)

        if usage:
            if usage == 'commercial':
                where_clause += " AND (usage LIKE '%상가%' OR usage LIKE '%근린%' OR usage LIKE '%점포%' OR usage LIKE '%판매%')"
            elif usage == 'apartment':
                where_clause += " AND usage LIKE '%아파트%'"
            elif usage == 'villa':
                where_clause += " AND (usage LIKE '%다세대%' OR usage LIKE '%빌라%')"
            elif usage == 'officetel':
                where_clause += " AND usage LIKE '%오피스텔%'"

        if floor_type:
            if floor_type == '1f':
                where_clause += " AND floor = 1"
            elif floor_type == 'b1':
                where_clause += " AND floor < 0"
            elif floor_type == 'upper':
                where_clause += " AND floor >= 2"

        if min_pyeong is not None and min_pyeong > 0:
            where_clause += " AND area_pyeong >= ?"
            params.append(min_pyeong)
        if max_pyeong is not None and max_pyeong > 0:
            where_clause += " AND area_pyeong <= ?"
            params.append(max_pyeong)

        if min_price is not None and min_price > 0:
            where_clause += " AND winning_bid >= ?"
            params.append(min_price)
        if max_price is not None and max_price > 0:
            where_clause += " AND winning_bid <= ?"
            params.append(max_price)

        if region and region.strip():
            raw_reg = region.strip()
            cleaned_reg = raw_reg.replace("전체", "").replace("남부", "").replace("북부", "").strip()
            tokens = [t.strip() for t in _re.split(r"[·,/|()\s]+", cleaned_reg) if len(t.strip()) >= 2]
            if not tokens:
                tokens = [raw_reg]
            token_ors = []
            for t in tokens:
                like = f"%{t}%"
                token_ors.append("(location LIKE ? OR addr_sgg LIKE ? OR addr_emd LIKE ? OR item_name LIKE ?)")
                params.extend([like, like, like, like])
            where_clause += " AND (" + " OR ".join(token_ors) + ")"

        # Aggregated stats
        stats_query = f"""
            SELECT COUNT(*), 
                   COALESCE(ROUND(AVG(winning_rate), 1), 0.0),
                   COALESCE(ROUND(AVG(bidder_count), 1), 0.0),
                   COALESCE(MAX(bidder_count), 0),
                   COALESCE(SUM(winning_bid), 0)
            FROM auction_results {where_clause}
        """
        cursor.execute(stats_query, params)
        st_row = cursor.fetchone()
        total_matching = st_row[0]
        avg_winning_rate = st_row[1]
        avg_bidders = st_row[2]
        max_bidders = st_row[3]
        total_volume = st_row[4]

        # Sorting
        if sort == "bidders_desc":
            order_clause = " ORDER BY bidder_count DESC, winning_bid DESC"
        elif sort == "rate_asc":
            order_clause = " ORDER BY winning_rate ASC"
        elif sort == "rate_desc":
            order_clause = " ORDER BY winning_rate DESC"
        elif sort == "price_desc":
            order_clause = " ORDER BY winning_bid DESC"
        elif sort == "price_asc":
            order_clause = " ORDER BY winning_bid ASC"
        else: # default recent
            order_clause = " ORDER BY result_date DESC, id DESC"

        query = f"""
            SELECT id, source, case_number, item_name, location, addr_sido, addr_sgg, addr_emd,
                   usage, floor, area_pyeong, area_m2, appraisal, min_bid, winning_bid,
                   winning_rate, bidder_count, runner_up_bid, result_date, result_status,
                   court_name, special_notes, rights_list, tenant_registration_date, tenant_deposit,
                   is_payout_requested, ai_grade, ai_score, ai_verdict, ai_suggested_bid,
                   ai_report_json, special_rights, market_price, safety_margin, market_discount_pct,
                   rental_yield, est_monthly_rent, failed_count, lat, lng, disposal_method, prpt_div,
                   reg_org_nm, created_at
            FROM auction_results
            {where_clause}
            {order_clause}
            LIMIT ? OFFSET ?
        """
        cursor.execute(query, params + [limit, offset])
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()

        from core.post_auction_analyzer import analyze_post_auction
        from core.villa_transactions import get_villa_trade_info
        for r in rows:
            try:
                r["post_auction_analysis"] = analyze_post_auction(r)
            except Exception:
                pass
            try:
                v_info = get_villa_trade_info(r)
                if v_info:
                    r["villa_trade_info"] = v_info
            except Exception:
                pass

        return {
            "data": rows,
            "count": len(rows),
            "total_matching": total_matching,
            "stats": {
                "avg_winning_rate": avg_winning_rate,
                "avg_bidders": avg_bidders,
                "max_bidders": max_bidders,
                "total_volume": total_volume,
                "total_count": total_matching,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auctions/{case_number}")
def get_auction_detail(case_number: str):
    """
    Get full details for a specific auction item, including matching Naver listings.
    Supports active auctions as well as auction_results items.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM auction_items WHERE case_number = ?
        ''', (case_number,))
        row = cursor.fetchone()
        
        cursor.execute('''
            SELECT * FROM auction_results WHERE case_number = ?
        ''', (case_number,))
        result_row = cursor.fetchone()
        conn.close()
        
        if row is None and result_row is None:
            raise HTTPException(status_code=404, detail="Auction not found")
            
        item_data = dict(row) if row is not None else dict(result_row)
        if result_row is not None and row is not None:
            for k in ["winning_bid", "winning_rate", "bidder_count", "runner_up_bid", "result_date", "result_status"]:
                if result_row[k] is not None:
                    item_data[k] = result_row[k]
        
        # Attach dynamic Naver market comparison listings
        try:
            from core.market_matcher import MarketMatcher
            matcher = MarketMatcher()
            matched_res = matcher.match_item(item_data)
            item_data["sample_listings"] = matched_res.get("sample_listings", [])
            item_data["senior_deposit_assumed"] = matched_res.get("senior_deposit_assumed", 0)
            item_data["min_market_price"] = matched_res.get("min_market_price", 0)
        except Exception:
            item_data["sample_listings"] = []
            item_data["senior_deposit_assumed"] = 0
            item_data["min_market_price"] = 0

        # Attach villa recent transaction info
        try:
            from core.villa_transactions import get_villa_trade_info
            v_info = get_villa_trade_info(item_data)
            if v_info:
                item_data["villa_trade_info"] = v_info
        except Exception:
            pass

        # Attach AI post-auction analysis if winning_bid exists
        if item_data.get("winning_bid") and item_data["winning_bid"] > 0:
            try:
                from core.post_auction_analyzer import analyze_post_auction
                item_data["post_auction_analysis"] = analyze_post_auction(item_data)
            except Exception:
                pass
            
        return {"data": item_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard/summary")
def get_dashboard_summary():
    """
    Get summary stats, data coverage breakdown, and latest update timestamps for the Home dashboard.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) as total FROM auction_items')
        total_items = cursor.fetchone()['total']
        
        cursor.execute("SELECT COUNT(*) as recommended FROM auction_items WHERE ai_grade IN ('A', 'S')")
        recommended_items = cursor.fetchone()['recommended']

        cursor.execute("SELECT MAX(last_updated) FROM auction_items")
        auction_last_updated = cursor.fetchone()[0] or "-"

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE location LIKE '%서울%'")
        auc_seoul = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE location LIKE '%성남%'")
        auc_seongnam = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE location LIKE '%하남%' OR location LIKE '%광주시%' OR location LIKE '%이천%' OR location LIKE '%여주%'")
        auc_seongnam_court_etc = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE usage = '상가/근린시설'")
        auc_commercial = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE usage = '상가/근린시설' AND floor = 1")
        auc_first_floor = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM auction_items WHERE market_match_count > 0")
        auc_matched = cursor.fetchone()[0]

        # 네이버 상가 통계
        cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03')")
        naver_total = cursor.fetchone()[0]

        cursor.execute("SELECT MAX(scraped_at) FROM naver_listings")
        naver_last_updated = cursor.fetchone()[0] or "-"

        cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03') AND floor = 1")
        naver_1f = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03') AND (region_name LIKE '%성남%' OR addr_sgg LIKE '%성남%')")
        naver_seongnam = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE realty_type_cd IN ('D02', 'D04', 'D03') AND (region_name LIKE '%서울%' OR addr_sgg LIKE '%강남%' OR addr_sgg LIKE '%서초%' OR addr_sgg LIKE '%송파%' OR addr_sgg LIKE '%마포%')")
        naver_seoul = cursor.fetchone()[0]

        naver_gyeonggi_etc = max(0, naver_total - naver_seongnam - naver_seoul)
        auc_gyeonggi_etc = max(0, total_items - auc_seoul - auc_seongnam - auc_seongnam_court_etc)

        # 온비드 공매 통계
        try:
            cursor.execute("SELECT COUNT(*) FROM onbid_items")
            onbid_total = cursor.fetchone()[0]
            cursor.execute("SELECT MAX(scraped_at) FROM onbid_items")
            onbid_last_updated = cursor.fetchone()[0] or "-"
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE is_first_floor = 1")
            onbid_1f = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE discount_pct >= 30")
            onbid_discounted = cursor.fetchone()[0]
        except Exception:
            onbid_total = 0
            onbid_last_updated = "-"
            onbid_1f = 0
            onbid_discounted = 0
        
        # 일일 신규 유입 및 마감/삭제 집계
        try:
            cursor.execute("SELECT COUNT(*) FROM auction_items WHERE date(created_at) >= date('now', 'localtime')")
            today_new_court = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM auction_items WHERE auction_date = strftime('%Y%m%d', 'now', 'localtime')")
            today_closed_court = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE date(scraped_at) >= date('now', 'localtime')")
            today_new_onbid = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM onbid_items WHERE remain_time LIKE '%마감%' OR bid_end_date LIKE strftime('%Y-%m-%d', 'now', 'localtime') || '%'")
            today_closed_onbid = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE date(scraped_at) >= date('now', 'localtime')")
            today_new_naver = cursor.fetchone()[0]

            inflow_outflow = {
                "today_new_court": today_new_court,
                "today_closed_court": today_closed_court,
                "today_new_onbid": today_new_onbid,
                "today_closed_onbid": today_closed_onbid,
                "today_new_naver": today_new_naver,
                "today_new_total": today_new_court + today_new_onbid + today_new_naver,
                "today_closed_total": today_closed_court + today_closed_onbid,
            }
        except Exception:
            inflow_outflow = {
                "today_new_court": 0,
                "today_closed_court": 0,
                "today_new_onbid": 0,
                "today_closed_onbid": 0,
                "today_new_naver": 0,
                "today_new_total": 0,
                "today_closed_total": 0,
            }

        # 낙찰 결과 통계 집계
        try:
            cursor.execute("SELECT COUNT(*), COALESCE(ROUND(AVG(winning_rate), 1), 0.0), COALESCE(ROUND(AVG(bidder_count), 1), 0.0) FROM auction_results")
            r_st = cursor.fetchone()
            res_total = r_st[0]
            res_avg_rate = r_st[1]
            res_avg_bidders = r_st[2]
        except Exception:
            res_total = 0
            res_avg_rate = 0.0
            res_avg_bidders = 0.0

        conn.close()
        
        return {
            "total_active_auctions": total_items,
            "today_recommended": recommended_items,
            "briefing_text": f"현재 수도권 법원 경매 {total_items:,}건, 온비드 공매 {onbid_total:,}건, 네이버 상가 실매물 {naver_total:,}건이 실시간 연동되어 입찰가 대비 시세·안전마진 비교가 가능합니다.",
            "auction_last_updated": auction_last_updated,
            "naver_last_updated": naver_last_updated,
            "onbid_last_updated": onbid_last_updated,
            "schedule_text": "매일 새벽 03:00 자동 수집·갱신 (Gemini AI 권리분석 + 온비드 공매 + 네이버 상가 실매물 매칭)",
            "inflow_outflow": inflow_outflow,
            "auction_coverage": {
                "total": total_items,
                "seoul": auc_seoul,
                "seongnam": auc_seongnam,
                "seongnam_court_total": auc_seongnam + auc_seongnam_court_etc,
                "gyeonggi_etc": auc_gyeonggi_etc,
                "commercial": auc_commercial,
                "first_floor_shop": auc_first_floor,
                "market_matched": auc_matched,
            },
            "naver_coverage": {
                "total": naver_total,
                "first_floor": naver_1f,
                "seongnam": naver_seongnam,
                "seoul": naver_seoul,
                "gyeonggi_etc": naver_gyeonggi_etc,
            },
            "onbid_coverage": {
                "total": onbid_total,
                "first_floor": onbid_1f,
                "discounted_30": onbid_discounted,
            },
            "results_coverage": {
                "total": res_total,
                "avg_winning_rate": res_avg_rate,
                "avg_bidders": res_avg_bidders,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Run locally using: uvicorn backend.main:app --reload

from .ai_analyzer import analyze_auction_data
import json

@app.post("/api/auctions/{case_number}/analyze")
def analyze_auction_on_demand(case_number: str):
    """
    On-demand AI analysis for a specific auction item.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM auction_items WHERE case_number = ?', (case_number,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Auction not found")
            
        item_dict = dict(row)
        
        # Call GPT
        ai_report = analyze_auction_data(item_dict)
        
        if "error" in ai_report:
            conn.close()
            raise HTTPException(status_code=500, detail=ai_report["error"])
            
        # Update DB
        from datetime import datetime
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        ai_report_json = json.dumps(ai_report, ensure_ascii=False)
        ai_score = ai_report.get("score", 0)
        ai_grade = ai_report.get("grade", "C")
        ai_verdict = ai_report.get("verdict", "")
        ai_suggested_bid = ai_report.get("suggested_bid", "")
        ai_model = ai_report.get("ai_model", "gpt-4o-mini")
        
        cursor.execute('''
            UPDATE auction_items 
            SET ai_score = ?, ai_grade = ?, ai_verdict = ?, ai_suggested_bid = ?, ai_report_json = ?,
                last_updated = ?, ai_model = ?
            WHERE case_number = ?
        ''', (ai_score, ai_grade, ai_verdict, ai_suggested_bid, ai_report_json, now_str, ai_model, case_number))
        
        conn.commit()
        
        # Fetch updated row
        cursor.execute('SELECT * FROM auction_items WHERE case_number = ?', (case_number,))
        updated_row = cursor.fetchone()
        conn.close()
        
        return {"data": dict(updated_row)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
