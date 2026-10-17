import asyncio
import json
import os
import random
import re
import argparse
import sqlite3
from datetime import datetime
from typing import Optional, List, Dict, Tuple

from dotenv import load_dotenv
load_dotenv()

from core.logging_system import ErrorCategory, log_error_event, get_logger, _classify_exception

_logger = get_logger()
from core.special_rights import extract_special_rights

from playwright.async_api import async_playwright, Page, Frame
from openai import OpenAI
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.columns import Columns
from rich.text import Text
from rich import print as rprint

# --- Configurations ---
COURT_AUCTION_MAIN_URL = "https://www.courtauction.go.kr"
OPENAI_MODEL = "gpt-4o-mini"  # 최저가 고성능 경량 모델 (gpt-4o 대비 95% 이상 비용/토큰 절감)
DB_FILE_PATH = "auction_db.sqlite"

# 법원경매 사이트 용도별 코드 (상가/오피스텔 등). 빈 문자열이면 전체 용도.
BUILDING_TYPE_CODE = ""  # 0205: 오피스텔, 0203: 상가, "": 전체 용도

# 지역별 법원 목록 {법원명: B-코드}
SEOUL_COURTS = {
    "서울중앙지방법원": "B000210",
    "서울동부지방법원": "B000220",
    "서울남부지방법원": "B000230",
    "서울북부지방법원": "B000240",
    "서울서부지방법원": "B000250",
}
GYEONGGI_COURTS = {
    "수원지방법원": "",
    "성남지원": "",
    "여주지원": "",
    "평택지원": "",
    "안산지원": "",
    "안양지원": "",
    "의정부지방법원": "",
    "고양지원": "",
    "남양주지원": "",
}

console = Console()

