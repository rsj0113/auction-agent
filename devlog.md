# 경매 에이전트 개발 일지

## 2026-05-25

### 오늘 한 일

#### 1. 전체 서울 법원 순회 기능 추가
기존에는 서울중앙지방법원 단 하나만 검색하고 있었음.
사용자가 직접 법원경매 사이트에서 신대방동 물건을 확인했는데 크롤러에는 잡히지 않아서 문제 발견.

신대방동(동작구)은 **서울남부지방법원** 관할 → 크롤러가 아예 보지 않던 법원.

**수정 내용**
- `SEOUL_COURTS` 딕셔너리 상수 추가 (법원명 → B-코드 매핑)
- `main()`에서 법원별 루프 실행, 결과 합산

```python
SEOUL_COURTS = {
    "서울중앙지방법원": "B000210",
    "서울동부지방법원": "B000220",
    "서울남부지방법원": "B000230",
    "서울북부지방법원": "B000240",
    "서울서부지방법원": "B000250",
}
```

---

#### 2. 날짜 범위 확장 시도 → 사이트 제한 확인

비로그인 상태에서는 **검색 기간 2주 이내** 제한이 걸려 있음.
날짜를 3개월/6개월로 늘리려 했으나 사이트에서 알림창으로 차단.
날짜 확장은 로그인 없이는 불가능하다고 판단, 해당 코드 제거.

---

#### 3. 법원 드롭다운 선택 방식 수정

법원 선택 JS가 제대로 작동하지 않아 항상 서울중앙지방법원(기본값)만 검색되던 문제.

**원인 파악**
- 드롭다운 옵션의 `value`가 B-코드가 아니라 **법원명 그 자체** (`"서울남부지방법원"`)
- `comp.setValue(b_code)` 방식은 인식 실패 → WebSquare가 "전체"로 설정 후 경고창 띄움
- 경고창이 검색을 막아 타임아웃 발생

**해결책**
- DOM 옵션에서 법원명으로 인덱스를 찾고 `comp.setSelectedIndex(i)` 호출

**확인된 cortOfcCd 매핑**
| 법원 | cortOfcCd |
|------|-----------|
| 서울중앙 | B000210 |
| 서울동부 | B000211 |
| 서울남부 | B000212 |
| 서울북부 | B000213 |
| 서울서부 | B000215 |

---

#### 4. 실행 결과

5개 법원 전부 성공, 총 10개 물건 수집.

| 법원 | 수집 물건 |
|------|-----------|
| 서울중앙 | 종로구 평창동 |
| 서울동부 | 송파구 거여동, 성동구 홍익동 |
| 서울남부 | 구로구 개봉동, 금천구 독산동 |
| 서울북부 | 성북구 삼선동, 동대문구 청계천로 |
| 서울서부 | 서대문구 연희동 |

---

#### 5. CLI 리포트 (report.py) 추가

DB에 저장된 물건을 터미널에서 빠르게 조회할 수 있는 스크립트.

```bash
python report.py                        # 전체 목록 (기본 20건)
python report.py --limit 50            # 최대 50건
python report.py --grade A             # A등급만
python report.py --score 80            # 80점 이상만
python report.py --detail 2023타경5882  # 특정 물건 상세 조회
```

---

#### 6. 웹 대시보드 (dashboard.py) 추가

Streamlit 기반 브라우저 대시보드.

```bash
streamlit run dashboard.py
# → http://localhost:8501
```

**기능**
- 좌측 사이드바: AI 점수 슬라이더, 등급 필터, 소재지 키워드 검색
- 상단 지표 카드: 전체/A등급/B등급 건수, 평균 점수
- 물건 목록 테이블: 컬럼 클릭 정렬 가능
- 물건 상세: 투자 포인트, 핵심 리스크, 전문가 분석 전문

---

#### 7. AI 모델 변경

`gpt-4o-mini` → `gpt-4.1-nano` (OpenAI 최저가 모델)

---

---

## 2026-05-25 (계속)

### 임차인·권리관계 파서 고도화

#### 1. 가짜 fallback 제거

`_parse_detail_json()`과 `_scrape_detail_page()` 두 곳에 있던 하드코딩 기본값 제거.

