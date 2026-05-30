import sqlite3
import json
import pandas as pd
import streamlit as st

DB_FILE = "auction_db.sqlite"

st.set_page_config(page_title="법원경매 AI 대시보드", page_icon="🏠", layout="wide")

def load_df() -> pd.DataFrame:
    with sqlite3.connect(DB_FILE) as conn:
        df = pd.read_sql_query(
            "SELECT * FROM auction_items ORDER BY ai_score DESC, last_updated DESC", conn
        )
    return df

def format_krw(amount):
    if pd.isna(amount) or amount == 0:
        return "-"
    amount = int(amount)
    if amount >= 100_000_000:
        return f"{amount/100_000_000:.1f}억"
    if amount >= 10_000:
        return f"{amount/10_000:.0f}만"
    return f"{amount:,}"

def discount_rate(appraisal, min_bid):
    try:
        rate = (1 - int(min_bid) / int(appraisal)) * 100
        return f"{rate:.0f}%"
    except Exception:
        return "-"

df = load_df()

# ── 사이드바 필터 ──────────────────────────────────────────
st.sidebar.title("🔍 필터")
min_score = st.sidebar.slider("최소 AI 점수", 0, 100, 0, 5)
grades = st.sidebar.multiselect("등급", ["A", "B", "C"], default=["A", "B", "C"])
keyword = st.sidebar.text_input("소재지 검색", "")

filtered = df[df["ai_score"] >= min_score]
if grades:
    filtered = filtered[filtered["ai_grade"].isin(grades)]
if keyword:
    filtered = filtered[filtered["location"].str.contains(keyword, na=False)]

# ── 헤더 ──────────────────────────────────────────────────
st.title("🏠 법원경매 AI 분석 대시보드")
st.caption(f"DB 물건 수: {len(df)}건  |  필터 결과: {len(filtered)}건")

# ── 지표 카드 ─────────────────────────────────────────────
c1, c2, c3, c4 = st.columns(4)
c1.metric("전체 물건", f"{len(df)}건")
c2.metric("A등급", f"{len(df[df['ai_grade']=='A'])}건")
c3.metric("B등급", f"{len(df[df['ai_grade']=='B'])}건")
c4.metric("평균 AI 점수", f"{df['ai_score'].mean():.0f}점" if len(df) else "-")

st.divider()

# ── 요약 테이블 ───────────────────────────────────────────
st.subheader("📋 물건 목록")

display = filtered[["case_number", "location", "appraisal", "min_bid",
                     "ai_score", "ai_grade", "ai_verdict", "last_updated"]].copy()
display["감정가"] = display["appraisal"].apply(format_krw)
display["최저가"] = display["min_bid"].apply(format_krw)
display["할인율"] = display.apply(lambda r: discount_rate(r["appraisal"], r["min_bid"]), axis=1)
display = display.rename(columns={
    "case_number": "사건번호",
    "location": "소재지",
    "ai_score": "AI점수",
    "ai_grade": "등급",
    "ai_verdict": "한줄판정",
    "last_updated": "갱신일",
})
display = display[["사건번호", "소재지", "감정가", "최저가", "할인율", "AI점수", "등급", "한줄판정", "갱신일"]]

st.dataframe(
    display,
    use_container_width=True,
    hide_index=True,
    column_config={
        "AI점수": st.column_config.ProgressColumn("AI점수", min_value=0, max_value=100, format="%d점"),
        "소재지": st.column_config.TextColumn("소재지", width="large"),
        "한줄판정": st.column_config.TextColumn("한줄판정", width="large"),
    },
)

st.divider()

# ── 상세 조회 ─────────────────────────────────────────────
st.subheader("🔎 물건 상세")
case_options = ["선택하세요..."] + list(filtered["case_number"])
selected = st.selectbox("사건번호 선택", case_options)

if selected != "선택하세요...":
    row = df[df["case_number"] == selected].iloc[0]
    report = {}
    try:
        report = json.loads(row["ai_report_json"] or "{}")
    except Exception:
        pass

    col1, col2 = st.columns(2)
    with col1:
        st.markdown(f"**📍 소재지**: {row['location']}")
        st.markdown(f"**💰 감정가**: {format_krw(row['appraisal'])}")
        st.markdown(f"**📉 최저가**: {format_krw(row['min_bid'])}  ({discount_rate(row['appraisal'], row['min_bid'])} 할인)")
        st.markdown(f"**🎯 AI 점수**: {row['ai_score']}점 ({row['ai_grade']}등급)")
        st.markdown(f"**🎯 추천 입찰가**: {row['ai_suggested_bid'] or '-'}")
        st.markdown(f"**💡 한줄판정**: {row['ai_verdict'] or '-'}")

    with col2:
        buy = report.get("buy_signal", False)
        st.markdown(f"**매수 신호**: {'✅ BUY' if buy else '❌ PASS'}")
        st.markdown(f"**예상 수익률**: {report.get('expected_yield', '-')}")

        ext = report.get("extinguished_rights", [])
        ret = report.get("retained_rights", [])
        if ext:
            st.markdown("**소멸 권리 (안전)**: " + " / ".join(ext))
        if ret:
            st.markdown("**인수 권리 (위험)**: " + " / ".join(ret))

    if report.get("key_points") or report.get("risks"):
        c1, c2 = st.columns(2)
        with c1:
            st.markdown("**✅ 투자 포인트**")
            for p in report.get("key_points", []):
                st.markdown(f"- {p}")
        with c2:
            st.markdown("**⚠️ 핵심 리스크**")
            for r in report.get("risks", []):
                st.markdown(f"- {r}")

    if report.get("analysis_detail"):
        with st.expander("📝 전문가 분석 전문 보기"):
            st.write(report["analysis_detail"])
