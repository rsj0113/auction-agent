import sqlite3
import json
import pandas as pd
import streamlit as st

DB_FILE = "auction_db.sqlite"

st.set_page_config(page_title="법원경매 AI 대시보드", page_icon="🏠", layout="wide")

# ─────────────────────────────────────────────────────────────
# 데이터 로드
# ─────────────────────────────────────────────────────────────

@st.cache_data(ttl=60)
def load_auction() -> pd.DataFrame:
    with sqlite3.connect(DB_FILE) as conn:
        return pd.read_sql_query(
            "SELECT * FROM auction_items ORDER BY ai_score DESC, last_updated DESC", conn
        )

@st.cache_data(ttl=60)
def load_naver() -> pd.DataFrame:
    with sqlite3.connect(DB_FILE) as conn:
        try:
            return pd.read_sql_query(
                "SELECT * FROM naver_listings ORDER BY scraped_at DESC", conn
            )
        except Exception:
            return pd.DataFrame()

# ─────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────

def fmt(val_10k, zero="-"):
    try:
        v = int(val_10k)
        if v <= 0:
            return zero
        if v >= 10000:
            eok, rem = v // 10000, v % 10000
            return f"{eok}억 {rem:,}만" if rem else f"{eok}억"
        return f"{v:,}만"
    except Exception:
        return zero

def disc(appraisal, min_bid):
    try:
        r = (1 - int(min_bid) / int(appraisal)) * 100
        return f"{r:.0f}%"
    except Exception:
        return "-"

# ─────────────────────────────────────────────────────────────
# 경매 ↔ 네이버 비교 로직
# ─────────────────────────────────────────────────────────────

PYEONG = 3.3058

def compare_auction_naver(auction_df: pd.DataFrame, naver_df: pd.DataFrame) -> pd.DataFrame:
    if naver_df.empty or auction_df.empty:
        return pd.DataFrame()

    rows = []
    naver = naver_df.to_dict("records")

    for _, a in auction_df.iterrows():
        area_m2 = float(a.get("area_m2") or 0)
        min_bid = int(a.get("min_bid") or 0)
        appraisal = int(a.get("appraisal") or 0)
        if area_m2 <= 0 or min_bid <= 0:
            continue

        area_pyeong = area_m2 / PYEONG
        legal = str(a.get("legal_div_no") or "")
        aemd  = str(a.get("addr_emd") or "")
        asgg  = str(a.get("addr_sgg") or "")

        # 같은 지역 네이버 매물 필터 (동일동→동일구→동일시, 면적 ±40%)
        min_area = area_m2 * 0.6
        max_area = area_m2 * 1.4
        location = str(a.get("location") or "")
        sido = location.split()[0] if location else ""

        def get_peers(t_cd):
            matched_emd = []
            matched_sgg = []
            matched_sido = []
            for n in naver:
                if n.get("trade_type_cd") != t_cd:
                    continue
                n_area = float(n.get("area_m2") or 0)
                if not (min_area <= n_area <= max_area):
                    continue

                n_div = str(n.get("legal_div_no") or "")
                n_emd = str(n.get("addr_emd") or "")
                n_sgg = str(n.get("addr_sgg") or "")
                n_rn = str(n.get("region_name") or "")

                if (legal and n_div == legal) or (aemd and asgg and n_emd == aemd and n_sgg == asgg):
                    matched_emd.append(n)
                elif asgg and n_sgg == asgg:
                    matched_sgg.append(n)
                elif sido and (n_rn.startswith(sido) or sido in n_rn):
                    matched_sido.append(n)

            if len(matched_emd) > 0: return matched_emd, "동일동"
            if len(matched_sgg) > 0: return matched_sgg, "동일구"
            if len(matched_sido) > 0: return matched_sido, "동일시"
            return [], "매칭없음"

        sale_peers, sale_level = get_peers("A1")
        rent_peers, rent_level = get_peers("B2")

        # 매매 시세 (원/m²)
        sale_valid = [n for n in sale_peers if (n.get("price_sale_10k") or 0) > 0 and (n.get("area_m2") or 0) > 0]
        avg_pm2 = (sum(n["price_sale_10k"] * 10000 / n["area_m2"] for n in sale_valid) / len(sale_valid)) if sale_valid else 0
        est_market_10k = round(avg_pm2 * area_m2 / 10000, 0) if avg_pm2 else 0
        mkt_disc = round((est_market_10k - min_bid / 10000) / est_market_10k * 100, 1) if est_market_10k > 0 else None

        # 월세 수익률
        rent_valid = [n for n in rent_peers if (n.get("monthly_rent_10k") or 0) > 0 and (n.get("area_pyeong") or 0) > 0]
        avg_rpp = (sum(n["monthly_rent_10k"] / n["area_pyeong"] for n in rent_valid) / len(rent_valid)) if rent_valid else 0
        avg_dep = (sum(n.get("deposit_10k") or 0 for n in rent_valid) / len(rent_valid)) if rent_valid else 0
        est_rent_10k = round(avg_rpp * area_pyeong, 1) if avg_rpp else 0
        denom = min_bid / 10000 - avg_dep
        yield_pct = round(est_rent_10k * 12 / denom * 100, 2) if denom > 0 and est_rent_10k > 0 else 0

        rows.append({
            "사건번호"    : a.get("case_number"),
            "소재지"      : a.get("location"),
            "면적(㎡)"    : area_m2,
            "면적(평)"    : round(area_pyeong, 1),
            "최저가"      : min_bid // 10000,
            "감정가"      : appraisal // 10000,
            "감정가할인"  : round((appraisal - min_bid) / appraisal * 100, 1) if appraisal > 0 else 0,
            "네이버시세"  : est_market_10k,
            "시세할인율"  : mkt_disc,
            "비교매물수"  : len(sale_valid),
            "매매매칭수준": sale_level,
            "예상월세"    : est_rent_10k,
            "예상수익률"  : yield_pct,
            "월세비교수"  : len(rent_valid),
            "월세매칭수준": rent_level,
            "AI점수"      : a.get("ai_score"),
            "AI등급"      : a.get("ai_grade"),
        })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

