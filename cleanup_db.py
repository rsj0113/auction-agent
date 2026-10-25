import sqlite3
from datetime import datetime, timedelta
import argparse

DB_FILE_PATH = "auction_db.sqlite"

def cleanup_old_data(db_path: str, days: int):
    today_str = datetime.now().strftime('%Y%m%d')
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
    past_auction_cutoff = (datetime.now() - timedelta(days=max(days, 30))).strftime('%Y%m%d')
    
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 오래된 매물 안전 정리 시작 (업데이트 기준: {cutoff_date}, 매각기일 경과 기준: {past_auction_cutoff})")

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        
        # 1. 경매 물건 (auction_items) 안전 정리
        # 절대 보존: 관심 매물(is_favorite = 1), 매각기일이 오늘 이후(auction_date >= today_str)
        # 삭제 대상: (매각기일이 30일 이상 지난 과거 OR auction_date 없음) AND last_updated < cutoff AND is_favorite != 1
        try:
            query_count = """
                SELECT COUNT(*) FROM auction_items 
                WHERE COALESCE(is_favorite, 0) != 1
                  AND (auction_date IS NULL OR auction_date = '' OR auction_date < ?)
                  AND last_updated < ?
            """
            cursor.execute(query_count, (past_auction_cutoff, cutoff_date))
            auction_count = cursor.fetchone()[0]
            if auction_count > 0:
                query_delete = """
                    DELETE FROM auction_items 
                    WHERE COALESCE(is_favorite, 0) != 1
                      AND (auction_date IS NULL OR auction_date = '' OR auction_date < ?)
                      AND last_updated < ?
                """
                cursor.execute(query_delete, (past_auction_cutoff, cutoff_date))
                print(f"  - [경매] 매각기일 경과 및 종결 물건 {auction_count}건 안전 정리 완료 (활성 매물 및 관심 매물 보호됨).")
            else:
                print("  - [경매] 삭제할 만료 매물이 없습니다. (모든 활성 매물 정상 유지)")
        except sqlite3.OperationalError as e:
            print(f"  - [경매] auction_items 처리 중 오류: {e}")

        # 2. 네이버 부동산 매물 (naver_listings) 정리
        # 관심 매물(is_favorite = 1)은 영구 보존
        try:
            cursor.execute("""
                SELECT COUNT(*) FROM naver_listings 
                WHERE COALESCE(is_favorite, 0) != 1 
                  AND scraped_at < ?
            """, (cutoff_date,))
            naver_count = cursor.fetchone()[0]
            if naver_count > 0:
                cursor.execute("""
                    DELETE FROM naver_listings 
                    WHERE COALESCE(is_favorite, 0) != 1 
                      AND scraped_at < ?
                """, (cutoff_date,))
                print(f"  - [네이버부동산] 오래된 매물 {naver_count}건 정리 완료.")
            else:
                print("  - [네이버부동산] 삭제할 오래된 매물이 없습니다.")
        except sqlite3.OperationalError as e:
            print(f"  - [네이버부동산] naver_listings 처리 중 오류: {e}")

        conn.commit()
    print("정리 작업 완료.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="오래된 매물 데이터 안전 정리 스크립트")
    parser.add_argument("--db", type=str, default=DB_FILE_PATH, help="SQLite DB 파일 경로")
    parser.add_argument("--days", type=int, default=30, help="며칠 전까지 업데이트가 안 된 매물을 정리할지 (기본: 30일)")
    args = parser.parse_args()
    
    cleanup_old_data(args.db, args.days)

