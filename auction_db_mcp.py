#!/usr/bin/env python3
"""경매 DB 조회 MCP Server — auction_agent"""

import json
import sys
import sqlite3
from pathlib import Path

DB_PATH = Path("/Users/seonjin/vscode_project/auction_agent/auction_db.sqlite")

TOOLS = [
    {
        "name": "get_summary",
        "description": "등급별 매물 수, 평균/최저/최고 최저가 등 DB 전체 현황을 요약합니다.",
        "inputSchema": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "search_items",
        "description": "조건별 매물을 검색합니다. 등급, 지역 키워드, 가격 범위, 최대 결과 수를 지정할 수 있습니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "grade": {"type": "string", "description": "AI 등급 필터 (A, B, C, D)"},
                "region": {"type": "string", "description": "지역 키워드 (예: 서울, 구리, 인천)"},
                "min_price": {"type": "integer", "description": "최저가 하한 (원)"},
                "max_price": {"type": "integer", "description": "최저가 상한 (원)"},
                "min_failed": {"type": "integer", "description": "최소 유찰 횟수"},
                "sort_by": {"type": "string", "description": "정렬 기준: discount(할인율), price(최저가), score(AI점수), failed(유찰횟수)"},
                "limit": {"type": "integer", "description": "최대 결과 수 (기본 10)"}
            },
            "required": []
        }
    },
    {
        "name": "get_item",
        "description": "사건번호로 특정 매물의 상세 정보를 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "case_number": {"type": "string", "description": "사건번호 (예: 2023타경1842)"}
            },
            "required": ["case_number"]
        }
    },
    {
        "name": "get_top_discounts",
        "description": "할인율이 높은 A등급 매물을 상위 N개 반환합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "결과 수 (기본 5)"},
                "grade": {"type": "string", "description": "등급 필터 (기본 A)"}
            },
            "required": []
        }
    },
    {
        "name": "get_recent",
        "description": "최근 업데이트된 매물 또는 신규/유찰 변동 매물을 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "상태 필터: NEW, UPDATED, UNCHANGED (미지정 시 전체)"},
                "limit": {"type": "integer", "description": "결과 수 (기본 10)"}
            },
            "required": []
        }
    }
]


def query(sql: str, params: tuple = ()) -> list:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def fmt_money(v):
    if not v:
        return "정보없음"
    return f"{int(v):,}원"


def fmt_item(row: dict, detail: bool = False) -> str:
    appraisal = row.get("appraisal", 0) or 0
    min_bid = row.get("min_bid", 0) or 0
    discount = f"{((appraisal - min_bid) / appraisal * 100):.1f}%" if appraisal > 0 else "-"
    lines = [
        f"[{row.get('case_number')}] {row.get('location', '')}",
        f"  등급: {row.get('ai_grade')} ({row.get('ai_score')}점) | 유찰: {row.get('failed_count')}회 | 상태: {row.get('status_flag')}",
        f"  감정가: {fmt_money(appraisal)} | 최저가: {fmt_money(min_bid)} | 할인율: {discount}",
        f"  추천입찰: {row.get('ai_suggested_bid', '정보없음')}",
        f"  판정: {row.get('ai_verdict', '')}",
    ]
    if detail:
        report = json.loads(row.get("ai_report_json") or "{}")
        lines += [
            f"  예상수익률: {report.get('expected_yield', '-')}",
            f"  매수신호: {'✅ BUY' if report.get('buy_signal') else '❌ PASS'}",
            f"  핵심리스크: {', '.join(report.get('risks', []))}",
            f"  투자포인트: {', '.join(report.get('key_points', []))}",
            f"  분석: {report.get('analysis_detail', '')}",
        ]
    return "\n".join(lines)