```python
# 제거 전 (실제 데이터 없을 때 분석을 오염시킴)
if not rights_list:
    rights_list = [{"name": "근저당", "date": "2023.01.01"}]
if not tenant_registration_date:
    tenant_registration_date = "2024.01.01"
```

이제 데이터 없으면 `rights_list=[]`, `tenant_registration_date=""` 그대로 반환.

#### 2. `tprtyRnkHypthcStngDts` 파서 강화

기존: 개행 기준 분리 후 한 줄에 키워드 하나  
개선: 두 단계 파싱

| 케이스 | 처리 방식 |
|--------|-----------|
| 개행 있는 텍스트 | 개행 분리 후 세그먼트별 날짜+키워드 추출 |
| 개행 없는 연속 텍스트 | `finditer`로 (키워드→날짜) / (날짜→키워드) 패턴 스캔 |

`근저당`/`저당` 오분류 버그(lookahead split이 `근`과 `저당` 위치를 각각 분리) → `finditer` 방식으로 수정.
`담보가등기 > 근저당 > 가압류 > 경매개시결정 > 경매개시 > 압류 > 저당` 우선순위로 긴 키워드 먼저 매칭.

#### 3. 임차인 필드 탐색 범위 확장

알려진 키: `lseeInfo`, `tnntInfo`, `lseeStusInfo`, `tenantInfo`, `lseeCntnInfo`, `tnntCntnInfo`, `lseeDtlInfo`

→ 모두 없으면 `dma_result` 전체를 순회하여 날짜 필드(`mvInYmd`, `entnYmd`, `rgstnYmd` 등)를 가진 dict를 자동 탐색.

보증금 필드도 확장: `lseDposAmt`, `posAmt`, `dposAmt`, `chrtgrAmt`, `tnntDposAmt`

#### 4. `analyze_tenant_risk` UNKNOWN 케이스 보완

말소기준권리를 못 찾아도(`malso_date=None`) 할인율·유찰횟수 경고는 계속 실행.

```python
# 이전: UNKNOWN이면 즉시 return → 할인율 97%여도 경고 없음
# 이후: UNKNOWN이어도 discount_rate, failed_count 체크 후 warnings 반환
```

#### 5. `--debug-dump` 플래그 추가

```bash
python auto_crawling.py --debug-dump raw_dump.json
```

첫 번째 물건의 `dma_result` 전체를 JSON 저장 → 실제 필드명 확인용.
추후 임차인 키 파악에 사용 가능.

#### 6. AI 프롬프트 보완

- UNKNOWN 등급: score 40점 이하 제한 + 등기부 직접 확인 강제 권고
- 임차인 정보없음: 보수적 평가(최소 WARNING 수준) 지시

---

---

### 실행 테스트 결과 (2026-05-25)

`python auto_crawling.py --max-items 1 --debug-dump raw_dump.json` 실행.

#### 확인된 사항

**1. 97% 할인 물건 재평가 성공**

| 항목 | 이전 | 이후 |
|------|------|------|
| 2023타경5882 (구로구, 16회 유찰) | 85점 A등급 BUY | **35점 D등급 PASS** |

경고 메시지 포함: `"감정가 대비 97.2% 할인 — 지분경매·특수권리 확인 필요"`, `"16회 유찰 — 근본 원인 파악 필수"`

**2. 실제 API 형식 파악 (`--debug-dump`)**

`tprtyRnkHypthcStngDts` 실제 값: `"2022.06.07.근저당권"`

- 형식: `날짜.키워드` (점으로 이어짐, 개행 없음)
- finditer 방식으로 정확히 파싱됨: `{'name': '근저당', 'date': '2022.06.07'}`
- 추가로 `dstrtDemnInfo`에서 `경매개시결정 2023.09.11` 자동 추출

**3. 임차인 필드 구조 파악**

실제 `dma_result` 최상위 키 목록:
```
csBaseInfo, dstrtDemnInfo, dspslGdsDxdyInfo,
picDvsIndvdCnt, csPicLst, gdsDspslDxdyLst,
gdsDspslObjctLst, rgltLandLstAll, bldSdtrDtlLstAll,
gdsNotSugtBldLsstAll, gdsRletStLtnoLstAll, aeeWevlMnpntLst
```

