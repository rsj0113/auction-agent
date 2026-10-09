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

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'auction_db.sqlite')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI Auction Agent API"}

@app.get("/api/auctions")
def get_auctions(limit: int = 20, offset: int = 0):
    """
    Get a list of auction items.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Simple fetching
        cursor.execute('''
            SELECT case_number, location, appraisal, min_bid, 
                   failed_count, ai_grade, ai_verdict, status_flag
            FROM auction_items 
            ORDER BY last_updated DESC 
            LIMIT ? OFFSET ?
        ''', (limit, offset))
        
        items = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return {"data": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/auctions/{case_number}")
def get_auction_detail(case_number: str):
    """
    Get full details for a specific auction item.
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
            
        return {"data": dict(row)}
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
