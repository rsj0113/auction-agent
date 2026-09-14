import sqlite3
from datetime import datetime, timedelta
import argparse

DB_FILE_PATH = "auction_db.sqlite"

def cleanup_old_data(db_path: str, days: int):
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {days}일 이상 업데이트되지 않은 매물 삭제 시작 (기준: {cutoff_date})")

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        
        # 1. 경매 물건 (auction_items) 정리 - 기준: last_updated
        try:
            cursor.execute("SELECT COUNT(*) FROM auction_items WHERE last_updated < ?", (cutoff_date,))
            auction_count = cursor.fetchone()[0]
            if auction_count > 0:
                cursor.execute("DELETE FROM auction_items WHERE last_updated < ?", (cutoff_date,))
                print(f"  - [경매] 기한만료/없어진 물건 {auction_count}건 삭제 완료.")
            else:
                print("  - [경매] 삭제할 오래된 물건이 없습니다.")
        except sqlite3.OperationalError:
            print("  - [경매] auction_items 테이블이 없거나 조회할 수 없습니다.")

        # 2. 네이버 부동산 매물 (naver_listings) 정리 - 기준: scraped_at
        try:
            cursor.execute("SELECT COUNT(*) FROM naver_listings WHERE scraped_at < ?", (cutoff_date,))
            naver_count = cursor.fetchone()[0]
            if naver_count > 0:
                cursor.execute("DELETE FROM naver_listings WHERE scraped_at < ?", (cutoff_date,))
                print(f"  - [네이버부동산] 거래완료/내려간 매물 {naver_count}건 삭제 완료.")
            else:
                print("  - [네이버부동산] 삭제할 오래된 매물이 없습니다.")
        except sqlite3.OperationalError:
            print("  - [네이버부동산] naver_listings 테이블이 없거나 조회할 수 없습니다.")

        conn.commit()
    print("정리 작업 완료.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="오래된 매물 데이터 정리 스크립트")
    parser.add_argument("--db", type=str, default=DB_FILE_PATH, help="SQLite DB 파일 경로")
    parser.add_argument("--days", type=int, default=3, help="며칠 전까지 업데이트가 안 된 매물을 삭제할지 (기본: 3일)")
    args = parser.parse_args()
    
    cleanup_old_data(args.db, args.days)