토지 물건은 임차인 정보 자체가 없음. `bldSdtrDtlLstAll`이 임차인 후보 키 (빈 배열이었음).
가짜 fallback이 없어서 `tenant_registration_date=""` → SAFE로 올바르게 처리됨.

**4. 서울중앙지방법원 타임아웃**

1회 접속 시 타임아웃 발생 (네트워크 문제). 재실행 시 정상 작동하는 간헐적 이슈.

---

---

#### 7. AI 점수 캐시 문제 → `--reanalyze-db` 추가

**발견된 문제**: `--force-reanalyze`는 이번 크롤링 물건만 재분석. 이전 세션 DB 항목은 UNCHANGED 캐시 유지 → 99% 할인 물건도 85점 그대로.

**원인**: 가짜 fallback으로 분석된 구 데이터가 DB에 남아 있고 가격 변동이 없으면 재분석 안 됨.

**해결**: `--reanalyze-db` 플래그 추가. 크롤링 없이 DB 전체 물건을 권리분석엔진 + AI 재호출.

```bash
python auto_crawling.py --reanalyze-db
```

**재분석 전후 비교 (주요 항목)**

| 사건번호 | 위치 | 할인 | 유찰 | 이전 | 이후 |
|----------|------|------|------|------|------|
| 2023타경5882 | 구로구 | 97% | 16회 | 85점 A | **35점 D** |
| 2023타경1173 | 동대문구 | 99% | 19회 | 85점 B | **35점 D** |
| 2024타경4880 | 종로구 | 99% | 5회 | 85점 B | **35점 D** |
| 2023타경104819 | 금천구 | 59% | 19회 | 85점 B | **65점 C** |
| 2022타경112823 | 성북구 | 0% | 0회 | 85점 A | **85점 A** (유지) |

---

### 남은 과제

- [ ] 경기도 법원 추가 (`GYEONGGI_COURTS` 현재 비어 있음)
- [ ] 주거용 물건에서 `bldSdtrDtlLstAll` 임차인 파싱 검증 (현재까지 토지 물건만 테스트)
- [ ] 로그인 연동으로 날짜 범위 2주 제한 해제 검토

---

## 2026-05-30

### 현황 점검 (코드 기준 재확인)

이전 세션이 토큰 만료로 종료된 후, 코드(`auto_crawling.py` 1304줄) 전체를 재확인.

#### 완료 확인된 항목

| 항목 | 상태 | 비고 |
|------|------|------|
| 상세 페이지 XHR 캡처 | ✅ 완료 | `moveDtlPage` + response 리스너 |
| min_bid=0 버그 수정 | ✅ 완료 | `fstPbancLwsDspslPrc` 보정 |
| 2번째 이후 XHR 캡처 | ✅ 완료 | 하이브리드 방식 (fetch 직접 호출) |
| 전체 서울 법원 순회 | ✅ 완료 | 5개 법원 `SEOUL_COURTS` 루프 |
| 권리관계 파싱 | ✅ 완료 | `finditer` 방식, 긴 키워드 우선 매칭 |
| 임차인 파싱 | ✅ 완료 | TENANT_KEYS 7개 + dma 전체 순회 fallback |
| 가짜 fallback 제거 | ✅ 완료 | 데이터 없으면 빈값 반환 |
| UNKNOWN 케이스 보완 | ✅ 완료 | 할인율·유찰횟수 경고는 말소기준 없어도 실행 |
| `--debug-dump` 플래그 | ✅ 완료 | dma_result 전체 JSON 저장 |
| `--reanalyze-db` 플래그 | ✅ 완료 | DB 전체 재분석 |
| AI 모델 | ✅ 완료 | `gpt-4.1-nano` |
| report.py (CLI 리포트) | ✅ 완료 | |
| dashboard.py (Streamlit) | ✅ 완료 | |

#### 메모리 오류 정정

이전 메모리에 "임차인 정보 미확인", "권리관계 부분 추출"이라고 기록되어 있었으나 **실제로는 모두 구현 완료** 상태. 토지 물건 기준으로 정상 동작 확인됨.

#### 남은 과제 (미해결)

