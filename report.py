import sqlite3
import json
import argparse
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich import box

DB_FILE = "auction_db.sqlite"
console = Console()

def load_items(limit: int = 50, min_score: int = 0, grade: str = ""):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        q = "SELECT * FROM auction_items WHERE ai_score >= ?"
        params = [min_score]
        if grade:
            q += " AND ai_grade = ?"
            params.append(grade)
        q += " ORDER BY ai_score DESC, last_updated DESC LIMIT ?"
        params.append(limit)
        return conn.execute(q, params).fetchall()

def format_krw(amount: int) -> str:
    if amount >= 100_000_000:
        eok = amount / 100_000_000
        return f"{eok:.1f}억"
    if amount >= 10_000:
        man = amount / 10_000
        return f"{man:.0f}만"
    return f"{amount:,}"

def discount_rate(appraisal: int, min_bid: int) -> str:
    if not appraisal:
        return "-"
    rate = (1 - min_bid / appraisal) * 100
    return f"{rate:.0f}%"

def print_summary_table(items):
    table = Table(
        title="[bold cyan]📊 법원경매 DB 요약[/bold cyan]",
        box=box.SIMPLE_HEAVY,
        show_lines=False,
        expand=True,
        pad_edge=False,
    )
    table.add_column("사건번호", style="bold white", no_wrap=True, min_width=14)
    table.add_column("소재지", style="dim", no_wrap=True, max_width=28, min_width=20)
    table.add_column("감정가", justify="right", style="cyan", no_wrap=True, min_width=7)
    table.add_column("최저가", justify="right", style="yellow", no_wrap=True, min_width=7)
    table.add_column("할인", justify="right", style="magenta", no_wrap=True, min_width=5)
    table.add_column("점수", justify="center", no_wrap=True, min_width=5)
    table.add_column("등급", justify="center", no_wrap=True, min_width=3)
    table.add_column("한줄판정", no_wrap=True, max_width=30, style="dim")
    table.add_column("갱신일", style="dim", no_wrap=True, min_width=10)

    for r in items:
        score = r["ai_score"] or 0
        grade = r["ai_grade"] or "-"
        score_color = "green" if score >= 70 else "yellow" if score >= 40 else "red"
        grade_color = "green" if grade == "A" else "yellow" if grade == "B" else "red"

        loc = (r["location"] or "-")
        verdict = (r["ai_verdict"] or "")
        table.add_row(
            r["case_number"],
            loc[:28] + ("…" if len(loc) > 28 else ""),
            format_krw(r["appraisal"] or 0),
            format_krw(r["min_bid"] or 0),
            discount_rate(r["appraisal"], r["min_bid"]),
            f"[{score_color}]{score}[/{score_color}]",
            f"[{grade_color}]{grade}[/{grade_color}]",
            verdict[:30] + ("…" if len(verdict) > 30 else ""),
            (r["last_updated"] or "")[:10],
        )

    console.print(table)

def print_detail(item):
    report = {}
    try:
        report = json.loads(item["ai_report_json"] or "{}")
    except Exception:
        pass

    score = item["ai_score"] or 0
    grade = item["ai_grade"] or "-"
    score_color = "green" if score >= 70 else "yellow" if score >= 40 else "red"

    header = Text()
    header.append(f"📍 {item['location']}\n", style="bold white")
    header.append(f"💰 감정가: {format_krw(item['appraisal'])}  ", style="dim")
    header.append(f"📉 최저가: {format_krw(item['min_bid'])}  ", style="bold yellow")
    header.append(f"할인율: {discount_rate(item['appraisal'], item['min_bid'])}\n", style="magenta")
    header.append(f"🎯 AI: {score}점 ({grade}등급)\n", style=f"bold {score_color}")
    header.append(f"💡 {item['ai_verdict'] or ''}", style="italic")

    console.print(Panel(header, title=f"[bold cyan]{item['case_number']}[/bold cyan]", border_style="cyan"))

    rows = [
        ("추천 입찰가", item["ai_suggested_bid"] or "-"),
        ("갱신일시", item["last_updated"] or "-"),
        ("유찰횟수", str(item["failed_count"] or 0)),
    ]
    for k, v in rows:
        console.print(f"  [dim]{k}:[/dim] {v}")

    if report.get("analysis_detail"):
        console.print(f"\n[dim]{report['analysis_detail']}[/dim]")
    console.print()

def main():
    parser = argparse.ArgumentParser(description="법원경매 DB 조회")
    parser.add_argument("--limit", type=int, default=20, help="최대 출력 건수")
    parser.add_argument("--score", type=int, default=0, help="최소 AI 점수 필터")
    parser.add_argument("--grade", default="", help="등급 필터 (A/B/C)")
    parser.add_argument("--detail", default="", help="상세 조회할 사건번호")
    args = parser.parse_args()

    if args.detail:
        with sqlite3.connect(DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM auction_items WHERE case_number = ?", (args.detail,)
            ).fetchone()
        if row:
            print_detail(row)
        else:
            console.print(f"[red]사건번호 '{args.detail}'를 찾을 수 없습니다.[/red]")
        return

    items = load_items(args.limit, args.score, args.grade)
    if not items:
        console.print("[yellow]조건에 맞는 물건이 없습니다.[/yellow]")
        return

    print_summary_table(items)
    console.print(f"\n[dim]총 {len(items)}건 | 상세 조회: python report.py --detail <사건번호>[/dim]")

if __name__ == "__main__":
    main()