def handle_tool(name: str, args: dict) -> str:
    if name == "get_summary":
        rows = query("""
            SELECT ai_grade, COUNT(*) as cnt,
                   AVG(CASE WHEN min_bid > 1000000 THEN min_bid END) as avg_bid,
                   MIN(CASE WHEN min_bid > 1000000 THEN min_bid END) as min_bid,
                   MAX(CASE WHEN min_bid > 1000000 THEN min_bid END) as max_bid
            FROM auction_items GROUP BY ai_grade ORDER BY ai_grade
        """)
        total = query("SELECT COUNT(*) as cnt FROM auction_items")[0]["cnt"]
        lines = [f"=== 경매 DB 현황 (총 {total}건) ==="]
        for r in rows:
            lines.append(
                f"[{r['ai_grade']}등급] {r['cnt']}건 | "
                f"평균최저가: {fmt_money(r['avg_bid'])} | "
                f"최소: {fmt_money(r['min_bid'])} | 최대: {fmt_money(r['max_bid'])}"
            )
        updated = query("SELECT COUNT(*) as cnt FROM auction_items WHERE status_flag='UPDATED'")[0]["cnt"]
        new = query("SELECT COUNT(*) as cnt FROM auction_items WHERE status_flag='NEW'")[0]["cnt"]
        lines.append(f"\n신규: {new}건 | 유찰변동: {updated}건")
        return "\n".join(lines)

    elif name == "search_items":
        conditions = ["min_bid > 1000000"]
        params = []

        grade = args.get("grade")
        if grade:
            conditions.append("ai_grade = ?")
            params.append(grade.upper())

        region = args.get("region")
        if region:
            conditions.append("location LIKE ?")
            params.append(f"%{region}%")

        min_price = args.get("min_price")
        if min_price:
            conditions.append("min_bid >= ?")
            params.append(int(min_price))

        max_price = args.get("max_price")
        if max_price:
            conditions.append("min_bid <= ?")
            params.append(int(max_price))

        min_failed = args.get("min_failed")
        if min_failed:
            conditions.append("failed_count >= ?")
            params.append(int(min_failed))

        sort_map = {
            "discount": "(appraisal - min_bid) * 1.0 / NULLIF(appraisal, 0) DESC",
            "price": "min_bid ASC",
            "score": "ai_score DESC",
            "failed": "failed_count DESC",
        }
        order = sort_map.get(args.get("sort_by", "discount"), sort_map["discount"])
        limit = int(args.get("limit", 10))

        where = " AND ".join(conditions)
        rows = query(f"SELECT * FROM auction_items WHERE {where} ORDER BY {order} LIMIT ?", tuple(params) + (limit,))

        if not rows:
            return "조건에 맞는 매물이 없습니다."
        return f"=== 검색 결과 {len(rows)}건 ===\n\n" + "\n\n".join(fmt_item(r) for r in rows)

    elif name == "get_item":
        case_number = args.get("case_number", "")
        rows = query("SELECT * FROM auction_items WHERE case_number LIKE ?", (f"%{case_number}%",))
        if not rows:
            return f"'{case_number}' 매물을 찾을 수 없습니다."
        return fmt_item(rows[0], detail=True)

    elif name == "get_top_discounts":
        limit = int(args.get("limit", 5))
        grade = args.get("grade", "A").upper()
        rows = query("""
            SELECT * FROM auction_items
            WHERE ai_grade = ? AND min_bid > 1000000 AND appraisal > 0
            ORDER BY (appraisal - min_bid) * 1.0 / appraisal DESC
            LIMIT ?
        """, (grade, limit))
        if not rows:
            return "해당 등급 매물이 없습니다."
        return f"=== {grade}등급 할인율 Top {limit} ===\n\n" + "\n\n".join(fmt_item(r) for r in rows)

    elif name == "get_recent":
        status = args.get("status")
        limit = int(args.get("limit", 10))
        if status:
            rows = query("SELECT * FROM auction_items WHERE status_flag = ? ORDER BY last_updated DESC LIMIT ?", (status.upper(), limit))
        else:
            rows = query("SELECT * FROM auction_items ORDER BY last_updated DESC LIMIT ?", (limit,))
        if not rows:
            return "매물이 없습니다."
        return f"=== 최근 업데이트 {len(rows)}건 ===\n\n" + "\n\n".join(fmt_item(r) for r in rows)

    return f"알 수 없는 도구: {name}"


def send(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = req.get("method", "")
        req_id = req.get("id")

        if method == "initialize":
            send({
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "auction-db-mcp", "version": "1.0.0"}
                }
            })

        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})

        elif method == "tools/call":
            params = req.get("params", {})
            try:
                result = handle_tool(params.get("name", ""), params.get("arguments", {}))
                send({
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {"content": [{"type": "text", "text": result}]}
                })
            except Exception as e:
                send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}})

        elif method == "notifications/initialized":
            pass

        elif req_id is not None:
            send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}})


if __name__ == "__main__":
    main()