- [x] `GYEONGGI_COURTS` — 경기도 법원 추가 완료 (2026-05-30)
- [ ] 주거용 물건 임차인 파싱 검증 — `bldSdtrDtlLstAll` 키에 실제 임차인 데이터가 들어오는지 확인 필요 (현재까지 토지 물건만 테스트)
- [ ] 로그인 연동 — 비로그인 2주 제한 해제 검토

---

## 2026-05-30 (계속)

### 경기도 법원 추가

#### 1. 드롭다운 옵션 확인

Playwright 스크립트로 courtauction.go.kr 드롭다운 61개 옵션 전체 추출.
경기도 관할 법원 9개 확인:

| 드롭다운 value | 지역 |
|---|---|
| 수원지방법원 | 수원·화성·오산 |
| 성남지원 | 성남·광주·하남 |
| 여주지원 | 여주·이천·양평 |
| 평택지원 | 평택·안성 |
| 안산지원 | 안산·광명·시흥 |
| 안양지원 | 안양·과천·의왕·군포 |
| 의정부지방법원 | 의정부·양주·동두천·연천·포천 |
| 고양지원 | 고양·파주 |
| 남양주지원 | 남양주·구리·가평 |

드롭다운 value가 법원명 그 자체여서 기존 `setSelectedIndex` 매칭 방식 그대로 사용.

#### 2. 코드 변경

- `GYEONGGI_COURTS` 딕셔너리 9개 법원으로 채움
- B-코드는 API 응답에서 자동 추출되므로 빈값(`""`) 사용
- 콘솔 출력에서 B-코드 없는 법원은 괄호 생략하도록 수정

```bash
python auto_crawling.py --region 경기 --max-items 2
```

#### 3. 테스트 결과

9개 법원 전부 성공, 에러 없음.

| 법원 | cortOfcCd (API 실측) |
|---|---|
| 수원지방법원 | B000250 |
| 성남지원 | B000251 |
| 여주지원 | B000252 |
| 평택지원 | (자동 추출) |
| 안산지원 | (자동 추출) |
| 안양지원 | (자동 추출) |
| 의정부지방법원 | (자동 추출) |
| 고양지원 | (자동 추출) |
| 남양주지원 | (자동 추출) |

#### 남은 과제

- [ ] 주거용 물건 임차인 파싱 검증
- [ ] 로그인 연동 (날짜 제한 해제)

---

## 2026-05-31

### 24시간 자율 DevOps 파이프라인 구축 — 1단계

경매 에이전트를 단순 스크립트에서 24시간 무인 운영 시스템으로 확장하기 위한 3인 에이전트 체제 기반 작업.

#### 배경

크롤러가 IP 차단이나 파싱 에러로 조용히 실패해도 현재는 알아차릴 방법이 없음.
에러를 구조화해서 외부 에이전트(헤르메스)가 자동 감지하고, 수정은 야간 에이전트(에이더)가 자동으로 처리하는 파이프라인을 설계.

---

#### 1. 에이전트 역할 분담 확정

| 에이전트 | 채널 | 역할 |
|----------|------|------|
| Claude Code | `#dev-claude` | 수석 아키텍트 — 설계·핵심 코드·main 머지 |
| Hermes Agent | `#ops-hermes` | 운영 매니저 — 24시간 모니터링·슬랙 리포팅 |
| Aider | 백그라운드 터미널 | 야간 전담 — 에러 로그 기반 자동 디버깅·커밋 |

---

#### 2. 폴더 구조 추가

```
auction_agent/
├── core/
│   ├── logging_system.py   # Hermes용 구조화 JSON 로거
│   └── agent_channels.py   # 에이전트 간 IPC (설계 초안)
├── logs/
│   ├── auction_agent.log   # 텍스트 로그 (5MB × 3 롤링)
│   └── events.jsonl        # Hermes가 읽는 JSONL 이벤트 피드
├── agent_inbox/
│   ├── hermes/             # 크롤러 → Hermes 리포트 드롭존
│   └── aider/              # Hermes → Aider 디버깅 태스크 드롭존
└── tests/
    ├── conftest.py
    ├── test_rights_engine.py
    └── test_db_agent.py
```

---

#### 3. 구조화 로깅 시스템 (`core/logging_system.py`)

기존 `console.print()`는 사람이 보는 UX이기 때문에 건드리지 않고, 구조화 로거를 **병렬**로 추가.

