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
    quick_filter: Optional[str] = None
):
    """
    Get a list of auction items with filtering and sorting.
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
                   market_match_count, market_match_level, est_monthly_rent, rental_yield
            FROM auction_items 
            WHERE 1=1
        '''
        params = []
        
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
            query += " AND location LIKE ?"
            params.append(f"%{region}%")

        if has_tenant:
            if has_tenant.lower() in ('yes', 'true', '1', 'y'):
                query += " AND ((tenant_registration_date IS NOT NULL AND tenant_registration_date != '') OR (tenant_deposit IS NOT NULL AND tenant_deposit > 0))"
            elif has_tenant.lower() in ('no', 'false', '0', 'n'):
                query += " AND ((tenant_registration_date IS NULL OR tenant_registration_date = '') AND (tenant_deposit IS NULL OR tenant_deposit = 0))"

        if quick_filter:
            if quick_filter == 'safe':
                query += " AND ai_grade IN ('S', 'A', 'B')"
            elif quick_filter == 'half_price':
                query += " AND min_bid * 2 <= appraisal"
            elif quick_filter == 'owner':
                query += " AND ((tenant_registration_date IS NULL OR tenant_registration_date IN ('', '임차인없음', '해당없음')) AND (tenant_deposit IS NULL OR tenant_deposit = 0))"
            elif quick_filter == 'apartment':
                query += " AND (usage LIKE '%아파트%' OR location LIKE '%아파트%') AND usage NOT LIKE '%상가%' AND location NOT LIKE '%상가%'"
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

        # Sorting
        if sort == 'recommend':
            query += " ORDER BY CASE WHEN ai_grade='S' THEN 1 WHEN ai_grade='A' THEN 2 WHEN ai_grade='B' THEN 3 WHEN ai_grade='C' THEN 4 WHEN ai_grade='D' THEN 5 ELSE 6 END ASC, last_updated DESC"
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
        
        conn.close()
        return counts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/auctions/{case_number}")
def get_auction_detail(case_number: str):
    """
    Get full details for a specific auction item, including matching Naver listings.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM auction_items WHERE case_number = ?
        ''', (case_number,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row is None:
            raise HTTPException(status_code=404, detail="Auction not found")
            
        item_data = dict(row)
        
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
            
        return {"data": item_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard/summary")
def get_dashboard_summary():
    """
    Get summary stats for the Today's Briefing dashboard.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) as total FROM auction_items')
        total_items = cursor.fetchone()['total']
        
        cursor.execute("SELECT COUNT(*) as recommended FROM auction_items WHERE ai_grade IN ('A', 'S')")
        recommended_items = cursor.fetchone()['recommended']
        
        conn.close()
        
        return {
            "total_active_auctions": total_items,
            "today_recommended": recommended_items,
            "briefing_text": f"현재 {total_items}건의 경매 물건이 분석되었으며, 그 중 추천할 만한 우량 물건은 {recommended_items}건입니다."
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
        ai_report_json = json.dumps(ai_report, ensure_ascii=False)
        ai_score = ai_report.get("score", 0)
        ai_grade = ai_report.get("grade", "C")
        ai_verdict = ai_report.get("verdict", "")
        ai_suggested_bid = ai_report.get("suggested_bid", "")
        
        cursor.execute('''
            UPDATE auction_items 
            SET ai_score = ?, ai_grade = ?, ai_verdict = ?, ai_suggested_bid = ?, ai_report_json = ?
            WHERE case_number = ?
        ''', (ai_score, ai_grade, ai_verdict, ai_suggested_bid, ai_report_json, case_number))
        
        conn.commit()
        
        # Fetch updated row
        cursor.execute('SELECT * FROM auction_items WHERE case_number = ?', (case_number,))
        updated_row = cursor.fetchone()
        conn.close()
        
        return {"data": dict(updated_row)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