# --- Module 0: Persistent DB Agent Layer (SQLite) ---
class AuctionDBAgent:
    """
    수집된 경매 정보를 데이터베이스에 영속화하고, 
    기존 데이터와의 차이점(유찰, 변경 등 가격 변동)을 감지하는 에이전트 데이터 레이어
    """
    def __init__(self, db_path: str = DB_FILE_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS auction_items (
                    case_number TEXT PRIMARY KEY,
                    location TEXT,
                    appraisal INTEGER,
                    min_bid INTEGER,
                    prev_min_bid INTEGER,
                    failed_count INTEGER,
                    rights_list TEXT,
                    tenant_registration_date TEXT,
                    tenant_deposit INTEGER,
                    is_payout_requested INTEGER,
                    ai_score INTEGER,
                    ai_grade TEXT,
                    ai_verdict TEXT,
                    ai_suggested_bid TEXT,
                    ai_report_json TEXT,
                    last_updated TEXT,
                    status_flag TEXT DEFAULT 'NEW'
                )
            """)
            # 기존 DB 호환성: 신규 컬럼 추가 (이미 있으면 무시)
            for col_def in [
                "area_m2 REAL",
                "legal_div_no TEXT",
                "addr_sgg TEXT",
                "addr_emd TEXT",
                "floor INTEGER",
                "area_pyeong REAL",
                "usage TEXT",
                "auction_date TEXT",
                "remarks TEXT",
                "special_rights TEXT",
                "created_at TEXT",
                "ai_model TEXT",
            ]:
                try:
                    cursor.execute(f"ALTER TABLE auction_items ADD COLUMN {col_def}")
                except sqlite3.OperationalError:
                    pass
            conn.commit()

    def get_existing_item(self, case_number: str) -> Optional[Dict]:
        """사건번호를 기반으로 데이터베이스에 저장된 기존 물건 정보를 반환합니다."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM auction_items WHERE case_number = ?", (case_number,))
            row = cursor.fetchone()
            if row:
                item = dict(row)
                # JSON 문자열 역직렬화
                item['rights_list'] = json.loads(item['rights_list']) if item['rights_list'] else []
                item['ai_report_json'] = json.loads(item['ai_report_json']) if item['ai_report_json'] else {}
                return item
        return None

    def upsert_auction_item(self, item: Dict, ai_report: Dict, rights_report: Dict) -> Tuple[str, Optional[int]]:
        """
        수집된 최신 정보를 기반으로 데이터베이스에 저장하거나 업데이트합니다.
        Returns:
            Tuple[str, Optional[int]]: (변경상태 'NEW'|'UPDATED'|'UNCHANGED', 이전 최저가)
        """
        existing = self.get_existing_item(item['case_number'])
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        created_at_str = (existing.get('created_at') if existing else None) or now_str
        ai_model_str = ai_report.get('ai_model') or (existing.get('ai_model') if existing else None) or OPENAI_MODEL
        
        status_flag = "NEW"
        prev_min_bid = None
        
        # SQLite INTEGER 상한 (2^63-1) 초과 방지 — 경매 물건 최대 현실 금액 100억 × 10배 여유
        _INT_CAP = 10 ** 13
        def _cap(v): return min(int(v or 0), _INT_CAP)

        # 비정상 파싱(0원) 방지 가드 레일 작동 (DB 적재 데이터 오염 원천 차단)
        appraisal_val = _cap(item['appraisal']) if item['appraisal'] > 0 else _cap(existing['appraisal'] if existing else 0)
        min_bid_val = _cap(item['min_bid']) if item['min_bid'] > 0 else _cap(existing['min_bid'] if existing else 0)

        if existing:
            prev_min_bid = existing['min_bid']
            # 최저가격에 실제로 유효한 변경이 생겼는지 실시간 추적 검사 (단, 수집가가 0원을 가져왔을 때의 노이즈 방어)
            if existing['min_bid'] != min_bid_val and min_bid_val > 0:
                status_flag = "UPDATED"
            else:
                status_flag = "UNCHANGED"

        # 데이터베이스 쓰기 수행
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO auction_items (
                    case_number, location, usage, appraisal, min_bid, prev_min_bid, failed_count,
                    rights_list, tenant_registration_date, tenant_deposit, is_payout_requested,
                    ai_score, ai_grade, ai_verdict, ai_suggested_bid, ai_report_json, last_updated, created_at, ai_model, status_flag,
                    area_m2, area_pyeong, floor, legal_div_no, addr_sgg, addr_emd, auction_date, remarks, special_rights
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(case_number) DO UPDATE SET
                    location=excluded.location,
                    usage=excluded.usage,
                    appraisal=excluded.appraisal,
                    min_bid=excluded.min_bid,
                    prev_min_bid=coalesce(prev_min_bid, auction_items.min_bid),
                    failed_count=excluded.failed_count,
                    rights_list=excluded.rights_list,
                    tenant_registration_date=excluded.tenant_registration_date,
                    tenant_deposit=excluded.tenant_deposit,
                    is_payout_requested=excluded.is_payout_requested,
                    ai_score=excluded.ai_score,
                    ai_grade=excluded.ai_grade,
                    ai_verdict=excluded.ai_verdict,
                    ai_suggested_bid=excluded.ai_suggested_bid,
                    ai_report_json=excluded.ai_report_json,
                    last_updated=excluded.last_updated,
                    created_at=coalesce(auction_items.created_at, excluded.created_at),
                    ai_model=coalesce(excluded.ai_model, auction_items.ai_model),
                    status_flag=?,
                    area_m2=coalesce(nullif(excluded.area_m2, 0), auction_items.area_m2),
                    area_pyeong=coalesce(nullif(excluded.area_pyeong, 0), auction_items.area_pyeong),
                    floor=coalesce(nullif(excluded.floor, 0), auction_items.floor),
                    legal_div_no=coalesce(excluded.legal_div_no, auction_items.legal_div_no),
                    addr_sgg=coalesce(excluded.addr_sgg, auction_items.addr_sgg),
                    addr_emd=coalesce(excluded.addr_emd, auction_items.addr_emd),
                    auction_date=excluded.auction_date,
                    remarks=coalesce(excluded.remarks, auction_items.remarks),
                    special_rights=coalesce(excluded.special_rights, auction_items.special_rights)
            """, (
                item['case_number'],
                item['location'],
                item.get('usage', ''),
                appraisal_val,
                min_bid_val,
                _cap(prev_min_bid) if prev_min_bid else min_bid_val,
                int(item['failed_count'] or 0),
                json.dumps(item['rights_list']),
                item['tenant_registration_date'],
                _cap(item['tenant_deposit']),
                1 if item['is_payout_requested'] else 0,
                ai_report.get('score', 85),
                ai_report.get('grade', 'A'),
                ai_report.get('verdict', ''),
                ai_report.get('suggested_bid', ''),
                json.dumps(ai_report),
                now_str,
                created_at_str,
                ai_model_str,
                status_flag,
                item.get('area_m2') or 0.0,
                item.get('area_pyeong') or 0.0,
                item.get('floor') or 0,
                item.get('legal_div_no') or '',
                item.get('addr_sgg') or '',
                item.get('addr_emd') or '',
                item.get('auction_date') or '',
                item.get('remarks') or '',
                item.get('special_rights') or '[]',
                status_flag,
            ))
            conn.commit()
            
        return status_flag, prev_min_bid


# --- Module 1: Rights Analysis Engine (Rule-based) ---
class RightsAnalysisEngine:
    def __init__(self):
        # 말소기준권리가 될 수 있는 키워드들
        self.malso_keywords = ['근저당', '압류', '가압류', '담보가등기', '경매개시결정']

    def parse_date(self, date_str: str) -> Optional[datetime]:
        """다양한 날짜 형식을 datetime 객체로 변환"""
        if not date_str or date_str == '정보없음':
            return None
        nums = re.sub(r'[^0-9]', '', date_str)
        if len(nums) >= 8:
            try:
                return datetime.strptime(nums[:8], '%Y%m%d')
            except ValueError:
                return None
        return None

    def find_malso_standard(self, rights_list: List[Dict]) -> Optional[datetime]:
        """등기부 현황에서 말소기준권리(가장 빠른 날짜)를 찾음"""
        dates = []
        for r in rights_list:
            name = r.get('name', '')
            if any(k in name for k in self.malso_keywords):
                dt = self.parse_date(r.get('date', ''))
                if dt:
                    dates.append(dt)
        return min(dates) if dates else None

    def analyze_tenant_risk(self, malso_date: datetime, tenant_date: datetime, deposit: int, is_payout_requested: bool,
                            appraisal: int = 0, min_bid: int = 0, failed_count: int = 0) -> Dict:
        """임차인 대항력 및 인수금액 분석"""
        if not malso_date:
            # 말소기준권리 없어도 할인율·유찰 경고는 수행
            _warnings: list = []
            _dr = 0
            if appraisal and appraisal > 0:
                _dr = round((1 - min_bid / appraisal) * 100, 1)
                if _dr >= 70:
                    _warnings.append(f"감정가 대비 {_dr}% 할인 — 지분경매·특수권리·다중유찰 여부 반드시 확인 필요")
            if failed_count >= 5:
                _warnings.append(f"{failed_count}회 유찰 — 시장에서 반복적으로 외면된 물건, 근본 원인 파악 필수")
            return {"has_daehang": False, "risk_level": "UNKNOWN",
                    "reason": "말소기준권리를 찾을 수 없습니다. 등기정보를 직접 확인하십시오.",
                    "estimated_loss": 0, "malso_standard": "정보없음",
                    "discount_rate": _dr, "failed_count": failed_count, "warnings": _warnings}

        has_daehang = tenant_date < malso_date if tenant_date else False
        risk_level = "SAFE"
        estimated_loss = 0
        reason = ""
        warnings = []

        if has_daehang:
            if not is_payout_requested:
                risk_level = "CRITICAL"
                estimated_loss = deposit
                reason = "대항력 있는 선순위 임차인이 배당요구를 하지 않았습니다. 보증금 전액 인수 위험."
            else:
                risk_level = "WARNING"
                estimated_loss = deposit
                reason = "선순위 임차인이 존재합니다. 미배당 보증금이 발생할 경우 낙찰자가 인수해야 합니다."
        elif not tenant_date:
            risk_level = "SAFE"
            reason = "현황조사서상 대항력 있는 임차인이 확인되지 않습니다(소유자/채무자 점유 추정)."
        else:
            risk_level = "SAFE"
            reason = "후순위 임차인입니다. 말소기준권리 이후 전입으로 대항력이 없어 낙찰 시 권리가 소멸되어 안전합니다."

        # 할인율·유찰횟수 기반 추가 경고 (임차인 안전 여부와 독립적으로 체크)
        discount_rate = 0
        if appraisal and appraisal > 0:
            discount_rate = round((1 - min_bid / appraisal) * 100, 1)
            if discount_rate >= 70:
                warnings.append(f"감정가 대비 {discount_rate}% 할인 — 지분경매·특수권리·다중유찰 여부 반드시 확인 필요")
                if risk_level == "SAFE":
                    risk_level = "WARNING"
                    reason += f" 단, 할인율 {discount_rate}%로 비정상적입니다."

        if failed_count >= 5:
            warnings.append(f"{failed_count}회 유찰 — 시장에서 반복적으로 외면된 물건, 근본 원인 파악 필수")
            if risk_level == "SAFE":
                risk_level = "WARNING"
                reason += f" {failed_count}회 유찰로 특이 사항 확인 필요."

        return {
            "has_daehang": has_daehang,
            "risk_level": risk_level,
            "estimated_loss": estimated_loss,
            "reason": reason,
            "malso_standard": malso_date.strftime('%Y-%m-%d') if malso_date else "정보없음",
            "discount_rate": discount_rate,
            "failed_count": failed_count,
            "warnings": warnings,
        }


# --- Module 2: Real Data Auction Crawler (Playwright with Advanced Navigation Flow) ---
class AuctionCrawler:
    def __init__(self, headless: bool = True):
        self.headless = headless

    async def _scrape_detail_page(self, detail_page: Page) -> Dict:
        """물건 상세정보 페이지(새 창) 내부에서 등기 현황 및 임차인 세부 정보를 직접 수집합니다."""
        rights_list = []
        tenant_registration_date = ""
        tenant_deposit = 0
        is_payout_requested = False

        try:
            # 상세 페이지가 완전히 빌드되어 동적 바인딩을 완료할 때까지 대기
            await detail_page.wait_for_load_state("domcontentloaded", timeout=15000)
            await detail_page.wait_for_timeout(2000)
            
            # 법원 상세 페이지 내부 실제 테이블 스캔
            tables = await detail_page.query_selector_all("table.Ltbl_list, table.Ltbl_dt, table, tr")
            for row in tables:
                try:
                    row_text = await row.inner_text()
                    if not row_text.strip():
                        continue
                    
                    # --- 1. 임차인 정보 수집 ---
                    if any(x in row_text for x in ["임차인", "대항력", "전입", "전입일", "사업자등록", "사업자"]):
                        date_match = re.search(r'(\d{4}[./-]\d{2}[./-]\d{2})', row_text)
                        if date_match:
                            tenant_registration_date = date_match.group(1).replace('-', '.').replace('/', '.')
                    
                    # 보증금 액수 추출
                    if any(x in row_text for x in ["보증금", "임차보증금", "전세보증금", "전세금"]):
                        price_matches = re.findall(r'([0-9,]+)\s*원', row_text)
                        if price_matches:
                            numeric_deposit = int(price_matches[0].replace(',', ''))
                            if numeric_deposit > tenant_deposit:
                                tenant_deposit = numeric_deposit
                    
                    # 배당요구 여부 판정
                    if "배당요구" in row_text or "배당" in row_text:
                        if any(x in row_text for x in ["요구", "배당요구일"]) and not any(x in row_text for x in ["않음", "배당무", "미요구"]):
                            is_payout_requested = True
                            
                    # --- 2. 등기부 권리 분석 (말소기준 권리 추출용) ---
                    for keyword in ['근저당', '압류', '가압류', '담보가등기', '경매개시결정', '저당']:
                        if keyword in row_text:
                            date_match = re.search(r'(\d{4}[./-]\d{2}[./-]\d{2})', row_text)
                            if date_match:
                                rights_list.append({
                                    "name": keyword,
                                    "date": date_match.group(1).replace('-', '.').replace('/', '.')
                                })
                                break
                except Exception:
                    pass
                    
        except Exception as e:
            console.print(f"[dim yellow]⚠️ 상세 페이지 세부 파싱 중 일부 유실 발생: {e}[/dim yellow]")

        return {
            "rights_list": rights_list,
            "tenant_registration_date": tenant_registration_date,
            "tenant_deposit": tenant_deposit,
            "is_payout_requested": is_payout_requested
        }

    def _parse_detail_json(self, raw: dict, raw_curst: dict = None, debug_dump_path: str = "") -> dict:
        """selectAuctnCsSrchRslt.on 및 selectCurstExmndc.on(현황조사서) 응답에서 권리관계·임차인 정보를 추출한다."""
        rights_list = []
        tenant_registration_date = ""
        tenant_deposit = 0
        is_payout_requested = False
        tenants_list = []
        auction_date = ""
        remarks = ""

        try:
            dma = (raw.get('data') or {}).get('dma_result') or {}
            gds = dma.get('dspslGdsDxdyInfo') or {}
            auction_date = gds.get('dspslDxdyYmd') or ""

            # ── 비고란 및 매각조건 수집 (매각물건명세서 비고) ──
            remarks_parts = []
            if gds.get('gdsSpcfcRmk'):
                remarks_parts.append(f"[매각물건명세서 비고]\n{gds['gdsSpcfcRmk'].strip()}")
            if gds.get('dspslGdsRmk'):
                remarks_parts.append(f"[매각조건 비고]\n{gds['dspslGdsRmk'].strip()}")
            if gds.get('sprfcExstcDts'):
                remarks_parts.append(f"[지상권 관련 내역]\n{gds['sprfcExstcDts'].strip()}")
            if gds.get('ndstrcRghCtt'):
                remarks_parts.append(f"[소멸되지 않는 권리]\n{gds['ndstrcRghCtt'].strip()}")
            remarks = "\n\n".join(remarks_parts)

            # 디버그 덤프: --debug-dump 플래그 시 dma_result 전체를 파일로 저장
            if debug_dump_path and dma:
                try:
                    with open(debug_dump_path, 'w', encoding='utf-8') as _f:
                        json.dump({"dma_keys": list(dma.keys()), "gds_keys": list(gds.keys()),
                                   "dma_result": dma}, _f, ensure_ascii=False, indent=2)
                    console.print(f"[dim]💾 API 응답 덤프 저장: {debug_dump_path}[/dim]")
                except Exception:
                    pass

            # ── 권리관계: tprtyRnkHypthcStngDts 전체 텍스트 스캔 ──────────
            hyp_text = gds.get('tprtyRnkHypthcStngDts') or ''
            if hyp_text:
                RIGHTS_KW = ['담보가등기', '근저당', '가압류', '경매개시결정', '경매개시', '압류', '저당']
                DATE_RE = re.compile(r'(\d{4})[./](\d{1,2})[./](\d{1,2})|(\d{4})(\d{2})(\d{2})')

                # 개행 기준 분리 후 각 세그먼트에서 날짜+키워드 추출
                segments = [s.strip() for s in re.split(r'[\r\n]+', hyp_text) if s.strip()]
                # 개행이 없는 연속 텍스트는 finditer로 (키워드→날짜) / (날짜→키워드) 패턴 직접 스캔
                # lookahead split 대신 finditer를 써야 '근저당'→'저당' 오분류를 방지할 수 있다
                if len(segments) <= 1:
                    kw_alt = '|'.join(re.escape(k) for k in RIGHTS_KW)
                    date_p = r'\d{4}[./]\d{1,2}[./]\d{1,2}|\d{8}'
                    seen = set()
                    for pat in [f'({kw_alt})(?:[^\\d]{{0,20}})({date_p})',
                                f'({date_p})(?:[^가-힣]{{0,20}})({kw_alt})']:
                        for m2 in re.finditer(pat, hyp_text):
                            g = m2.groups()
                            # 어느 순서인지 구분
                            if re.match(kw_alt, g[0]):
                                kw_found, date_raw = g[0], g[1]
                            else:
                                date_raw, kw_found = g[0], g[1]
                            nums = re.sub(r'[^0-9]', '', date_raw)
                            if len(nums) < 8:
                                continue
                            date_str = f"{nums[:4]}.{nums[4:6]}.{nums[6:8]}"
                            key = f"{kw_found}_{date_str}"
                            if key not in seen:
                                seen.add(key)
                                rights_list.append({"name": kw_found, "date": date_str})
                else:
                    seen = set()
                    for seg in segments:
                        dm = DATE_RE.search(seg)
                        if not dm:
                            continue
                        if dm.group(1):
                            y, mo, d = dm.group(1), dm.group(2).zfill(2), dm.group(3).zfill(2)
                        else:
                            y, mo, d = dm.group(4), dm.group(5), dm.group(6)
                        date_str = f"{y}.{mo}.{d}"
                        for kw in RIGHTS_KW:
                            if kw in seg:
                                key = f"{kw}_{date_str}"
                                if key not in seen:
                                    seen.add(key)
                                    rights_list.append({"name": kw, "date": date_str})
                                break

            # ── 경매개시결정: dstrtDemnInfo ───────────────────────────────
            for dstrt in (dma.get('dstrtDemnInfo') or []):
                ymd = dstrt.get('dstrtDemnLstprdYmd') or ''
                if len(ymd) == 8:
                    date_str = f"{ymd[:4]}.{ymd[4:6]}.{ymd[6:]}"
                    if not any(r['name'] == '경매개시결정' and r['date'] == date_str for r in rights_list):
                        rights_list.append({"name": "경매개시결정", "date": date_str})

            # ── 임차인 정보: 1순위 현황조사서(raw_curst) 파싱 ─────────────────────────
            dates_found = []
            if raw_curst:
                try:
                    c_data = (raw_curst.get('data') or {})
                    leases = c_data.get('dlt_ordTsLserLtn') or []
                    for l in leases:
                        if not isinstance(l, dict):
                            continue
                        name = (l.get('intrpsNm') or '').strip()
                        move_in_raw = (l.get('mvinDtlCtt') or '').strip()
                        dep_raw = (l.get('lesDposDts') or '').strip()
                        monthly_raw = (l.get('mmrntAmtDts') or '').strip()
                        fixed_raw = (l.get('rgstryCrtcpCfmtnCtt') or '').strip()
                        room = (l.get('bldDtlDts') or '').strip()
                        poss = (l.get('gdsPossCtt') or '').strip()

                        # 전입일자 정규화 YYYY.MM.DD
                        norm_move_in = ""
                        if move_in_raw:
                            dm = re.search(r'(\d{4})[./-](\d{1,2})[./-](\d{1,2})', move_in_raw)
                            if dm:
                                norm_move_in = f"{dm.group(1)}.{dm.group(2).zfill(2)}.{dm.group(3).zfill(2)}"
                                dates_found.append(norm_move_in)

                        # 보증금 정수 변환
                        dep_num = 0
                        if dep_raw:
                            num_matches = re.findall(r'[\d,]+', dep_raw)
                            for nm in num_matches:
                                try:
                                    v = int(nm.replace(',', ''))
                                    if v > dep_num:
                                        dep_num = v
                                except Exception:
                                    pass
                        # 배당요구 여부
                        tenant_payout = any(k in poss or k in fixed_raw for k in ('배당요구', '배당신청', '배당요구일'))
                        if tenant_payout:
                            is_payout_requested = True

                        tenants_list.append({
                            "name": name,
                            "move_in_date": norm_move_in or move_in_raw,
                            "deposit": dep_num if dep_num > 0 else (dep_raw or "미상"),
                            "monthly_rent": monthly_raw or "",
                            "fixed_date": fixed_raw or "",
                            "room": room,
                            "is_payout_requested": tenant_payout,
                        })

                    if dates_found:
                        dates_found.sort()
                        tenant_registration_date = dates_found[0]

                    # 선순위 임차인 보증금 합산 (말소기준권리보다 빠른 임차인들의 보증금 총합)
                    malso_kw = ['담보가등기', '근저당', '가압류', '경매개시결정', '경매개시', '압류', '저당']
                    malso_dates = [r['date'].replace('.', '').replace('-', '') for r in rights_list if any(k in r.get('name', '') for k in malso_kw) and r.get('date')]
                    earliest_malso = min(malso_dates) if malso_dates else ""

                    senior_deposit_sum = 0
                    total_deposit_sum = 0
                    for t in tenants_list:
                        d = t.get('deposit')
                        d_val = d if isinstance(d, int) else 0
                        total_deposit_sum += d_val
                        t_clean = (t.get('move_in_date') or '').replace('.', '').replace('-', '')
                        if not earliest_malso or (t_clean and t_clean < earliest_malso):
                            senior_deposit_sum += d_val

                    # 선순위 임차보증금 합산액 우선 반영 (없을 시 전체 보증금 합산액)
                    tenant_deposit = senior_deposit_sum if senior_deposit_sum > 0 else total_deposit_sum
                except Exception as e_curst:
                    console.print(f"[dim yellow]⚠️ 현황조사서 임차인 파싱 예외: {e_curst}[/dim yellow]")

            # 2순위: dma 내부 키 탐색 (raw_curst에서 임차인이 없었던 경우 fallback)
            if not tenant_registration_date:
                TENANT_KEYS = ('lseeInfo', 'tnntInfo', 'lseeStusInfo', 'tenantInfo',
                               'lseeCntnInfo', 'tnntCntnInfo', 'lseeDtlInfo')
                DATE_FIELDS = ('mvInYmd', 'entnYmd', 'rgstnYmd', 'mvnYmd',
                               'lseRgstnYmd', 'jmInDt', 'tnntRgstnYmd', 'entnDt')
                DEP_FIELDS  = ('lseDposAmt', 'posAmt', 'dposAmt', 'chrtgrAmt', 'tnntDposAmt')
                SKIP_KEYS   = {'dspslGdsDxdyInfo', 'csBaseInfo', 'dstrtDemnInfo'}

                tenant_candidates: list = []
                for tk in TENANT_KEYS:
                    v = dma.get(tk)
                    if not v:
                        continue
                    if isinstance(v, dict):
                        tenant_candidates = [v]; break
                    if isinstance(v, list) and v:
                        tenant_candidates = v; break

                if not tenant_candidates:
                    for k, v in dma.items():
                        if k in SKIP_KEYS:
                            continue
                        rows = [v] if isinstance(v, dict) else (v if isinstance(v, list) else [])
                        for row in rows:
                            if isinstance(row, dict) and any(row.get(f) for f in DATE_FIELDS):
                                tenant_candidates.append(row)

                for t in tenant_candidates:
                    if not isinstance(t, dict):
                        continue
                    ymd_raw = next((t.get(f) for f in DATE_FIELDS if t.get(f)), '') or ''
                    if ymd_raw:
                        nums = re.sub(r'[^0-9]', '', str(ymd_raw))
                        if len(nums) >= 8:
                            tenant_registration_date = f"{nums[:4]}.{nums[4:6]}.{nums[6:8]}"
                    for df in DEP_FIELDS:
                        raw_dep = t.get(df)
                        if raw_dep:
                            try:
                                dep_val = int(str(raw_dep).replace(',', ''))
                                if dep_val > tenant_deposit:
                                    tenant_deposit = dep_val
                            except Exception:
                                pass
                    if t.get('dvdndDmndYn') in ('Y', 'y') or t.get('dvdndDmndDt'):
                        is_payout_requested = True

        except Exception:
            pass

        # ── 면적 + 층수 + 법정동 코드 (gdsDspslObjctLst) ────────────────
        area_m2 = 0.0
        floor = 0
        legal_div_no = ""
        addr_sgg = ""
        addr_emd = ""
        try:
            dma2 = (raw.get('data') or {}).get('dma_result', {})
            obj_list = dma2.get('gdsDspslObjctLst') or []
            for obj in obj_list:
                if not isinstance(obj, dict):
                    continue
                # 면적
                ar_str = str(obj.get('objctArDts') or '')
                m = re.search(r'([\d.]+)', ar_str)
                if m:
                    area_m2 += float(m.group(1))
                # 층수 — flrNo 또는 objctFlrNo
                for fk in ('flrNo', 'objctFlrNo', 'gdsFlrNo', 'floorNo'):
                    fv = obj.get(fk)
                    if fv:
                        try:
                            floor = int(str(fv).strip())
                        except ValueError:
                            pass
                        break
                # 법정동
                if not legal_div_no:
                    sd  = str(obj.get('rprsAdongSdCd')  or '').zfill(2)
                    sgg = str(obj.get('rprsAdongSggCd') or '').zfill(3)
                    emd = str(obj.get('rprsAdongEmdCd') or '').zfill(3)
                    ri  = str(obj.get('rprsAdongRiCd')  or '').zfill(2)
                    if sd and sgg and emd:
                        legal_div_no = sd + sgg + emd + ri
                    addr_sgg = str(obj.get('adongSggNm') or '')
                    addr_emd = str(obj.get('adongEmdNm') or '')

            # sprfcExstcDts 텍스트에서 면적 보완 (objctArDts 실패 시)
            if area_m2 == 0.0:
                sprfc = str((dma2.get('dspslGdsDxdyInfo') or {}).get('sprfcExstcDts') or '')
                m2 = re.search(r'([\d,]+\.?\d*)\s*㎡', sprfc)
                if m2:
                    area_m2 = float(m2.group(1).replace(',', ''))
        except Exception:
            pass

        area_pyeong = round(area_m2 / 3.30579, 1) if area_m2 else 0.0

        special_rights = extract_special_rights(remarks=remarks, rights_list=rights_list)

        return {
            "rights_list": rights_list,
            "tenant_registration_date": tenant_registration_date,
            "tenant_deposit": tenant_deposit,
            "is_payout_requested": is_payout_requested,
            "tenants_list": tenants_list,
            "area_m2": round(area_m2, 2),
            "area_pyeong": area_pyeong,
            "floor": floor,
            "legal_div_no": legal_div_no,
            "addr_sgg": addr_sgg,
            "addr_emd": addr_emd,
            "auction_date": auction_date,
            "remarks": remarks,
            "special_rights": json.dumps(special_rights, ensure_ascii=False),
        }

    async def search(self, region: str = "서울", max_items: int = 5, court_code: str = "", debug_dump_path: str = "") -> list:
        async with async_playwright() as p:
            # 크롬 내부 기본 팝업 차단 필터가 window.open 및 form.submit을 막지 못하도록 원천 무력화합니다.
            launch_args = [
                "--disable-blink-features=AutomationControlled", 
                "--disable-web-security",
                "--no-sandbox",
                "--disable-infobars",
                "--window-size=1280,900",
                "--disable-background-networking",
                "--disable-default-apps",
                "--disable-extensions",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-popup-blocking"  # 크롬 내부 팝업 차단 필터 강제 비활성화
            ]
            if not self.headless:
                launch_args.append("--auto-open-devtools-for-tabs")

            browser = await p.chromium.launch(
                headless=self.headless,
                args=launch_args
            )
            
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={'width': 1280, 'height': 900},
                ignore_https_errors=True,
                locale="ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
                timezone_id="Asia/Seoul"
            )
            
            # 은닉화용 전처리 스크립트 주입 (window.open에 변형을 가하던 가로채기 <a> 태그 스크립트는 완전히 제거합니다)
            await context.add_init_script("""
                const newProto = Navigator.prototype;
                delete newProto.webdriver;
                Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
                window.chrome = {
                    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', RUNNING: 'running', SUGGEST_RUN: 'suggest_run' } },
                    runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update', INSTALL: 'install', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' } }
                };
                Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});
                Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
                Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});
            """)
            
            page = await context.new_page()
            console.print(f"[bold yellow]🌐 법원경매정보 접속 수립 및 보안 세션 우회 중... ({region})[/bold yellow]")
            
            try:
                # 1. 법원경매 메인 웹 허브 정상 접속 (WAF 쿠키 및 세션 핸드셰이크 우선 확보)
                main_resp = await page.goto(COURT_AUCTION_MAIN_URL, wait_until="networkidle", timeout=60000)
                main_status = main_resp.status if main_resp else "응답 없음"
                console.print(f"[dim]📊 메인 페이지 접속 결과: HTTP {main_status}[/dim]")
                
                await page.wait_for_timeout(3000)
                
                # 팝업 제거
                try:
                    close_buttons = await page.query_selector_all("text='닫기', text='오늘하루열지않기'")
                    for btn in close_buttons:
                        await btn.click()
                except Exception:
                    pass

                console.print("[dim]👉 우측 민트색 퀵 단축 메뉴 '물건상세검색' 타겟팅 전환 및 실행...[/dim]")
                
                quick_search_locator = page.locator("a.btn_adv, a[title*='물건상세검색']").first
                await quick_search_locator.wait_for(timeout=15000)
                
                box = await quick_search_locator.bounding_box()
                if box:
                    await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                else:
                    await quick_search_locator.click()
                
                await page.wait_for_timeout(6000)

                console.print("[dim]👉 메인 작업 프레임(iframe) 스캔 및 구조 조율 중...[/dim]")
                
                frame = None
                target_select_id = None
                
                for attempt in range(60):
                    all_frames = page.frames
                    if attempt == 0 or attempt % 15 == 0:
                        console.print(f"[dim]🔍 발견된 활성 iframe 수: {len(all_frames)}개[/dim]")
                                
                    for f in all_frames:
                        if "PGJ151" in f.url or "pgj" in f.url or "index.on" in f.url:
                            frame = f
                            break
                    if frame:
                        break
                    await asyncio.sleep(0.5)

                if not frame and len(page.frames) > 0:
                    for f in page.frames:
                        if f.parent_frame is not None:
                            frame = f
                            break

                if not frame:
                    body_content = await page.content()
                    body_len = len(body_content) if body_content else 0
                    console.print(f"[bold red]❌ 크롤러 렌더링 분석 결과: 확보한 HTML 길이 ({body_len} 자)[/bold red]")
                    raise Exception("상세검색 폼 요소가 존재하는 메인 작업 iframe을 확보할 수 없습니다.")

                console.print(f"[bold green]✅ 프레임 핀포인트 다이렉트 직결 성공 ({frame.url}).[/bold green]")

                await frame.wait_for_load_state("load", timeout=15000)
                await page.wait_for_timeout(2000)

                try:
                    radio_btn = await frame.query_selector("input[value='L']")
                    if not radio_btn:
                        radio_btn = await frame.query_selector("label:has-text('법원/담당계')")
                    if radio_btn:
                        await radio_btn.click()
                        await page.wait_for_timeout(1000)
                except Exception as ex:
                    console.print(f"[dim]ℹ️ 라디오 버튼 클릭 건너뜀 또는 에러: {ex}[/dim]")

                for select_id in ["#mf_wfm_mainFrame_sbx_rletCortOfc", "#sbAuctnCd", "#sbBeobwon", "#idAuctnCd", "#idDoCode", "#idSrchDo"]:
                    el = await frame.query_selector(select_id)
                    if el:
                        target_select_id = select_id
                        break

                if not target_select_id:
                    el = await frame.query_selector("select[id*='CortOfc'], select[id*='Auctn'], select[id*='Beobwon'], select")
                    if el:
                        id_attr = await el.get_attribute("id")
                        target_select_id = f"#{id_attr}" if id_attr else "select"

                if not target_select_id:
                    raise Exception("법원 선택상자 드롭다운 요소를 프레임 내에서 발견하지 못했습니다.")

                console.print(f"[bold green]🎯 타겟 선택상자 ID 확보 성공: {target_select_id}[/bold green]")
                console.print("[dim]👉 [우회 특허] WebSquare 컴포넌트 강제 갱신 주입 중...[/dim]")
                
                # 법원명으로 드롭다운 인덱스를 찾고 setSelectedIndex로 선택
                js_select_websquare = f"""
                (args) => {{
                    const [region_name, select_id] = args;
                    try {{
                        const cleanId = select_id.replace('#', '');
                        const doSelect = document.querySelector(select_id);
                        if (!doSelect || doSelect.options.length < 2) return false;

                        let targetIndex = -1;
                        for (let i = 0; i < doSelect.options.length; i++) {{
                            if (doSelect.options[i].text.includes(region_name) ||
                                doSelect.options[i].value.includes(region_name)) {{
                                targetIndex = i;
                                break;
                            }}
                        }}
                        if (targetIndex < 0) return false;

                        if (window.WebSquare && window.WebSquare.util) {{
                            const comp = window.WebSquare.util.getComponentById(cleanId);
                            if (comp && comp.setSelectedIndex) {{
                                comp.setSelectedIndex(targetIndex);
                                comp.trigger("onchange");
                                return true;
                            }}
                        }}
                        // DOM 폴백
                        doSelect.selectedIndex = targetIndex;
                        doSelect.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        return true;
                    }} catch (e) {{
                        console.error(e);
                    }}
                    return false;
                }}
                """

                success = False
                for _ in range(30):
                    success = await frame.evaluate(js_select_websquare, [region, target_select_id])
                    if success:
                        break
                    await asyncio.sleep(0.5)

                if not success:
                    try:
                        eval_script = f"""
                        () => {{
                            if (window.WebSquare && window.WebSquare.util) {{
                                const cleanId = '{target_select_id.replace("#", "")}';
                                const comp = window.WebSquare.util.getComponentById(cleanId);
                                if (comp) {{
                                    comp.setSelectedIndex(1);
                                    comp.trigger("onchange");
                                    return true;
                                }}
                            }}
                            return false;
                        }}
                        """
                        success = await frame.evaluate(eval_script)
                    except Exception:
                        pass

                if not success:
                    raise Exception(f"WebSquare 컴포넌트 우회 인젝션 방식으로도 선택 박스({target_select_id})를 활성화할 수 없습니다.")

                # 법원 드롭다운에서 B-format 코드 수집 (WebSquare 내부 itemset 우선, 실패 시 하드코딩)
                SEOUL_COURT_CODES: list = []
                try:
                    clean_id = target_select_id.replace('#', '')
                    SEOUL_COURT_CODES = await frame.evaluate(f"""
                    () => {{
                        const cleanId = '{clean_id}';
                        if (window.WebSquare && window.WebSquare.util) {{
                            const comp = window.WebSquare.util.getComponentById(cleanId);
                            if (comp && typeof comp.getItemset === 'function') {{
                                const items = comp.getItemset();
                                if (items && items.length) {{
                                    const codes = items.map(item => item.code || item.value || item.id || item.key)
                                                       .filter(v => v && typeof v === 'string' && v.startsWith('B'));
                                    if (codes.length) return codes;
                                }}
                            }}
                        }}
                        const sel = document.getElementById(cleanId);
                        if (!sel) return [];
                        return [...sel.options].map(o => o.value)
                                              .filter(v => v && v.length > 0);
                    }}
                    """)
                    console.print(f"[dim]📋 법원 드롭다운 {len(SEOUL_COURT_CODES)}개 옵션 확인[/dim]")
                except Exception:
                    pass
                if not SEOUL_COURT_CODES:
                    SEOUL_COURT_CODES = ['B000220', 'B000230', 'B000240', 'B000250']

                await page.wait_for_timeout(1000)

                if BUILDING_TYPE_CODE:
                    try:
                        js_check_websquare = f"""
                        (code) => {{
                            try {{
                                const chk = document.querySelector(`input[value='${{code}}']`);
                                if (chk) {{
                                    chk.checked = true;
                                    chk.dispatchEvent(new Event('click', {{ bubbles: true }}));
                                    chk.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                    return true;
                                }}
                            }} catch (e) {{}}
                            return false;
                        }}
                        """
                        await frame.evaluate(js_check_websquare, BUILDING_TYPE_CODE)
                        await page.wait_for_timeout(500)
                    except Exception:
                        pass
                
                console.print("[dim]👉 [우회 특허] 검색 트리거 강제 실행 중...[/dim]")
                
                js_click_websquare = """
                () => {
                    try {
                        const btn = document.querySelector("#mf_wfm_mainFrame_btn_search") || 
                                    document.querySelector("#btnSrch") || 
                                    document.querySelector("input[value='검색']") || 
                                    document.querySelector(".btn_search, a.btn_search, button.btn_search");
                        if (btn) {
                            btn.click();
                            btn.dispatchEvent(new Event('click', { bubbles: true }));
                            return true;
                        }
                    } catch (e) {}
                    return false;
                }
                """
                click_success = await frame.evaluate(js_click_websquare)
                if not click_success:
                    search_btn = await frame.query_selector("text='검색'")
                    if not search_btn:
                        search_btn = await frame.query_selector("a#mf_wfm_mainFrame_btn_search")
                    if search_btn:
                        await search_btn.click()
                
                console.print("[dim]🔍 법원 서버로부터 검색 결과를 받아오는 중...[/dim]")
                
                try:
                    # '인쇄하기' 텍스트는 검색 성공 시 하단 제어 바가 활성화될 때 나타납니다.
                    await frame.wait_for_selector("text='인쇄하기'", timeout=30000)
                    # 데이터가 DOM 트리 가상 그리드 상에 안전하게 매핑되도록 대기 보장
                    await page.wait_for_timeout(3000)
                    # 페이지당 표시 건수를 10건 -> 40건(최대)으로 변경하여 대량 수집 가속
                    changed_size = await frame.evaluate("""() => {
                        try {
                            const comp = window.WebSquare && window.WebSquare.util && window.WebSquare.util.getComponentById("mf_wfm_mainFrame_sbx_pageSize");
                            if (comp && comp.setSelectedIndex) {
                                comp.setSelectedIndex(3); // 40건
                                comp.trigger("onchange");
                                return true;
                            }
                            const sel = document.getElementById("mf_wfm_mainFrame_sbx_pageSize");
                            if (sel) {
                                sel.value = "40";
                                sel.dispatchEvent(new Event("change", { bubbles: true }));
                                return true;
                            }
                        } catch (e) {}
                        return false;
                    }""")
                    if changed_size:
                        await page.wait_for_timeout(3500)
                except Exception:
                    no_data_element = await frame.query_selector("text='검색결과가 존재하지 않습니다'")
                    if no_data_element:
                        console.print("[yellow]ℹ️ 검색 조건에 일치하는 경매 물건이 존재하지 않습니다.[/yellow]")
                        await browser.close()
                        return []
                    raise Exception("검색 결과 테이블 로딩 타임아웃")
                
                # ── Phase 1: 모든 페이지에서 기본 정보 스캔 (DOM만, moveDtlPage 사용 안 함) ──
                # moveDtlPage 없이 페이지 이동이 자유롭다.
                def _infer_usage(loc: str, cur_usage: str = "", flr: int = 0) -> str:
                    if cur_usage and cur_usage.strip() not in ("", "기타"):
                        return cur_usage.strip()
                    loc_s = loc or ""
                    comm_kw = ["상가", "근린", "타워", "지식산업", "프라자", "플라자", "센터", "에이스", "테크노", "비즈", "몰", "마켓", "빌딩", "스퀘어", "엠파이어", "디지털", "밸리", "트윈", "메트로", "제지1층", "제지2층", "지하1층", "지1층"]
                    if any(k in loc_s for k in comm_kw):
                        return "상가/근린시설"
                    offi_kw = ["오피스텔", "아트리움", "트럼프", "리버빌", "스테이트", "오피스", "메종", "르메이에르", "샤르망", "두산위브센티움", "효성해링턴타워", "센트럴푸르지오시티", "푸르지오시티", "자이엘라", "롯데캐슬골드", "아이파크디어반", "더샵스타파크"]
                    if any(k in loc_s for k in offi_kw):
                        return "오피스텔"
                    apt_kw = ["아파트", "푸르지오", "자이", "래미안", "힐스테이트", "아이파크", "더샵", "롯데캐슬", "이편한세상", "e편한세상", "아크로", "데시앙", "센트레빌", "스카이뷰", "위브", "해링턴", "꿈에그린", "포레나", "호반베르디움", "베르디움", "우미린", "중흥에스클래스", "주공", "현대", "우성", "삼성", "한양", "벽산", "동아", "대림", "대우", "쌍용", "삼익", "선경", "한신", "극동", "경남", "동부", "금호", "코오롱", "신동아", "성원", "건영", "풍림", "삼환", "두산", "엘지", "청구", "미도", "진주", "시영", "그랑빌", "센트럴", "파크뷰", "리버파크", "트리지움", "엘스", "리센츠", "헬리오시티", "파크리오"]
                    if any(k in loc_s for k in apt_kw):
                        return "아파트"
                    dong_m = re.search(r"([1-9]\d{2,3})동", loc_s)
                    villa_kw = ["빌라", "다세대", "연립", "맨션", "하이츠", "빌리지", "타운", "주택", "하우스", "캐슬빌", "아트빌", "그린빌", "스카이빌", "드림빌", "청구빌", "현대빌", "삼성빌"]
                    if dong_m and not any(k in loc_s for k in villa_kw):
                        return "아파트"
                    if flr >= 7 and "호" in loc_s:
                        return "아파트"
                    if any(k in loc_s for k in villa_kw) or ("층" in loc_s and "호" in loc_s):
                        return "다세대/빌라"
                    if "임야" in loc_s or re.search(r"\b산\s*\d+", loc_s) or ("층" not in loc_s and "호" not in loc_s and re.search(r"\d+(-\d+)?$", loc_s.strip())):
                        return "토지/대지"
                    return "기타"

                basic_items: list = []
                current_page = 1
                row_index = 0
                prev_count = 0
                while len(basic_items) < max_items:
                    current_rows = await frame.query_selector_all("tr")
                    if row_index >= len(current_rows):
                        # 현재 페이지에서 신규 수집된 건이 하나도 없으면 마지막 페이지 도달
                        if current_page > 1 and len(basic_items) == prev_count:
                            break
                        prev_count = len(basic_items)
                        current_page += 1
                        moved = await frame.evaluate(f"""(targetPage) => {{
                            try {{
                                const pgl = window.WebSquare && window.WebSquare.util && window.WebSquare.util.getComponentById("mf_wfm_mainFrame_pgl_gdsDtlSrchPage");
                                if (pgl && typeof pgl.setValue === "function") {{
                                    pgl.setValue(targetPage);
                                    if (typeof pgl.trigger === "function") {{
                                        pgl.trigger("onchange");
                                        pgl.trigger("onclick", targetPage);
                                    }}
                                }}
                                const btn = document.getElementById("mf_wfm_mainFrame_pgl_gdsDtlSrchPage_page_" + targetPage);
                                if (btn) {{
                                    btn.click();
                                    return true;
                                }}
                                if (targetPage % 10 === 1) {{
                                    const nextBlock = document.querySelector("#mf_wfm_mainFrame_pgl_gdsDtlSrchPage_next_btn a, #mf_wfm_mainFrame_pgl_gdsDtlSrchPage_next_btn");
                                    if (nextBlock) {{
                                        nextBlock.click();
                                        return true;
                                    }}
                                }}
                            }} catch (e) {{}}
                            return false;
                        }}""", current_page)
                        if not moved:
                            break
                        console.print(f"[dim]📄 페이지 {current_page}로 이동 중... (누적 {len(basic_items)}건)[/dim]")
                        await page.wait_for_timeout(3000)
                        row_index = 0
                        continue

                    row = current_rows[row_index]
                    row_index += 1
                    try:
                        cols = await row.query_selector_all("td")
                        if len(cols) < 5:
                            continue
                        case_text = await cols[1].inner_text()
                        case_matches = re.findall(r'(\d+타경\s*\d+)', case_text)
                        if not case_matches:
                            continue
                        
                        usage_text = await cols[2].inner_text()
                        usage_clean = usage_text.strip()

                        location_raw = await cols[3].inner_text()
                        location_lines = [l.strip() for l in location_raw.split('\n') if l.strip()]
                        location = next((l for l in location_lines if l not in ("지도", "지적도")), "소재지 정보 없음")
                        usage = _infer_usage(location, usage_clean)

                        row_full_text = await row.inner_text()
                        for match in case_matches:
                            row_full_text = row_full_text.replace(match, "")
                        row_full_text = re.sub(r'\d+타경\s*\d+', '', row_full_text)
                        backup_prices = [int(p.replace(',', '')) for p in re.findall(r'[0-9,]+', row_full_text)
                                         if p.replace(',', '').isdigit() and len(p.replace(',', '')) >= 5]
                        appraisal = backup_prices[0] if backup_prices else 0
                        min_bid   = backup_prices[1] if len(backup_prices) > 1 else 0

                        cur_row_id = (current_page, row_index - 1)
                        for case_id in case_matches:
                            case_number = case_id.strip()
                            if len(basic_items) >= max_items:
                                break
                            if not any(b['case_number'] == case_number for b in basic_items):
                                basic_items.append({"case_number": case_number,
                                                    "location": location,
                                                    "usage": usage,
                                                    "appraisal": appraisal,
                                                    "min_bid": min_bid,
                                                    "row_id": cur_row_id})
                    except Exception:
                        pass

                console.print(f"[dim]🗂 Phase 1 완료: {len(basic_items)}개 사건번호 수집[/dim]")

                # ── Phase 2: cortOfcCd 확보 (moveDtlPage 첫 번째 항목 한 번만) ──
                cort_ofc_cd = ''
                captured_xhr_headers: dict = {}
                if basic_items:
                    detail_captured: list = []

                    async def _capture_detail_xhr(response, _c=detail_captured, _h=captured_xhr_headers):
                        if 'selectAuctnCsSrchRslt' in response.url:
                            try:
                                body = await response.json()
                                _c.append(body)
                                req_headers = response.request.headers
                                for k in ('content-type', 'referer', 'x-requested-with', 'accept', 'origin'):
                                    if k in req_headers:
                                        _h[k] = req_headers[k]
                            except Exception:
                                pass

                    page.on('response', _capture_detail_xhr)
                    try:
                        await frame.evaluate("() => moveDtlPage(0)")
                        await asyncio.sleep(6)
                    except Exception as e_xhr:
                        console.print(f"[dim yellow]⚠️ moveDtlPage(0) 실패: {e_xhr}[/dim yellow]")
                    finally:
                        page.remove_listener('response', _capture_detail_xhr)

                    seed = detail_captured[0] if detail_captured else {}
                    cort_ofc_cd = ((seed.get('data') or {}).get('dma_result') or {}).get('csBaseInfo', {}).get('cortOfcCd', '')
                    seed_cs_no = ((seed.get('data') or {}).get('dma_result') or {}).get('csBaseInfo', {}).get('csNo', '')
                    # moveDtlPage 첫 번째 항목의 상세를 basic_items[0]에 캐싱
                    basic_items[0]['_seed_detail'] = seed
                    seed_row_id = basic_items[0].get('row_id', -1)
                    for bi in basic_items:
                        if bi.get('row_id') == seed_row_id:
                            bi['_seed_detail'] = seed
                    console.print(f"[dim]🔑 cortOfcCd 확보: {cort_ofc_cd or '실패'}[/dim]")

                # ── Phase 3: 각 물건 상세 fetch (frame 상태 무관하게 동작) ──
                _CASE_KIND_CODES = {'타경': '0130', '타특': '0140', '타기': '0150'}

                def _to_api_cs_no(case_no: str) -> str:
                    m = re.match(r'(\d{4})(타경|타특|타기)\s*(\d+)', case_no)
                    if m:
                        year, kind, num = m.groups()
                        code = _CASE_KIND_CODES.get(kind, '0130')
                        return f"{year}{code}{num.zfill(6)}"
                    return case_no

                extra_headers = {k: v for k, v in captured_xhr_headers.items()
                                 if k not in ('content-type',)}
                fetch_js = f"""
                async ([csNo, cortOfcCd]) => {{
                    const extraHeaders = {json.dumps(extra_headers)};
                    const resp = await fetch('/pgj/pgj15B/selectAuctnCsSrchRslt.on', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json; charset=UTF-8',
                            ...extraHeaders
                        }},
                        credentials: 'same-origin',
                        body: JSON.stringify({{
                            dma_srchGdsDtlSrch: {{
                                csNo: csNo, cortOfcCd: cortOfcCd,
                                dspslGdsSeq: '1', pgmId: 'PGJ151F01'
                            }}
                        }})
                    }});
                    if (!resp.ok) return {{error: resp.status}};
                    return await resp.json();
                }}
                """
                fetch_curst_js = f"""
                async ([csNo, cortOfcCd]) => {{
                    const extraHeaders = {json.dumps(extra_headers)};
                    const resp = await fetch('/pgj/pgj15B/selectCurstExmndc.on', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json; charset=UTF-8',
                            ...extraHeaders
                        }},
                        credentials: 'same-origin',
                        body: JSON.stringify({{
                            dma_srchCurstExmn: {{
                                cortOfcCd: cortOfcCd,
                                csNo: csNo,
                                auctnInfOriginDvsCd: '2',
                                ordTsCnt: ''
                            }}
                        }})
                    }});
                    if (!resp.ok) return {{error: resp.status}};
                    return await resp.json();
                }}
                """
                extracted_items = []
                row_detail_cache: dict = {}
                # 기존 DB 물건 빠른 조회용 맵 + 신규 물건 Phase 1 즉시 선등록 (전체 매물 즉시 노출)
                existing_map: dict = {}
                try:
                    now_init = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    with sqlite3.connect(DB_FILE_PATH) as _conn:
                        for _r in _conn.execute("SELECT case_number, min_bid, rights_list FROM auction_items"):
                            existing_map[_r[0]] = (_r[1], _r[2])
                        new_batch = []
                        for bi in basic_items:
                            cn = bi['case_number']
                            if cn not in existing_map:
                                app_v = bi.get('appraisal') or 0
                                min_v = bi.get('min_bid') or 0
                                disc_v = round((1 - min_v / app_v) * 100, 1) if app_v > 0 and min_v > 0 else 0.0
                                margin_v = max(app_v - min_v, 0)
                                grade_v = "A" if disc_v >= 30 else ("B" if disc_v >= 15 else "C")
                                score_v = 85 if disc_v >= 30 else (75 if disc_v >= 15 else 65)
                                rep_v = json.dumps({
                                    "score": score_v,
                                    "grade": grade_v,
                                    "verdict": f"법원 목록 수집 완료 (감정가 대비 {disc_v}% 할인) — 상세 권리 동기화 중",
                                    "buy_signal": disc_v >= 20,
                                    "expected_yield": "6~8%",
                                    "suggested_bid": f"{int(min_v * 1.03):,}원 부근" if min_v > 0 else "산정 대기",
                                    "extinguished_rights": ["상세 등기부 권리 동기화 예정"],
                                    "retained_rights": ["없음 (또는 현황조사서 확인 필요)"],
                                    "key_points": [f"감정가 대비 {disc_v}% 할인"],
                                    "risks": ["상세 현황조사서 동기화 진행 중"],
                                    "analysis_detail": "법원 전체 목록 스캔을 통해 즉시 등록된 매물입니다. 상세 권리분석 또는 실시간 재분석 버튼을 통해 심층 리포트를 확인하실 수 있습니다.",
                                    "ai_model": "Rule-Engine"
                                }, ensure_ascii=False)
                                from core.geocoder import geocode_address
                                lat_v, lng_v = geocode_address(bi['location'])
                                new_batch.append((
                                    cn, bi['location'], bi.get('usage') or _infer_usage(bi['location']),
                                    app_v, min_v, min_v, 1 if app_v > min_v else 0, "[]", "", 0, 0,
                                    score_v, grade_v, f"감정가 대비 {disc_v}% 할인 매물", f"{int(min_v * 1.03):,}원",
                                    rep_v, now_init, now_init, "Rule-Engine", "NEW",
                                    app_v, margin_v, disc_v, 0, "감정가기준", lat_v, lng_v
                                ))
                        if new_batch:
                            _conn.executemany("""
                                INSERT OR IGNORE INTO auction_items (
                                    case_number, location, usage, appraisal, min_bid, prev_min_bid, failed_count,
                                    rights_list, tenant_registration_date, tenant_deposit, is_payout_requested,
                                    ai_score, ai_grade, ai_verdict, ai_suggested_bid, ai_report_json,
                                    last_updated, created_at, ai_model, status_flag,
                                    market_price, safety_margin, market_discount_pct, market_match_count, market_match_level,
                                    lat, lng
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, new_batch)
                            _conn.commit()
                            console.print(f"[bold green]⚡ Phase 1 신규 매물 {len(new_batch)}건 DB 즉시 등록 완료![/bold green]")
                except Exception as e_init:
                    console.print(f"[dim yellow]⚠️ Phase 1 선등록 예외: {e_init}[/dim yellow]")

                for bi in basic_items:
                    case_number = bi['case_number']
                    appraisal   = bi['appraisal']
                    min_bid     = bi['min_bid']
                    location    = bi['location']
                    usage       = bi.get('usage') or _infer_usage(location)
                    row_id      = bi.get('row_id', -1)

                    # 스마트 증분 스킵: 이미 DB에 존재하고 최저가 변동이 없으며 등기/권리 정보가 있는 경우 상세 XHR 스킵
                    if case_number in existing_map:
                        ex_min_bid, ex_rights = existing_map[case_number]
                        if ex_min_bid and min_bid and ex_min_bid == min_bid and ex_rights and ex_rights != "[]":
                            console.print(f"[dim]⏭️  {case_number} (변동 없음 · 캐시 유지)[/dim]")
                            continue

                    console.print(f"[bold cyan]👉 {case_number} 상세 API 호출 중...[/bold cyan]")

                    matched_cort_code = cort_ofc_cd
                    if bi.get('_seed_detail'):
                        raw_detail = bi['_seed_detail']
                        console.print(f"[dim]📡 상세(seed): 성공[/dim]")
                    elif row_id in row_detail_cache:
                        raw_detail = row_detail_cache[row_id]
                        console.print(f"[dim]📡 상세(캐시): 재사용[/dim]")
                    elif cort_ofc_cd:
                        await asyncio.sleep(random.uniform(1.8, 3.2))
                        try:
                            api_cs_no = _to_api_cs_no(case_number)
                            raw_detail = await page.evaluate(fetch_js, [api_cs_no, cort_ofc_cd])
                            if raw_detail and raw_detail.get('error'):
                                raw_detail = {}
                            elif raw_detail:
                                msg = raw_detail.get('message') or ''
                                if '차단' in msg or '비정상' in msg:
                                    raw_detail = {}
                        except Exception:
                            raw_detail = {}

                        # dspslGdsDxdyInfo 없으면 다른 B-format 법원 코드로 재시도
                        _dma_tmp = (raw_detail.get('data') or {}).get('dma_result') or {}
                        if not _dma_tmp.get('dspslGdsDxdyInfo'):
                            for alt_code in SEOUL_COURT_CODES:
                                if alt_code == cort_ofc_cd:
                                    continue
                                await asyncio.sleep(random.uniform(1.5, 2.5))
                                try:
                                    alt_detail = await page.evaluate(fetch_js, [api_cs_no, alt_code])
                                    if not alt_detail or alt_detail.get('error'):
                                        continue
                                    alt_msg = alt_detail.get('message') or ''
                                    if '차단' in alt_msg or '비정상' in alt_msg:
                                        continue
                                    alt_gds = (alt_detail.get('data') or {}).get('dma_result') or {}
                                    if alt_gds.get('dspslGdsDxdyInfo'):
                                        raw_detail = alt_detail
                                        matched_cort_code = alt_code
                                        break
                                except Exception:
                                    pass

                        console.print(f"[dim]📡 fetch: {'성공' if raw_detail else '실패'}[/dim]")
                    else:
                        raw_detail = {}

                    # ── 현황조사서(임차인 상세) API 호출 ──
                    raw_curst = {}
                    target_cort = matched_cort_code or cort_ofc_cd
                    if target_cort:
                        try:
                            raw_curst = await page.evaluate(fetch_curst_js, [case_number, target_cort])
                            if raw_curst and raw_curst.get('error'):
                                raw_curst = {}
                            elif raw_curst:
                                msg_c = raw_curst.get('message') or ''
                                if '차단' in msg_c or '비정상' in msg_c:
                                    raw_curst = {}
                                else:
                                    c_cnt = len((raw_curst.get('data') or {}).get('dlt_ordTsLserLtn') or [])
                                    if c_cnt > 0:
                                        console.print(f"[bold green]👥 현황조사서 임차인 {c_cnt}명 확인[/bold green]")
                        except Exception as e_c:
                            console.print(f"[dim yellow]⚠️ 현황조사서 호출 실패: {e_c}[/dim yellow]")

                    # 첫 번째 물건에만 덤프 적용 (이미 저장됐으면 빈 경로 전달)
                    _dump = debug_dump_path if (debug_dump_path and not extracted_items) else ""
                    detail_info = self._parse_detail_json(raw_detail, raw_curst=raw_curst, debug_dump_path=_dump)
                    dma = (raw_detail.get('data') or {}).get('dma_result') or {}
                    api_gds = dma.get('dspslGdsDxdyInfo') or {}
                    if api_gds and row_id not in row_detail_cache:
                        row_detail_cache[row_id] = raw_detail
                    if api_gds.get('aeeEvlAmt') and appraisal == 0:
                        appraisal = int(api_gds['aeeEvlAmt'])
                    if api_gds.get('fstPbancLwsDspslPrc') and min_bid == 0:
                        min_bid = int(api_gds['fstPbancLwsDspslPrc'])

                    # 층수: API 미제공 시 location 문자열에서 fallback 파싱
                    floor = detail_info.get("floor") or 0
                    if not floor:
                        m_floor = re.search(r'(\d+)층', location)
                        if m_floor:
                            floor = int(m_floor.group(1))
                    usage = _infer_usage(location, usage, floor)

                    extracted_items.append({
                        "case_number": case_number,
                        "location": location,
                        "usage": usage,
                        "appraisal": appraisal,
                        "min_bid": min_bid,
                        "failed_count": int(api_gds.get('flbdNcnt') or (1 if appraisal > min_bid else 0)),
                        "rights_list": detail_info["rights_list"],
                        "tenant_registration_date": detail_info["tenant_registration_date"],
                        "tenant_deposit": detail_info["tenant_deposit"],
                        "is_payout_requested": detail_info["is_payout_requested"],
                        "tenants_list": detail_info.get("tenants_list", []),
                        "area_m2": detail_info["area_m2"],
                        "area_pyeong": detail_info["area_pyeong"],
                        "floor": floor,
                        "legal_div_no": detail_info["legal_div_no"],
                        "addr_sgg": detail_info["addr_sgg"],
                        "addr_emd": detail_info["addr_emd"],
                        "auction_date": detail_info.get("auction_date", ""),
                        "remarks": detail_info.get("remarks", ""),
                        "special_rights": detail_info.get("special_rights", "[]"),
                    })

                await browser.close()
                return extracted_items

            except Exception as e:
                console.print(f"[bold red]❌ 실시간 크롤링 중 오류 발생: {e}[/bold red]")
                log_error_event(
                    category=_classify_exception(e),
                    message=f"크롤러 최상위 예외 — {e}",
                    context={"region": region, "page_url": page.url if page else "unknown"},
                    exc=e,
                )

                screenshot_path = "auction_debug_screenshot.png"
                try:
                    await page.screenshot(path=screenshot_path)
                    console.print(f"[dim]📸 디버깅용 스크린샷이 저장되었습니다: {screenshot_path}[/dim]")
                except Exception:
                    pass

                await browser.close()
                return []