**에러 카테고리 (`ErrorCategory`)**

| 카테고리 | 설명 |
|----------|------|
| `IP_BLOCK` | 사이트 접근 차단·봇 탐지 |
| `PARSE_ERROR` | HTML/XHR 파싱 실패 |
| `API_ERROR` | OpenAI API 오류 |
| `TIMEOUT` | 페이지 로드·응답 타임아웃 |
| `DB_ERROR` | SQLite 쓰기·읽기 오류 |
| `UNKNOWN` | 분류 불가 기타 오류 |

**기록 방식**
- `logs/auction_agent.log` — 사람이 읽기 좋은 텍스트 (5MB × 3개 롤링)
- `logs/events.jsonl` — Hermes가 `tail -f` 또는 watchdog으로 파싱하는 JSONL

**비밀 마스킹**: `sk-...` 형태의 OpenAI API 키는 로그에 기록 전 자동으로 `sk-***REDACTED***` 처리.

**주입 위치**: 내부 best-effort fallback except 블록은 건드리지 않고, 실제 장애를 나타내는 **4개 경계점에만** 추가.

| 경계점 | 카테고리 |
|--------|----------|
| 크롤러 최상위 예외 | `_classify_exception()` 자동 추론 |
| 법원별 루프 예외 | `_classify_exception()` 자동 추론 |
| 전체 0건 가드 | `IP_BLOCK` |
| OpenAI API 예외 | `API_ERROR` |

---

#### 4. 에이전트 간 IPC 설계 초안 (`core/agent_channels.py`)

파일시스템 기반 단방향 메시지 드롭 구조.

```python
# 헤르메스가 에이더에게 디버깅 태스크 전달
drop_aider_task(
    title="iframe 확보 실패 자동 수정 요청",
    description="...",
    error_log_path="logs/events.jsonl",
    priority="high",
    test_command="python -m pytest tests/ -v",
)

# 크롤러가 헤르메스에게 이벤트 리포팅
drop_hermes_report(
    event_type="crawl_blocked",
    message="서울 전체 0건 수집 — IP 차단 의심",
    context={"region": "서울"},
)
```

**미결 사항 (다음 세션 전 확인 필요)**

- Aider 브랜치 격리 — `night/dev` 브랜치 전용, `main` 직접 커밋 금지 규칙
- Aider 루프 비용 상한 — 야간 GPT-4o-mini 호출 횟수·비용 캡 미설정
- Hermes 슬랙 연동 — OpenAI 종량제 키 + Slack webhook 미연결
- Aider 리시버 watchdog 스크립트 미구현

---

#### 5. 테스트 환경 구축 (`tests/`, `pytest.ini`)

**원칙**: 네트워크·OpenAI·Playwright 없이 결정론적 실행. Aider의 "100% 통과까지 루프" 전략이 동작하려면 테스트가 외부 의존성에서 자유로워야 함.

**테스트 대상**

`RightsAnalysisEngine` — `test_rights_engine.py` (21개)
- `parse_date()`: 닷/대시/슬래시/8자리 숫자, None·빈값·쓰레기값
- `find_malso_standard()`: 가장 이른 날짜 선택, 비대상 키워드 무시, 빈 목록
- `analyze_tenant_risk()`: SAFE·WARNING·CRITICAL·UNKNOWN 4대 시나리오, 할인율 계산, 극단 할인 경고, 다중유찰 경고, 날짜 포맷

`AuctionDBAgent` — `test_db_agent.py` (13개)
- DB 초기화 및 신규 컬럼 존재 확인
- 상태 머신 `NEW` / `UNCHANGED` / `UPDATED`
- `_cap` 가드: 0원 파싱 시 기존값 보존, 10¹³ 초과값 클리핑
- `rights_list` JSON 직렬화·역직렬화 왕복

**결과**: 34개 전부 통과, 0.53초

```
============================= 34 passed in 0.53s ==============================
```

---

### 남은 과제

- [ ] 주거용 물건 임차인 파싱 검증
- [ ] 로그인 연동 (날짜 제한 해제)
- [ ] Hermes 에이전트 슬랙 연동
- [ ] Aider 브랜치 격리 + 비용 상한 규칙 확정 후 watchdog 스크립트 구현