auction_df = load_auction()
naver_df   = load_naver()

st.title("🏠 법원경매 AI 대시보드")

tab1, tab2, tab3 = st.tabs(["📋 경매 물건", "🗺️ 네이버 시세", "⚖️ 경매 × 시세 비교"])


# ══════════════════════════════════════════════════════════════
# TAB 1 — 경매 물건
# ══════════════════════════════════════════════════════════════
with tab1:
    # 사이드바 필터
    with st.sidebar:
        st.header("🔍 경매 필터")
        min_score = st.slider("최소 AI 점수", 0, 100, 0, 5)
        grades    = st.multiselect("등급", ["A", "B", "C"], default=["A", "B", "C"])
        keyword   = st.text_input("소재지 검색", "")

    filtered = auction_df.copy()
    if min_score:
        filtered = filtered[filtered["ai_score"] >= min_score]
    if grades:
        filtered = filtered[filtered["ai_grade"].isin(grades)]
    if keyword:
        filtered = filtered[filtered["location"].str.contains(keyword, na=False)]

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("전체 물건", f"{len(auction_df)}건")
    c2.metric("A등급",     f"{len(auction_df[auction_df['ai_grade']=='A'])}건")
    c3.metric("B등급",     f"{len(auction_df[auction_df['ai_grade']=='B'])}건")
    c4.metric("필터 결과", f"{len(filtered)}건")

    st.divider()
    st.subheader("물건 목록")

    disp = filtered[["case_number","location","appraisal","min_bid","failed_count",
                      "floor","area_pyeong","ai_score","ai_grade","ai_verdict","last_updated"]].copy()
    disp["감정가"] = disp["appraisal"].apply(fmt)
    disp["최저가"] = disp["min_bid"].apply(fmt)
    disp["할인율"] = disp.apply(lambda r: disc(r["appraisal"], r["min_bid"]), axis=1)
    disp["층수"]   = disp["floor"].apply(lambda v: f"{int(v)}층" if v and int(v) > 0 else "-")
    disp["평수"]   = disp["area_pyeong"].apply(lambda v: f"{v:.1f}평" if v and float(v) > 0 else "-")
    disp = disp.rename(columns={
        "case_number":"사건번호","location":"소재지","failed_count":"유찰",
        "ai_score":"AI점수","ai_grade":"등급","ai_verdict":"한줄판정","last_updated":"갱신일"
    })[["사건번호","소재지","감정가","최저가","할인율","유찰","층수","평수","AI점수","등급","한줄판정","갱신일"]]

    st.dataframe(disp, use_container_width=True, hide_index=True, column_config={
        "AI점수"  : st.column_config.ProgressColumn("AI점수", min_value=0, max_value=100, format="%d점"),
        "소재지"  : st.column_config.TextColumn("소재지", width="large"),
        "한줄판정": st.column_config.TextColumn("한줄판정", width="large"),
    })

    st.divider()
    st.subheader("🔎 물건 상세")
    selected = st.selectbox("사건번호 선택", ["선택..."] + list(filtered["case_number"]))
    if selected != "선택...":
        row = auction_df[auction_df["case_number"] == selected].iloc[0]
        report = {}
        try:
            report = json.loads(row["ai_report_json"] or "{}")
        except Exception:
            pass

        col1, col2 = st.columns(2)
        with col1:
            st.markdown(f"**📍 소재지**: {row['location']}")
            st.markdown(f"**💰 감정가**: {fmt(row['appraisal'])}")
            st.markdown(f"**📉 최저가**: {fmt(row['min_bid'])}  ({disc(row['appraisal'], row['min_bid'])} 할인)")
            st.markdown(f"**🔄 유찰횟수**: {int(row.get('failed_count') or 0)}회")
            area_m2 = float(row.get("area_m2") or 0)
            area_py = float(row.get("area_pyeong") or 0)
            floor_v = int(row.get("floor") or 0)
            if floor_v > 0:
                st.markdown(f"**🏢 층수**: {floor_v}층")
            if area_py > 0:
                st.markdown(f"**📐 면적**: {area_m2:.1f}㎡  ({area_py:.1f}평)")
            elif area_m2 > 0:
                st.markdown(f"**📐 면적**: {area_m2:.1f}㎡ ({area_m2/PYEONG:.1f}평)")
            st.markdown(f"**🎯 AI 점수**: {row['ai_score']}점 ({row['ai_grade']}등급)")
            st.markdown(f"**💡 한줄판정**: {row['ai_verdict'] or '-'}")
        with col2:
            buy = report.get("buy_signal", False)
            st.markdown(f"**매수 신호**: {'✅ BUY' if buy else '❌ PASS'}")
            st.markdown(f"**예상 수익률**: {report.get('expected_yield', '-')}")
            ext = report.get("extinguished_rights", [])
            ret = report.get("retained_rights", [])
            if ext:
                st.markdown("**소멸 권리**: " + " / ".join(ext))
            if ret:
                st.markdown("**인수 권리**: " + " / ".join(ret))

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
            with st.expander("📝 분석 전문"):
                st.write(report["analysis_detail"])