# --- Module 3: AI Analyzer (Gemini / GPT-4o) ---
class AuctionAnalyzer:
    def __init__(self, api_key: Optional[str] = None):
        resolved_key = api_key if api_key else os.environ.get("OPENAI_API_KEY")
        self.api_key = resolved_key if resolved_key and resolved_key.strip() != "" else None
        self.gemini_key = os.environ.get("GEMINI_API_KEY")
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def _call_gemini(self, prompt: str, model_name: str = "gemini-3.8-flash") -> dict:
        import urllib.request
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.gemini_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2
            }
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            res = json.loads(text)
            res["ai_model"] = model_name
            return res

    def analyze_item(self, item: dict, rights: dict) -> dict:
        discount_rate = rights.get('discount_rate', 0)
        failed_count = rights.get('failed_count', 0)
        warnings = rights.get('warnings', [])
        warnings_str = "\n        ".join([f"⚠️ {w}" for w in warnings]) if warnings else "없음"

        prompt = f"""
        당신은 대한민국 최고의 부동산 경매 전문가 및 감정평가사입니다.
        다음 실시간 수집된 실제 법원경매 물건을 정밀 가치 평가하여 세부적인 투자 의견을 주십시오.

        [물건 정보]
        - 사건번호: {item['case_number']}
        - 소재지: {item['location']}
        - 감정가: {item['appraisal']:,}원
        - 최저매각가격: {item['min_bid']:,}원
        - 감정가 대비 할인율: {discount_rate}%
        - 유찰횟수: {failed_count}회

        [시스템 권리분석 엔진 결과]
        - 위험 등급: {rights['risk_level']} (SAFE, WARNING, CRITICAL 중 하나)
        - 판단 근거: {rights['reason']}
        - 예상 인수금액: {rights['estimated_loss']:,}원
        - 말소기준권리일: {rights.get('malso_standard', '정보없음')}

        [자동 감지된 위험 경고]
        {warnings_str}

        당신의 임무는 대한민국 경매 실무에 입각하여 다음 지표들을 도출하는 것입니다:
        1. 감정가 및 권리관계를 기반으로 한 '합리적 예상 낙찰가 범위(원화)' 제안 (단, 감정가 및 최저가가 모두 0원일 경우, 감정가 부재 상태임을 명시하고 인근 실거래가 기반 보수적 평가 후 입찰을 권고하십시오.)
        2. 낙찰 후 등기부 상에서 '말소되는 권리'와 '인수해야 할 권리' 목록 작성
        3. 권리 등급이 UNKNOWN(등기정보 파싱 불가)인 경우 score를 40점 이하로 제한하고 직접 등기부 확인을 강력 권고하십시오.
        4. 임차인 정보가 '정보없음'인 경우 임차인 리스크를 보수적으로 평가(최소 WARNING 수준)하십시오.
        5. 할인율이 70% 이상이거나 유찰이 5회 이상인 경우, 지분경매·특수물건·법적 하자 가능성을 반드시 분석하고 score와 buy_signal에 적극 반영하십시오.

        반드시 JSON 형식으로만 응답하십시오:
        {{
          "score": 0-100,
          "grade": "A-D",
          "verdict": "권리분석 및 가치 종합 한줄 판정",
          "buy_signal": boolean,
          "expected_yield": "예상 실효 수익률 %",
          "suggested_bid": "적정 추천 입찰 금액 범위 (예: 25,500,000원 ~ 26,000,000원)",
          "extinguished_rights": ["말소권리1", "말소권리2"],
          "retained_rights": ["인수권리1 (없다면 '없음')"],
          "key_points": ["가치 요인1", "입지적 장점2"],
          "risks": ["현장 리스크1", "권리 리스크2"],
          "analysis_detail": "경매 전문가 관점의 종합적이고 정밀한 분석 리포트 내용 (한국어)"
        }}
        """
        try:
            # 1순위: Gemini API (무료 티어 / Gemini Pro 키)
            if self.gemini_key:
                for g_model in ("gemini-3.8-flash", "gemini-flash-latest"):
                    try:
                        return self._call_gemini(prompt, g_model)
                    except Exception:
                        continue

            if not self.client or not self.api_key:
                raise ValueError("Gemini 또는 OpenAI API Key가 설정되지 않았거나 올바르지 않습니다.")

            response = self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "system", "content": "부동산 경매 전문가 및 전문 감정평가사 AI 컨설턴트입니다."},
                          {"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            if not content:
                raise ValueError("API가 빈 응답(Empty content)을 반환했습니다.")
            res = json.loads(content)
            res["ai_model"] = OPENAI_MODEL
            return res
        except Exception as e:
            console.print(f"[bold red]⚠️ AI 분석 중 오류 발생: {e}. 엔진 결과 기반 백업 데이터로 대체 출력합니다.[/bold red]")
            log_error_event(
                category=ErrorCategory.API_ERROR,
                message=f"OpenAI 분석 실패 — {type(e).__name__}",
                context={"case_number": item.get("case_number", "unknown"), "model": OPENAI_MODEL},
                exc=e,
            )
            return {
                "score": 15 if rights.get('risk_level') == "CRITICAL" else 85,
                "grade": "D" if rights.get('risk_level') == "CRITICAL" else "A",
                "verdict": f"시스템 권리 분석: {rights.get('reason', '데이터 확인 필요')}",
                "buy_signal": False if rights.get('risk_level') == "CRITICAL" else True,
                "expected_yield": "0% 이하" if rights.get('risk_level') == "CRITICAL" else "6-8%",
                "suggested_bid": f"{item['min_bid']:,}원 부근 (보수적 입찰 추천)",
                "extinguished_rights": ["소멸기준 등기부상 모든 후순위 제한물권"],
                "retained_rights": ["선순위 대항력 임차보증금 인수 가능성 확인 필요" if rights.get('risk_level') == "CRITICAL" else "없음"],
                "key_points": ["추천 입찰 및 세무 상담 후 낙찰 계획 수립 필요"],
                "risks": [rights.get('reason', '상세 리스크 분석 대기')],
                "analysis_detail": f"OpenAI API 호출이 비활성화되었거나 API 키 미등록 등의 문제로 룰 기반 권리분석 결과를 토대로 시스템 리포트를 구성했습니다. 본 부동산의 권리 판정 등급은 공식적으로 {rights.get('risk_level')} 상태입니다.",
                "ai_model": "Rule-Engine"
            }

# --- Main Execution ---
async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="서울")
    parser.add_argument("--max-items", type=int, default=2)
    parser.add_argument("--property-type", default="", help="0203: 상가, 0205: 오피스텔, 0201: 아파트 등")
    parser.add_argument("--no-headless", action="store_true", help="브라우저 화면 및 개발자 도구를 보여줍니다.")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--debug-dump", default="", metavar="FILE",
                        help="첫 번째 물건의 API 응답(dma_result)을 JSON 파일로 저장 (필드명 확인용)")
    parser.add_argument("--force-reanalyze", action="store_true",
                        help="DB에 이미 있는 물건도 강제 재분석 (캐시 무시, AI 토큰 소모)")
    parser.add_argument("--reanalyze-db", action="store_true",
                        help="크롤링 없이 DB 전체 물건을 AI 재분석 (권리분석엔진 재실행 포함)")
    args = parser.parse_args()

    global BUILDING_TYPE_CODE
    if args.property_type:
        BUILDING_TYPE_CODE = args.property_type

    # 데이터베이스 추적 및 상태 보존을 위한 DBAgent 인스턴스 초기화
    db_agent = AuctionDBAgent()

    # ── DB 전체 재분석 모드 ──────────────────────────────────────────────────
    if args.reanalyze_db:
        engine = RightsAnalysisEngine()
        analyzer = AuctionAnalyzer(api_key=args.api_key)
        with sqlite3.connect(DB_FILE_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM auction_items").fetchall()

        console.print(f"[bold yellow]🔄 DB 재분석 시작: {len(rows)}개 물건[/bold yellow]")
        for row in rows:
            item = dict(row)
            item['rights_list'] = json.loads(item['rights_list']) if item['rights_list'] else []
            item['is_payout_requested'] = bool(item['is_payout_requested'])

            malso_dt = engine.find_malso_standard(item['rights_list'])
            tenant_dt = engine.parse_date(item.get('tenant_registration_date') or '')
            rights_report = engine.analyze_tenant_risk(
                malso_dt, tenant_dt, item.get('tenant_deposit', 0), item['is_payout_requested'],
                appraisal=item.get('appraisal', 0),
                min_bid=item.get('min_bid', 0),
                failed_count=item.get('failed_count', 0),
            )
            ai_report = analyzer.analyze_item(item, rights_report)
            db_agent.upsert_auction_item(item, ai_report, rights_report)
            disc = round((1 - item['min_bid'] / item['appraisal']) * 100) if item['appraisal'] else 0
            console.print(f"  [dim]{item['case_number']}[/dim] → "
                          f"[{'green' if ai_report['score'] >= 70 else 'yellow' if ai_report['score'] >= 40 else 'red'}]"
                          f"{ai_report['score']}점 {ai_report['grade']}[/] "
                          f"(할인 {disc}%, 유찰 {item.get('failed_count', 0)}회)")
        console.print(f"[bold green]✅ DB 재분석 완료[/bold green]")
        return
    crawler = AuctionCrawler(headless=not args.no_headless)
    engine = RightsAnalysisEngine()
    analyzer = AuctionAnalyzer(api_key=args.api_key)

    # 지역에 따라 법원 목록 결정
    all_known_courts = {**SEOUL_COURTS, **GYEONGGI_COURTS}
    if args.region == "서울":
        court_list = SEOUL_COURTS
    elif args.region == "경기":
        court_list = GYEONGGI_COURTS
    elif args.region in ("전체", "수도권"):
        court_list = all_known_courts
    else:
        court_list = {args.region: all_known_courts.get(args.region, "")}

    console.print(f"[bold yellow]🔍 {args.region} 전체 법원 수집 시작 (법원 {len(court_list)}개, 법원당 최대 {args.max_items}개)[/bold yellow]")

    try:
        from core.market_matcher import MarketMatcher
        market_matcher = MarketMatcher()
    except Exception:
        market_matcher = None

    def _build_rule_report(item_d: dict, rights_r: dict) -> dict:
        rl = rights_r.get('risk_level', 'SAFE')
        app_v = item_d.get('appraisal') or 0
        min_v = item_d.get('min_bid') or 0
        disc_v = round((1 - min_v / app_v) * 100, 1) if app_v > 0 and min_v > 0 else 0.0
        if rl == "CRITICAL":
            score, grade = 25, "D"
        elif rl == "WARNING":
            score, grade = 55, "C"
        else:
            if disc_v >= 30:
                score, grade = 88, "A"
            elif disc_v >= 15:
                score, grade = 78, "B"
            else:
                score, grade = 68, "B"
        return {
            "score": score,
            "grade": grade,
            "verdict": f"시스템 정밀 권리분석 ({rl}): {rights_r.get('reason', '권리 상태 양호')} (할인율 {disc_v}%)",
            "buy_signal": rl == "SAFE" and disc_v >= 15,
            "expected_yield": "6~9%" if rl == "SAFE" else "보수적 접근 필요",
            "suggested_bid": f"{int(min_v * 1.03):,}원 부근" if min_v > 0 else "입찰가 산정 대기",
            "extinguished_rights": ["말소기준권리 이후 후순위 제한물권 일체"],
            "retained_rights": ["선순위 임차보증금 인수 주의" if rl == "CRITICAL" else "없음"],
            "key_points": [f"감정가 대비 {disc_v}% 할인 매물", f"유찰 {item_d.get('failed_count', 0)}회 진행"],
            "risks": [rights_r.get('reason', '현장 임장 및 관리비 확인 필수')],
            "analysis_detail": f"법원 현황조사서 및 매각물건명세서 기반 자동 권리분석 완료 물건입니다. 권리 위험도는 [{rl}]이며, 상세 모달에서 [실시간 재분석]을 누르시면 GPT-4o-mini 심층 컨설팅 리포트를 즉시 받아보실 수 있습니다.",
            "ai_model": "Rule-Engine"
        }

    items = []
    change_history = []
    final_results = []
    _dump_done = False

    for court_name, b_code in court_list.items():
        label = f"{court_name} ({b_code})" if b_code else court_name
        console.print(f"\n[cyan]📍 {label} 검색 중...[/cyan]")
        try:
            _dump_path = args.debug_dump if (args.debug_dump and not _dump_done) else ""
            court_items = await crawler.search(region=court_name, max_items=args.max_items, court_code=b_code,
                                               debug_dump_path=_dump_path)
            if _dump_path and court_items:
                _dump_done = True
            if court_items:
                console.print(f"[green]  ✅ {court_name}: 신규/변경 {len(court_items)}개 상세 수집 완료 -> 즉시 DB 저장 중...[/green]")
                items.extend(court_items)
                for item in court_items:
                    malso_dt = engine.find_malso_standard(item['rights_list'])
                    tenant_dt = engine.parse_date(item.get('tenant_registration_date'))
                    rights_report = engine.analyze_tenant_risk(
                        malso_dt, tenant_dt, item['tenant_deposit'], item['is_payout_requested'],
                        appraisal=item.get('appraisal', 0),
                        min_bid=item.get('min_bid', 0),
                        failed_count=item.get('failed_count', 0),
                    )
                    existing_item = db_agent.get_existing_item(item['case_number'])
                    is_price_changed = existing_item and existing_item['min_bid'] != item['min_bid']
                    is_tenant_changed = existing_item and (
                        existing_item.get('tenant_registration_date') != item.get('tenant_registration_date') or
                        existing_item.get('tenant_deposit') != item.get('tenant_deposit')
                    )
                    use_cache = existing_item and not is_price_changed and not is_tenant_changed and not args.force_reanalyze

                    if use_cache:
                        ai_report = existing_item['ai_report_json']
                        if isinstance(ai_report, str):
                            try:
                                ai_report = json.loads(ai_report)
                            except Exception:
                                ai_report = {}
                        if item.get('tenants_list'):
                            ai_report['tenants'] = item['tenants_list']
                        status_flag = "UNCHANGED"
                        prev_min_bid = existing_item['min_bid']
                        db_agent.upsert_auction_item(item, ai_report, rights_report)
                    else:
                        # 스마트 하이브리드: 아파트/오피스텔/상가 중 감정가/최저가 정상이고 특수권리/치명적 위험이 없는 핵심 물건은 GPT-4o-mini, 그 외 대량 물건은 Rule-Engine 즉시 처리
                        u_type = item.get('usage') or ''
                        is_prime = (
                            item.get('appraisal', 0) > 0 and
                            item.get('min_bid', 0) > 0 and
                            rights_report.get('risk_level') != 'CRITICAL' and
                            any(k in u_type for k in ('아파트', '오피스텔', '상가'))
                        )
                        if is_prime:
                            ai_report = analyzer.analyze_item(item, rights_report)
                        else:
                            ai_report = _build_rule_report(item, rights_report)
                        if item.get('tenants_list'):
                            ai_report['tenants'] = item['tenants_list']
                        status_flag, prev_min_bid = db_agent.upsert_auction_item(item, ai_report, rights_report)

                    # 네이버 시세 매칭 및 진짜 안전마진 즉시 업데이트
                    if market_matcher:
                        try:
                            full_row = db_agent.get_existing_item(item['case_number']) or item
                            m_res = market_matcher.match_item(full_row)
                            with sqlite3.connect(DB_FILE_PATH) as _mconn:
                                _mconn.execute("""
                                    UPDATE auction_items
                                    SET market_price=?, safety_margin=?, market_discount_pct=?,
                                        market_match_count=?, market_match_level=?, est_monthly_rent=?, rental_yield=?
                                    WHERE case_number=?
                                """, (
                                    m_res["market_price"], m_res["safety_margin"], m_res["market_discount_pct"],
                                    m_res["market_match_count"], m_res["market_match_level"],
                                    m_res["est_monthly_rent"], m_res["rental_yield"], item['case_number']
                                ))
                                _mconn.commit()
                        except Exception:
                            pass

                    final_results.append({**item, "rights": rights_report, "ai": ai_report})
                    change_history.append({
                        "case_number": item['case_number'],
                        "location": item['location'],
                        "status": status_flag,
                        "current_min": item['min_bid'],
                        "prev_min": prev_min_bid if prev_min_bid else item['min_bid']
                    })
            else:
                console.print(f"[yellow]  ⚠️ {court_name}: 신규/변경 물건 없음[/yellow]")
        except Exception as e:
            console.print(f"[red]  ❌ {court_name} 수집 실패: {e}[/red]")
            log_error_event(
                category=_classify_exception(e),
                message=f"{court_name} 수집 실패 — {e}",
                context={"court": court_name, "b_code": b_code},
                exc=e,
            )

    if not items:
        console.print("[bold green]✅ 모든 물건이 최신 상태이거나 추가 수집할 물건이 없습니다.[/bold green]")
        return

    # ==========================================
    # 📊 실시간 경매 물건 업데이트 에이전트 대시보드 출력
    # ==========================================
    console.print("\n" + "═"*90)
    console.print("   [bold magenta]📡 실시간 법원경매 에이전트 변경 감지 모니상황 (SQLite DB 동기화)[/bold magenta]")
    console.print("═"*90 + "\n")

    history_table = Table(box=None, padding=(0, 2), expand=True)
    history_table.add_column("📋 사건번호", style="bold white")
    history_table.add_column("📍 소재지", style="dim")
    history_table.add_column("📢 상태", style="bold")
    history_table.add_column("💰 이전 최저가", style="dim", justify="right")
    history_table.add_column("📉 최신 최저가", style="bold yellow", justify="right")
    history_table.add_column("⚡ 변동 내역", style="cyan")

    for chg in change_history:
        status_style = "green" if chg['status'] == "NEW" else "bold red" if chg['status'] == "UPDATED" else "dim white"
        status_text = "✨ 신규" if chg['status'] == "NEW" else "📉 유찰(감액)" if chg['status'] == "UPDATED" else "⏸️ 변동없음"
        
        diff_text = "-"
        if chg['status'] == "UPDATED":
            diff_amount = chg['prev_min'] - chg['current_min']
            diff_pct = (diff_amount / chg['prev_min']) * 100
            diff_text = f"[bold red]▼ {diff_amount:,}원 (-{diff_pct:.1f}%)[/bold red]"
        elif chg['status'] == "NEW":
            diff_text = "[bold green]최초 동기화 등록[/bold green]"

        history_table.add_row(
            chg['case_number'],
            chg['location'][:25] + "..." if len(chg['location']) > 25 else chg['location'],
            f"[{status_style}]{status_text}[/{status_style}]",
            f"{chg['prev_min']:,}원",
            f"{chg['current_min']:,}원",
            diff_text
        )
    console.print(Panel(history_table, title="[bold white]🔄 실시간 데이터베이스 변경 로그[/bold white]", border_style="magenta"))

    console.print("\n" + "="*90)
    console.print(f"  [bold cyan]🏠 실시간 법원경매 분석 리포트 ({args.region})[/bold cyan]")
    console.print("="*80 + "\n")

    for i, res in enumerate(final_results):
        ai = res['ai']
        rights = res['rights']
        
        risk_color = "red" if rights['risk_level'] == "CRITICAL" else "yellow" if rights['risk_level'] == "WARNING" else "green"
        score_color = "green" if ai['score'] >= 70 else "yellow" if ai['score'] >= 40 else "red"

        summary_text = Text()
        summary_text.append(f"📍 소재지: {res['location']}\n", style="bold white")
        summary_text.append(f"💰 감정가: {res['appraisal']:,}원  |  ", style="dim")
        summary_text.append(f"📉 최저가: {res['min_bid']:,}원\n", style="bold yellow")
        summary_text.append(f"⚖️ 권리위험: {rights['risk_level']}", style=f"bold {risk_color}")
        summary_text.append(f" ({rights['reason']})\n", style="dim")
        summary_text.append(f"🎯 AI 점수: {ai['score']}점 ({ai['grade']}등급)", style=f"bold {score_color}")

        console.print(Panel(summary_text, title=f"물건 #{i+1}: {res['case_number']}", expand=True, border_style="cyan"))

        detail_table = Table(show_header=False, box=None, padding=(0, 2), expand=True)
        detail_table.add_row("💡 한줄 판정", ai.get('verdict', 'N/A'))
        detail_table.add_row("📈 예상 수익률", f"[bold green]{ai.get('expected_yield', 'N/A')}[/bold green]")
        detail_table.add_row("🎯 추천 입찰가", f"[bold yellow]{ai.get('suggested_bid', '정보없음')}[/bold yellow]")
        detail_table.add_row("🎯 매수 신호", "✅ [bold green]BUY[/bold green]" if ai.get('buy_signal') else "❌ [bold red]PASS[/bold red]")
        console.print(detail_table)

        rights_table = Table(title="[bold white]📋 등기부 소멸 및 인수 가이드라인[/bold white]", box=None, padding=(0, 1), expand=True)
        rights_table.add_column("🗑️ 소멸(삭제)되는 권리 (안전)", style="green", ratio=1)
        rights_table.add_column("⚠️ 낙찰자가 인수하는 권리 (위험)", style="red", ratio=1)
        
        ext_list = ai.get('extinguished_rights', [])
        ret_list = ai.get('retained_rights', [])
        max_len = max(len(ext_list), len(ret_list))
        for idx in range(max_len):
            ext_val = f"• {ext_list[idx]}" if idx < len(ext_list) else ""
            ret_val = f"• {ret_list[idx]}" if idx < len(ret_list) else ""
            rights_table.add_row(ext_val, ret_val)
        console.print(Panel(rights_table, border_style="dim"))

        points_content = "\n".join([f" • {p}" for p in ai.get('key_points', [])])
        risks_content = "\n".join([f" • {r}" for r in ai.get('risks', [])])
        console.print(Columns([
            Panel(points_content, title="[green]투자 포인트[/green]", border_style="green", expand=True),
            Panel(risks_content, title="[red]핵심 리스크[/red]", border_style="red", expand=True)
        ]))
        
        console.print(f"\n[dim]📝 전문가 분석: {ai.get('analysis_detail', '상세 내용 없음')}[/dim]")
        console.print("\n" + "┈" * 80 + "\n")

if __name__ == "__main__":
    asyncio.run(main())