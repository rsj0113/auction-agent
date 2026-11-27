# 📱 이지경매 (EasyAuction) 모바일 앱 MVP

> **"경매 용어 1도 몰라도 3초 만에 보는 오늘의 싼 집"**  
> Expo (React Native + TypeScript) + Expo Router 기반 초보자 친화적 경매 큐레이션 모바일 앱.

---

## 🌟 핵심 특징
1. **24시간 무단절 오프라인 퍼스트 아키텍처**:
   - 맥북 ngrok/서버 절전과 무관하게 `mobile_feed.json` 정적 피드를 로드하여 서버비 0원 & 무단절 작동.
2. **초보자 3초 브리핑 문법**:
   - 복잡한 등기부 용어 대신 **한 줄 헤드라인** + **실거래 갭** + **신호등 안심 뱃지(🟢/🟡/🔴)** + **3줄 요약 불릿** 노출.
3. **화면 3종 완비**:
   - 🏠 **오늘의 줍줍 (홈 피드)**: 한 장씩 시원하게 넘겨보는 카드뉴스 스타일 피드 & 상단 칩 필터 (🟢 안심 매물만, 3억 이하, 서울/경기).
   - 📄 **10초 요약 상세**: 큰 숫자 최저가, 준비 보증금(10%) 계산기, 쉬운 권리 3줄 요약, D-Day.
   - ⭐ **관심 매물 (찜)**: AsyncStorage 기반 로컬 영구 찜 저장 및 모아보기.

---

## 🚀 실행 방법

```bash
# 1. 모바일 프로젝트 디렉토리 이동
cd mobile

# 2. 의존성 설치
npm install

# 3. 로컬 개발 서버 실행 (웹 또는 Expo Go)
npx expo start --web
# 또는 스마트폰 Expo Go 앱으로 QR코드 스캔 (iOS/Android)
npx expo start
```

---

## 📂 프로젝트 구조

```
mobile/
├── app/
│   ├── _layout.tsx              # 루트 스택 레이아웃
│   ├── (tabs)/
│   │   ├── _layout.tsx          # 하단 탭바 레이아웃 (홈 / 찜)
│   │   ├── index.tsx            # ① 오늘의 줍줍 카드 피드
│   │   └── favorites.tsx        # ③ 관심 매물 (찜 목록)
│   └── detail/
│       └── [id].tsx             # ② 10초 요약 브리핑 상세
├── assets/
│   └── mobile_feed.json         # 매일 자동 갱신되는 정적 큐레이션 피드
├── context/
│   └── FavoritesContext.tsx     # AsyncStorage 찜 상태 관리
└── types/
    └── feed.ts                  # 피드 데이터 TypeScript 타입
```