# ══════════════════════════════════════════════════════════════
# TAB 2 — 네이버 시세
# ══════════════════════════════════════════════════════════════
with tab2:
    if naver_df.empty:
        st.info("네이버 데이터가 없습니다. `python naver_land_scraper.py` 를 먼저 실행하세요.")
    else:
        regions = ["전체"] + sorted(naver_df["region_name"].dropna().unique().tolist())
        sel_region = st.selectbox("지역 선택", regions, key="naver_region")
        nf = naver_df if sel_region == "전체" else naver_df[naver_df["region_name"] == sel_region]

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("총 매물", f"{len(nf)}건")
        c2.metric("매매",    f"{len(nf[nf['trade_type']=='매매'])}건")
        c3.metric("전세",    f"{len(nf[nf['trade_type']=='전세'])}건")
        c4.metric("월세",    f"{len(nf[nf['trade_type']=='월세'])}건")

        st.divider()

        # 지역별 시세 통계
        st.subheader("📊 지역별 시세 요약")
        stats = []
        for rn, grp in naver_df.groupby("region_name"):
            sale = grp[grp["trade_type"] == "매매"]
            rent = grp[grp["trade_type"] == "월세"]
            sale_v = sale[(sale["price_sale_10k"] > 0) & (sale["area_m2"] > 0)]
            rent_v = rent[(rent["monthly_rent_10k"] > 0) & (rent["area_pyeong"] > 0)]
            avg_pm2  = (sale_v["price_sale_10k"] * 10000 / sale_v["area_m2"]).mean() if len(sale_v) else 0
            avg_rpp  = (rent_v["monthly_rent_10k"] / rent_v["area_pyeong"]).mean() if len(rent_v) else 0
            stats.append({
                "지역"          : rn,
                "매매"          : f"{len(sale)}건",
                "월세"          : f"{len(rent)}건",
                "평균매매단가"  : f"{avg_pm2/10000:.0f}만/㎡" if avg_pm2 else "-",
                "평당월세"      : f"{avg_rpp:.1f}만/평" if avg_rpp else "-",
                "수집일"        : grp["scraped_at"].max()[:10] if "scraped_at" in grp else "",
            })
        st.dataframe(pd.DataFrame(stats), use_container_width=True, hide_index=True)

        st.divider()

        # 매물 목록
        st.subheader("매물 목록")
        trade_filter = st.radio("거래유형", ["전체", "매매", "전세", "월세"], horizontal=True)
        if trade_filter != "전체":
            nf = nf[nf["trade_type"] == trade_filter]

        disp_n = nf[["article_name","addr_sgg","addr_emd","trade_type",
                      "area_m2","area_pyeong","price_sale_10k","monthly_rent_10k",
                      "deposit_10k","floor","total_floor","detail_url"]].copy()
        disp_n["매매가"] = disp_n["price_sale_10k"].apply(fmt)
        disp_n["월세"]   = disp_n.apply(
            lambda r: f"{fmt(r['monthly_rent_10k'])}/월 (보증 {fmt(r['deposit_10k'])})" if r["monthly_rent_10k"] > 0 else "-",
            axis=1
        )
        disp_n["층수"] = disp_n.apply(
            lambda r: f"{r['floor']}층/{r['total_floor']}층" if r["floor"] else "-", axis=1
        )
        disp_n = disp_n.rename(columns={
            "article_name":"매물명","addr_sgg":"구","addr_emd":"동",
            "trade_type":"거래","area_m2":"면적㎡","area_pyeong":"면적평","detail_url":"링크"
        })[["매물명","구","동","거래","면적㎡","면적평","매매가","월세","층수","링크"]]

        st.dataframe(disp_n, use_container_width=True, hide_index=True, column_config={
            "링크": st.column_config.LinkColumn("링크", width="small"),
        })


# ══════════════════════════════════════════════════════════════
# TAB 3 — 경매 × 시세 비교
# ══════════════════════════════════════════════════════════════
with tab3:
    if naver_df.empty:
        st.info("네이버 데이터가 없습니다. `python naver_land_scraper.py` 를 먼저 실행하세요.")
    elif not any(auction_df["area_m2"].fillna(0) > 0):
        st.info("경매 물건에 면적 데이터가 없습니다. 경매 크롤러를 재실행하면 자동으로 채워집니다.")
    else:
        st.subheader("⚖️ 경매 물건 × 네이버 시세 비교")

        # 필터
        col_f1, col_f2, col_f3 = st.columns(3)
        min_yield   = col_f1.number_input("최소 예상수익률(%)", 0.0, 20.0, 0.0, 0.5)
        max_bid_eok = col_f2.number_input("최대 최저가(억원)", 0.0, 100.0, 0.0, 0.5)
        min_disc    = col_f3.number_input("최소 시세할인율(%)", -50.0, 80.0, 0.0, 5.0)

        cmp_df = compare_auction_naver(auction_df, naver_df)

        if cmp_df.empty:
            st.warning("비교 가능한 물건이 없습니다. (경매 물건 면적 또는 같은 지역 네이버 매물 필요)")
        else:
            # 필터 적용
            result = cmp_df.copy()
            if min_yield > 0:
                result = result[result["예상수익률"] >= min_yield]
            if max_bid_eok > 0:
                result = result[result["최저가"] <= max_bid_eok * 10000]
            if min_disc > 0:
                result = result[result["시세할인율"].notna() & (result["시세할인율"] >= min_disc)]

            result = result.sort_values(["예상수익률", "시세할인율"], ascending=False)

            # 지표 카드
            has_yield  = result[result["예상수익률"] > 0]
            has_disc   = result[result["시세할인율"].notna() & (result["시세할인율"] > 0)]
            mc1, mc2, mc3, mc4 = st.columns(4)
            mc1.metric("비교 가능 물건",   f"{len(cmp_df)}건")
            mc2.metric("수익률 있는 물건", f"{len(has_yield)}건")
            mc3.metric("최고 수익률",      f"{has_yield['예상수익률'].max():.1f}%" if len(has_yield) else "-")
            mc4.metric("최고 시세 할인",   f"{has_disc['시세할인율'].max():.1f}%" if len(has_disc) else "-")

            st.divider()

            # 결과 테이블
            disp_c = result.copy()
            disp_c["최저가"]    = disp_c["최저가"].apply(fmt)
            disp_c["네이버시세"] = disp_c["네이버시세"].apply(fmt)
            disp_c["예상월세"]  = disp_c["예상월세"].apply(lambda v: fmt(v) + "/월" if v > 0 else "-")
            disp_c["시세할인율"] = disp_c["시세할인율"].apply(lambda v: f"{v:.1f}%" if pd.notna(v) else "-")
            disp_c["감정가할인"] = disp_c["감정가할인"].apply(lambda v: f"{v:.1f}%")
            disp_c["예상수익률"] = disp_c["예상수익률"].apply(lambda v: f"{v:.2f}%" if v > 0 else "-")

            show_cols = ["사건번호","소재지","면적(평)","최저가","감정가할인",
                         "네이버시세","시세할인율","비교매물수","매매매칭수준",
                         "예상월세","예상수익률","월세비교수","월세매칭수준","AI점수","AI등급"]
            st.dataframe(
                disp_c[show_cols],
                use_container_width=True,
                hide_index=True,
                column_config={
                    "AI점수": st.column_config.ProgressColumn("AI점수", min_value=0, max_value=100, format="%d점"),
                    "소재지": st.column_config.TextColumn("소재지", width="large"),
                    "예상수익률": st.column_config.TextColumn("예상수익률", width="small"),
                },
            )

            st.divider()

            # 상세
            st.subheader("물건 상세 보기")
            sel2 = st.selectbox("사건번호", ["선택..."] + list(result["사건번호"]), key="cmp_detail")
            if sel2 != "선택...":
                r = result[result["사건번호"] == sel2].iloc[0]
                a_row = auction_df[auction_df["case_number"] == sel2].iloc[0]

                col1, col2, col3 = st.columns(3)
                with col1:
                    st.markdown("**경매 정보**")
                    st.markdown(f"소재지: {r['소재지']}")
                    st.markdown(f"면적: {r['면적(㎡)']}㎡ ({r['면적(평)']}평)")
                    st.markdown(f"최저가: {r['최저가']}")
                    st.markdown(f"감정가 할인: {r['감정가할인']}")
                    st.markdown(f"AI: {r['AI점수']}점 {r['AI등급']}등급")
                with col2:
                    st.markdown("**네이버 시세 비교**")
                    st.markdown(f"추정 시세: {r['네이버시세']}")
                    disc_raw = r["시세할인율"]
                    if pd.notna(disc_raw):
                        try:
                            # format check as it could be string due to earlier bug but it's a float
                            if isinstance(disc_raw, str):
                                disc_val = float(disc_raw.replace("%", ""))
                            else:
                                disc_val = float(disc_raw)
                            color = "🟢" if disc_val > 0 else "🔴"
                            st.markdown(f"시세 대비: {color} {disc_val:.1f}%")
                        except:
                            st.markdown(f"시세 대비: {disc_raw}")
                    st.markdown(f"비교 매물: {r['비교매물수']}건 ({r.get('매매매칭수준', '알수없음')})")
                with col3:
                    st.markdown("**수익률 분석**")
                    st.markdown(f"예상 월세: {r['예상월세']}")
                    st.markdown(f"예상 수익률: {r['예상수익률']}")
                    st.markdown(f"월세 비교 매물: {r['월세비교수']}건 ({r.get('월세매칭수준', '알수없음')})")

                # 같은 지역 네이버 매물
                legal = str(a_row.get("legal_div_no") or "")
                aemd  = str(a_row.get("addr_emd") or "")
                peers = naver_df[
                    (naver_df["legal_div_no"] == legal) if legal
                    else (naver_df["addr_emd"] == aemd)
                ]
                if not peers.empty:
                    with st.expander(f"📊 같은 지역 네이버 매물 ({len(peers)}건)"):
                        peer_disp = peers[["trade_type","area_pyeong","price_sale_10k",
                                           "monthly_rent_10k","deposit_10k","floor","detail_url"]].copy()
                        peer_disp["매매가"] = peer_disp["price_sale_10k"].apply(fmt)
                        peer_disp["월세"]   = peer_disp.apply(
                            lambda row: f"{fmt(row['monthly_rent_10k'])}/월" if row["monthly_rent_10k"] > 0 else "-", axis=1
                        )
                        peer_disp = peer_disp.rename(columns={
                            "trade_type":"거래","area_pyeong":"면적(평)","detail_url":"링크"
                        })[["거래","면적(평)","매매가","월세","층수" if "층수" in peer_disp else "floor","링크"]]
                        st.dataframe(peer_disp, use_container_width=True, hide_index=True,
                                     column_config={"링크": st.column_config.LinkColumn("링크")})
