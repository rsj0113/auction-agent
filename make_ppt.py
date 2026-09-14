"""
법원경매 × 네이버 부동산 AI 상권분석 에이전트 발표 자료 생성
"""

import io
import sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patches as FancyArrowPatch
import matplotlib.ticker as ticker
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import numpy as np
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "auction_db.sqlite")

# ── 한글 폰트 설정 ─────────────────────────────────────────────
def get_korean_font():
    candidates = [
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/Library/Fonts/AppleGothic.ttf",
        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return font_manager.FontProperties(fname=path)
    return None

KR_FONT = get_korean_font()

def set_kr_font(ax):
    if KR_FONT:
        for text in ax.get_xticklabels() + ax.get_yticklabels():
            text.set_fontproperties(KR_FONT)
        ax.title.set_fontproperties(KR_FONT)
        ax.xaxis.label.set_fontproperties(KR_FONT)
        ax.yaxis.label.set_fontproperties(KR_FONT)

def fig_to_stream(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight', facecolor='white')
    buf.seek(0)
    plt.close(fig)
    return buf

# ── 색상 팔레트 ─────────────────────────────────────────────────
C_RED   = RGBColor(0xC0, 0x39, 0x2B)
C_BLUE  = RGBColor(0x21, 0x6B, 0xE5)
C_DARK  = RGBColor(0x1A, 0x1A, 0x2E)
C_GOLD  = RGBColor(0xE6, 0xAC, 0x27)
C_GREEN = RGBColor(0x27, 0xAE, 0x60)
C_GRAY  = RGBColor(0x5A, 0x5A, 0x5A)
C_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
C_BG    = RGBColor(0xF7, 0xF9, 0xFC)
C_TEAL  = RGBColor(0x00, 0x96, 0x88)

# ── 헬퍼 함수 ────────────────────────────────────────────────────
def add_rect(slide, l, t, w, h, fill_rgb, alpha=None):
    shape = slide.shapes.add_shape(1, Inches(l), Inches(t), Inches(w), Inches(h))
    shape.line.fill.background()
    fill = shape.fill
    fill.solid()
    fill.fore_color.rgb = fill_rgb
    return shape

def add_text(slide, text, l, t, w, h, size=18, bold=False, color=C_DARK,
             align=PP_ALIGN.LEFT, wrap=True):
    txb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    txb.word_wrap = wrap
    tf = txb.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = "Apple SD Gothic Neo"
    return txb

def add_slide(prs, layout_idx=6):
    layout = prs.slide_layouts[layout_idx]
    slide = prs.slides.add_slide(layout)
    for ph in slide.placeholders:
        sp = ph._element
        sp.getparent().remove(sp)
    return slide

def slide_bg(slide, rgb=C_BG):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = rgb

def header_bar(slide, title, subtitle=None):
    add_rect(slide, 0, 0, 13.33, 1.1, C_DARK)
    add_text(slide, title, 0.3, 0.1, 11, 0.6, size=26, bold=True, color=C_WHITE)
    if subtitle:
        add_text(slide, subtitle, 0.3, 0.65, 11, 0.4, size=13, bold=False,
                 color=RGBColor(0xCC, 0xDD, 0xFF))

def slide_number(slide, n, total=12):
    add_text(slide, f"{n} / {total}", 12.5, 7.1, 0.8, 0.3, size=10,
             color=C_GRAY, align=PP_ALIGN.RIGHT)


# ══════════════════════════════════════════════════════════════
# 차트 생성 함수들
# ══════════════════════════════════════════════════════════════

def chart_architecture():
    """시스템 아키텍처 — 5모듈 파이프라인 흐름도"""
    fig, ax = plt.subplots(figsize=(12, 5), facecolor='white')
    ax.set_facecolor('white')
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 5)
    ax.axis('off')

    modules = [
        (0.5,  2.0, '#1A1A2E', '#FFFFFF', '법원경매\n크롤러\nauto_crawling.py', '법원경매\n사이트'),
        (2.8,  2.0, '#216BE5', '#FFFFFF', 'AI 분석\n엔진\nGPT-4.1-nano', '권리분석\n+ 점수화'),
        (5.1,  2.0, '#009688', '#FFFFFF', '네이버 부동산\n크롤러\nnaver_land_scraper.py', '상가 시세\n수집'),
        (7.4,  2.0, '#27AE60', '#FFFFFF', '시세 비교\n엔진\ncompare.py', '할인율\n수익률'),
        (9.7,  2.0, '#E6AC27', '#1A1A2E', 'Streamlit\n대시보드\ndashboard.py', '3탭 UI'),
    ]

    for x, y, bg, fg, title, sub in modules:
        rect = FancyBboxPatch((x, y), 2.0, 1.6,
                              boxstyle="round,pad=0.08",
                              facecolor=bg, edgecolor='white', linewidth=1.5)
        ax.add_patch(rect)
        ax.text(x + 1.0, y + 1.05, title, ha='center', va='center',
                fontproperties=KR_FONT, fontsize=8.5, color=fg, fontweight='bold')
        ax.text(x + 1.0, y + 0.25, sub, ha='center', va='center',
                fontproperties=KR_FONT, fontsize=7.5,
                color=fg if fg == '#FFFFFF' else '#333333',
                alpha=0.85)

    # 화살표
    arrow_xs = [(2.5, 2.8), (4.8, 5.1), (7.15, 7.4), (9.45, 9.7)]
    for x1, x2 in arrow_xs:
        ax.annotate('', xy=(x2, 2.8), xytext=(x1, 2.8),
                    arrowprops=dict(arrowstyle='->', color='#444', lw=2.0))

    # SQLite DB 박스
    rect_db = FancyBboxPatch((4.5, 0.2), 3.0, 0.9,
                             boxstyle="round,pad=0.06",
                             facecolor='#EEF2FF', edgecolor='#216BE5', linewidth=1.5)
    ax.add_patch(rect_db)
    ax.text(6.0, 0.65, 'SQLite DB  (auction_db.sqlite)', ha='center', va='center',
            fontproperties=KR_FONT, fontsize=9, color='#1A1A2E', fontweight='bold')
    ax.text(6.0, 0.28, 'auction_items  |  naver_listings', ha='center', va='center',
            fontproperties=KR_FONT, fontsize=8, color='#555')

    # DB 연결 화살표
    for bx in [1.5, 3.8, 6.1, 8.4]:
        ax.annotate('', xy=(6.0, 1.12), xytext=(bx, 2.0),
                    arrowprops=dict(arrowstyle='->', color='#999', lw=1.2, linestyle='dashed'))

    # Hermes 모니터링
    rect_h = FancyBboxPatch((0.3, 4.2), 2.8, 0.7,
                            boxstyle="round,pad=0.06",
                            facecolor='#FFF3CD', edgecolor='#E6AC27', linewidth=1.5)
    ax.add_patch(rect_h)
    ax.text(1.7, 4.58, 'Hermes 모니터링 에이전트  →  Slack #ops-hermes', ha='center', va='center',
            fontproperties=KR_FONT, fontsize=8.5, color='#333', fontweight='bold')

    ax.annotate('', xy=(1.5, 4.2), xytext=(1.5, 3.6),
                arrowprops=dict(arrowstyle='->', color='#E6AC27', lw=1.5))

    fig.tight_layout(pad=0.5)
    return fig_to_stream(fig)


def chart_grade_distribution():
    """AI 등급 분포 — 실제 DB 데이터"""
    grades = ['A', 'B', 'C', 'D']
    counts = [81, 28, 39, 198]
    colors = ['#27AE60', '#216BE5', '#E6AC27', '#C0392B']

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.5), facecolor='white')

    # 왼쪽: 파이차트
    ax1.set_facecolor('white')
    wedges, texts, autotexts = ax1.pie(
        counts, labels=grades, autopct='%1.1f%%',
        colors=colors, startangle=90,
        textprops={'fontsize': 12, 'fontweight': 'bold'},
        pctdistance=0.75, wedgeprops=dict(edgecolor='white', linewidth=2)
    )
    for t in texts:
        t.set_fontsize(14)
        t.set_fontweight('bold')
    for at in autotexts:
        at.set_fontsize(10)
        at.set_color('white')
    ax1.set_title('AI 투자 등급 분포 (총 346건)', fontproperties=KR_FONT, fontsize=13, fontweight='bold', pad=12)

    # 오른쪽: 등급별 의미 설명 바
    ax2.set_facecolor('#F7F9FC')
    bars = ax2.barh(grades[::-1], counts[::-1], color=colors[::-1], alpha=0.85, height=0.55)
    ax2.set_xlabel('물건 수', fontproperties=KR_FONT, fontsize=10)
    ax2.set_title('등급별 물건 수', fontproperties=KR_FONT, fontsize=13, fontweight='bold')

    labels_desc = ['D: 위험 (198건)', 'C: 주의 (39건)', 'B: 양호 (28건)', 'A: 우량 (81건)']
    for bar, label in zip(bars, labels_desc):
        ax2.text(bar.get_width() + 3, bar.get_y() + bar.get_height() / 2,
                 f'{int(bar.get_width())}건', va='center', fontproperties=KR_FONT, fontsize=10)
    ax2.spines[['top', 'right']].set_visible(False)
    ax2.set_xlim(0, 230)
    set_kr_font(ax2)

    legend_elements = [
        mpatches.Patch(color='#27AE60', label='A: 우량 — 즉시 입찰 검토'),
        mpatches.Patch(color='#216BE5', label='B: 양호 — 조건부 검토'),
        mpatches.Patch(color='#E6AC27', label='C: 주의 — 현장 확인 필수'),
        mpatches.Patch(color='#C0392B', label='D: 위험 — 입찰 비추천'),
    ]
    ax2.legend(handles=legend_elements, loc='lower right', prop=KR_FONT, fontsize=8)

    fig.tight_layout(pad=1.0)
    return fig_to_stream(fig)


def chart_data_volume():
    """수집 현황 — 실제 DB 데이터 바차트"""
    fig, ax = plt.subplots(figsize=(9, 4), facecolor='white')
    ax.set_facecolor('#F7F9FC')

    categories = ['법원경매\n수집 건수', 'AI 분석\n완료', '네이버 시세\n수집 건수', '면적정보\n보유 경매']
    values = [346, 346, 592, 108]
    colors = ['#1A1A2E', '#27AE60', '#009688', '#216BE5']

    bars = ax.bar(categories, values, color=colors, alpha=0.85, width=0.55)
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 8,
                f'{val:,}건', ha='center', va='bottom', fontproperties=KR_FONT,
                fontsize=12, fontweight='bold', color='#333')

    ax.set_ylabel('건 수', fontproperties=KR_FONT, fontsize=10)
    ax.set_title('현재 DB 수집 현황 (2026-06 기준)', fontproperties=KR_FONT, fontsize=13, fontweight='bold')
    ax.set_ylim(0, 680)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=0.3)
    set_kr_font(ax)

    fig.tight_layout()
    return fig_to_stream(fig)


def chart_naver_region():
    """네이버 시세 지역별 수집 현황"""
    regions = ['마포구', '안양시\n동안구', '성남시\n분당구', '수원시\n권선구', '구리시',
               '구로구', '용인시\n수지구', '안산시\n단원구']
    counts = [150, 99, 62, 66, 57, 53, 45, 34]

    fig, ax = plt.subplots(figsize=(9, 4), facecolor='white')
    ax.set_facecolor('#F7F9FC')
    bar_colors = ['#009688'] * len(counts)
    bar_colors[0] = '#1A1A2E'
    bar_colors[1] = '#216BE5'

    bars = ax.bar(regions, counts, color=bar_colors, alpha=0.85, width=0.6)
    for bar, val in zip(bars, counts):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                str(val), ha='center', va='bottom', fontproperties=KR_FONT,
                fontsize=11, fontweight='bold', color='#333')

    ax.set_ylabel('매물 수', fontproperties=KR_FONT, fontsize=10)
    ax.set_title('네이버 부동산 지역별 수집 현황 (총 592건)', fontproperties=KR_FONT,
                 fontsize=13, fontweight='bold')
    ax.set_ylim(0, 180)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=0.3)
    set_kr_font(ax)

    fig.tight_layout()
    return fig_to_stream(fig)


def chart_compare_logic():
    """시세 비교 분석 로직 흐름도"""
    fig, ax = plt.subplots(figsize=(11, 4.5), facecolor='white')
    ax.set_facecolor('white')
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 4.5)
    ax.axis('off')

    steps = [
        (0.3,  1.5, '#1A1A2E', '#FFF', '경매 물건\n(area_m2 보유)'),
        (2.5,  1.5, '#216BE5', '#FFF', '법정동 코드\n매칭'),
        (4.7,  1.5, '#009688', '#FFF', '네이버 시세\n조회'),
        (6.9,  1.5, '#E6AC27', '#1A1A2E', '할인율\n수익률 계산'),
        (9.1,  1.5, '#27AE60', '#FFF', '랭킹\n출력'),
    ]
    for x, y, bg, fg, label in steps:
        rect = FancyBboxPatch((x, y), 1.9, 1.3,
                              boxstyle="round,pad=0.07",
                              facecolor=bg, edgecolor='white', linewidth=1.5)
        ax.add_patch(rect)
        ax.text(x + 0.95, y + 0.65, label, ha='center', va='center',
                fontproperties=KR_FONT, fontsize=9.5, color=fg, fontweight='bold')

    arrow_positions = [(2.2, 3.15), (4.4, 5.35), (6.6, 7.55), (8.8, 9.75)]
    for x1, x2 in arrow_positions:
        ax.annotate('', xy=(x2 - 4.7 + 2.5 + x1 * 0, x1 * 0 + 2.15), xytext=(x1 * 0 + x1 * 0, 2.15),
                    arrowprops=dict(arrowstyle='->', color='#444', lw=2))

    # 수동 화살표 (더 간단하게)
    ax.annotate('', xy=(2.5, 2.15), xytext=(2.2, 2.15),
                arrowprops=dict(arrowstyle='->', color='#444', lw=2))
    ax.annotate('', xy=(4.7, 2.15), xytext=(4.4, 2.15),
                arrowprops=dict(arrowstyle='->', color='#444', lw=2))
    ax.annotate('', xy=(6.9, 2.15), xytext=(6.6, 2.15),
                arrowprops=dict(arrowstyle='->', color='#444', lw=2))
    ax.annotate('', xy=(9.1, 2.15), xytext=(8.8, 2.15),
                arrowprops=dict(arrowstyle='->', color='#444', lw=2))

    # 계산 공식 박스
    formulas = [
        (3.45, 0.2, '법정동 코드\n(legal_div_no) 일치'),
        (5.65, 0.2, '동일 지역\n매물 평균'),
        (7.85, 0.2, '할인율 = (1 - 최저가/감정가)\n수익률 = 월세/낙찰가'),
    ]
    for x, y, text in formulas:
        rect2 = FancyBboxPatch((x - 0.7, y), 1.9, 1.0,
                               boxstyle="round,pad=0.05",
                               facecolor='#EEF2FF', edgecolor='#aaa', linewidth=1)
        ax.add_patch(rect2)
        ax.text(x + 0.25, y + 0.5, text, ha='center', va='center',
                fontproperties=KR_FONT, fontsize=7.5, color='#333')

    ax.set_title('경매 × 네이버 시세 비교 분석 파이프라인', fontproperties=KR_FONT,
                 fontsize=13, fontweight='bold', y=0.97)
    fig.tight_layout(pad=0.5)
    return fig_to_stream(fig)


# ══════════════════════════════════════════════════════════════
# 슬라이드 생성 함수들
# ══════════════════════════════════════════════════════════════

def slide_01_title(prs):
    slide = add_slide(prs)
    slide_bg(slide, C_DARK)

    # 배경 강조 사각형
    add_rect(slide, 0, 0, 13.33, 7.5, C_DARK)
    add_rect(slide, 0, 0, 0.18, 7.5, C_BLUE)
    add_rect(slide, 0, 3.3, 13.33, 0.05, RGBColor(0x21, 0x6B, 0xE5))

    add_text(slide, '법원경매 × 네이버 부동산', 1.2, 1.6, 11, 1.0,
             size=32, bold=True, color=C_WHITE, align=PP_ALIGN.LEFT)
    add_text(slide, 'AI 상권분석 에이전트', 1.2, 2.55, 11, 0.8,
             size=38, bold=True, color=C_GOLD, align=PP_ALIGN.LEFT)

    add_text(slide, '법원경매 물건 자동 수집  →  GPT-4.1-nano 권리분석  →  네이버 시세 비교', 1.2, 3.55, 11, 0.5,
             size=14, bold=False, color=RGBColor(0xBB, 0xCC, 0xFF), align=PP_ALIGN.LEFT)
    add_text(slide, '서울 5개 법원 + 경기도 순회 크롤링  |  Streamlit 대시보드  |  Hermes 24h 모니터링', 1.2, 4.1, 11, 0.5,
             size=13, bold=False, color=RGBColor(0x99, 0xAA, 0xDD), align=PP_ALIGN.LEFT)

    # 통계 뱃지
    stats = [
        ('346건', '경매 수집'),
        ('346건', 'AI 분석'),
        ('592건', '시세 수집'),
        ('5개', '서울 법원'),
    ]
    for i, (val, label) in enumerate(stats):
        bx = 1.2 + i * 3.0
        add_rect(slide, bx, 5.2, 2.5, 1.2, RGBColor(0x2A, 0x2A, 0x4E))
        add_text(slide, val, bx, 5.3, 2.5, 0.6,
                 size=24, bold=True, color=C_GOLD, align=PP_ALIGN.CENTER)
        add_text(slide, label, bx, 5.85, 2.5, 0.4,
                 size=12, bold=False, color=RGBColor(0xAA, 0xBB, 0xFF), align=PP_ALIGN.CENTER)

    add_text(slide, '2026. 06', 11.5, 7.0, 1.5, 0.4,
             size=11, color=RGBColor(0x66, 0x77, 0x99), align=PP_ALIGN.RIGHT)


def slide_02_overview(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '프로젝트 개요', '왜 만들었나 — 문제 정의')
    slide_number(slide, 2)

    # 문제 박스
    add_rect(slide, 0.4, 1.3, 5.8, 2.5, RGBColor(0xFF, 0xF0, 0xF0))
    add_text(slide, '기존의 불편함', 0.6, 1.35, 5.4, 0.45,
             size=15, bold=True, color=C_RED)
    problems = [
        '법원경매 사이트 — WebSquare 프레임워크 탓에 크롤링 불가',
        '매물 수십~수백 건 중 좋은 물건 수작업 필터링',
        '경매 낙찰가와 실제 시세 비교를 수작업으로 진행',
        '권리분석(말소기준/대항력) 오판 시 금전 손실 위험',
    ]
    for j, p in enumerate(problems):
        add_text(slide, f'  •  {p}', 0.6, 1.8 + j * 0.48, 5.4, 0.45, size=12, color=C_GRAY)

    # 솔루션 박스
    add_rect(slide, 6.8, 1.3, 6.1, 2.5, RGBColor(0xF0, 0xFF, 0xF4))
    add_text(slide, '이 에이전트의 솔루션', 7.0, 1.35, 5.7, 0.45,
             size=15, bold=True, color=C_GREEN)
    solutions = [
        'Playwright + response 리스너로 XHR 직접 캡처',
        'GPT-4.1-nano 권리분석 → 0~100점 / A~D 등급',
        '네이버 부동산 API 역공학 → 동 단위 시세 자동 수집',
        'compare.py 할인율·수익률 자동 계산 및 랭킹',
    ]
    for j, s in enumerate(solutions):
        add_text(slide, f'  ✓  {s}', 7.0, 1.8 + j * 0.48, 5.7, 0.45, size=12, color=C_GREEN)

    # 기술 스택 태그
    add_rect(slide, 0.4, 4.0, 12.5, 0.05, C_GRAY)
    add_text(slide, '기술 스택', 0.4, 4.15, 3.0, 0.4, size=14, bold=True, color=C_DARK)
    stack_items = [
        ('Python 3.12', C_BLUE), ('Playwright + Stealth', C_DARK), ('OpenAI GPT-4.1-nano', C_GREEN),
        ('SQLite', C_TEAL), ('Streamlit', C_GOLD), ('Rich', C_GRAY),
    ]
    bx = 0.4
    for label, color in stack_items:
        w = len(label) * 0.13 + 0.8
        add_rect(slide, bx, 4.6, w, 0.45, color)
        add_text(slide, label, bx + 0.05, 4.62, w - 0.1, 0.42,
                 size=11, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)
        bx += w + 0.15

    # 파일 구성
    add_text(slide, '핵심 파일 구성', 0.4, 5.25, 6.0, 0.4, size=14, bold=True, color=C_DARK)
    files = [
        'auto_crawling.py   — 법원경매 크롤링 + DB + AI 분석 (1,438줄)',
        'naver_land_scraper.py   — 네이버 부동산 크롤링 (500줄)',
        'compare.py   — 경매 × 시세 비교 CLI (316줄)',
        'dashboard.py   — Streamlit 대시보드 (420줄)',
        'hermes_agent.py   — 24h 모니터링 에이전트 (384줄)',
    ]
    for j, f in enumerate(files):
        add_text(slide, f, 0.4, 5.7 + j * 0.32, 12.5, 0.32, size=11, color=C_GRAY)


def slide_03_architecture(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '시스템 아키텍처', '5개 모듈 데이터 파이프라인')
    slide_number(slide, 3)

    img = chart_architecture()
    slide.shapes.add_picture(img, Inches(0.4), Inches(1.2), Inches(12.5), Inches(5.5))


def slide_04_crawling(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '법원경매 크롤링', 'WebSquare 사이트 역공학 + 서울·경기 법원 순회')
    slide_number(slide, 4)

    # 왼쪽: 핵심 도전과제
    add_rect(slide, 0.4, 1.3, 5.8, 5.5, RGBColor(0xF7, 0xF9, 0xFF))
    add_text(slide, '핵심 도전과제', 0.6, 1.4, 5.4, 0.45, size=14, bold=True, color=C_DARK)

    challenges = [
        ('WebSquare 프레임워크', 'moveDtlPage(idx) → XHR 직접 캡처\npage.on("response") 리스너 등록'),
        ('2번째 이후 항목', '첫 항목: response 리스너로 cortOfcCd 추출\n이후: page.evaluate(fetch()) 직접 호출'),
        ('법원 드롭다운 선택', 'setSelectedIndex(i) — 법원명 텍스트 매칭\nB코드: 중앙(B000210) ~ 서부(B000250)'),
        ('비로그인 날짜 제한', '사이트 자체 제약 — 2주 이내만 허용'),
    ]
    for j, (title, desc) in enumerate(challenges):
        yy = 1.95 + j * 1.15
        add_rect(slide, 0.55, yy, 5.4, 0.9, RGBColor(0xEE, 0xF2, 0xFF))
        add_text(slide, title, 0.65, yy + 0.05, 5.2, 0.3, size=12, bold=True, color=C_BLUE)
        add_text(slide, desc, 0.65, yy + 0.35, 5.2, 0.55, size=10, color=C_GRAY)

    # 오른쪽: API & DB 정보
    add_rect(slide, 6.8, 1.3, 6.1, 2.6, RGBColor(0xF0, 0xF8, 0xFF))
    add_text(slide, '캡처 API 엔드포인트', 7.0, 1.4, 5.7, 0.45, size=14, bold=True, color=C_DARK)
    api_lines = [
        'POST /pgj/pgj15B/selectAuctnCsSrchRslt.on',
        '',
        '응답 구조:',
        '  csBaseInfo.csNo          사건번호',
        '  csBaseInfo.cortOfcCd     법원코드',
        '  dspslGdsDxdyInfo.fstPbancLwsDspslPrc  최저가',
        '  dstrtDemnInfo[].dstrtDemnLstprdYmd    말소기준',
    ]
    for j, line in enumerate(api_lines):
        bold = bool(line and not line.startswith(' '))
        color = C_BLUE if line.startswith('POST') else C_GRAY
        add_text(slide, line, 7.0, 1.9 + j * 0.28, 5.7, 0.3, size=10, bold=bold, color=color)

    add_rect(slide, 6.8, 4.05, 6.1, 2.6, RGBColor(0xF4, 0xFF, 0xF4))
    add_text(slide, '서울·경기 법원 커버리지', 7.0, 4.15, 5.7, 0.45, size=14, bold=True, color=C_DARK)
    courts = [
        '서울 5개: 중앙·동부·남부·북부·서부지방법원',
        '경기 8개: 수원·성남·여주·평택·안산·안양·의정부·고양 外',
        '',
        'auction_items 테이블 주요 컬럼:',
        '  area_m2, legal_div_no, addr_sgg, addr_emd',
        '  ai_score, ai_grade, ai_verdict, ai_suggested_bid',
    ]
    for j, c in enumerate(courts):
        bold = bool(c and not c.startswith(' '))
        color = C_GREEN if ('5개' in c or '8개' in c) else C_GRAY
        add_text(slide, c, 7.0, 4.65 + j * 0.32, 5.7, 0.32, size=10, bold=bold, color=color)


def slide_05_ai_engine(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, 'AI 분석 엔진', 'GPT-4.1-nano 권리분석 + 점수화')
    slide_number(slide, 5)

    # 입력 → 처리 → 출력 흐름
    add_rect(slide, 0.4, 1.3, 3.8, 5.6, RGBColor(0xF7, 0xF9, 0xFF))
    add_text(slide, '입력 (Input)', 0.6, 1.4, 3.4, 0.4, size=14, bold=True, color=C_DARK)
    inputs = ['사건번호 / 소재지', '감정가 / 최저매각가격',
              '유찰횟수', '할인율', '위험등급 (SAFE/WARNING/CRITICAL)',
              '말소기준권리일', '임차인 정보', '자동 감지 경고 목록']
    for j, inp in enumerate(inputs):
        add_text(slide, f'  •  {inp}', 0.55, 1.9 + j * 0.42, 3.6, 0.4, size=11, color=C_GRAY)

    add_rect(slide, 4.5, 1.3, 4.3, 5.6, RGBColor(0x1A, 0x1A, 0x2E))
    add_text(slide, 'GPT-4.1-nano', 4.7, 1.4, 3.9, 0.4, size=14, bold=True, color=C_GOLD)
    add_text(slide, '부동산 경매 전문가\n+ 감정평가사 역할', 4.7, 1.9, 3.9, 0.55,
             size=11, color=RGBColor(0xCC, 0xDD, 0xFF))
    add_text(slide, 'JSON 형식 강제 응답\nresponse_format={"type":"json_object"}',
             4.7, 2.6, 3.9, 0.55, size=10, color=RGBColor(0xAA, 0xBB, 0xFF))

    model_tags = [
        ('최저가 모델', C_GOLD), ('JSON 응답 보장', C_GREEN), ('OpenAI SDK', C_BLUE),
    ]
    for j, (tag, color) in enumerate(model_tags):
        by = 3.35 + j * 0.55
        add_rect(slide, 4.65, by, 3.8, 0.42, RGBColor(0x2A, 0x2A, 0x4E))
        add_text(slide, tag, 4.65, by + 0.05, 3.8, 0.35,
                 size=12, bold=True, color=color, align=PP_ALIGN.CENTER)

    add_text(slide, 'API 오류 시 → 룰 기반 백업\n(권리등급 기반 점수 자동 할당)', 4.7, 5.4, 3.9, 0.6,
             size=10, color=RGBColor(0x88, 0x99, 0xCC))

    add_rect(slide, 9.1, 1.3, 4.0, 5.6, RGBColor(0xF0, 0xFF, 0xF4))
    add_text(slide, '출력 (Output)', 9.3, 1.4, 3.6, 0.4, size=14, bold=True, color=C_GREEN)
    outputs = [
        ('score', '0~100점  투자 종합 점수'),
        ('grade', 'A/B/C/D  등급'),
        ('verdict', '한줄 판정 요약'),
        ('buy_signal', 'True / False  즉시 입찰 신호'),
        ('expected_yield', '예상 실효 수익률 %'),
        ('suggested_bid', '추천 입찰가 범위'),
        ('extinguished_rights', '말소 권리 목록'),
        ('retained_rights', '인수 권리 목록'),
        ('key_points', '가치 요인'),
        ('risks', '현장·권리 리스크'),
    ]
    for j, (key, desc) in enumerate(outputs):
        yy = 1.88 + j * 0.4
        add_text(slide, key, 9.3, yy, 1.6, 0.38, size=10, bold=True, color=C_TEAL)
        add_text(slide, desc, 10.9, yy, 2.0, 0.38, size=10, color=C_GRAY)

    # 등급 설명
    add_rect(slide, 0.4, 7.0, 12.7, 0.05, C_GRAY)


def slide_06_grade_dist(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, 'AI 분석 결과 — 등급 분포', '실제 수집된 346건 기준 (2026-06)')
    slide_number(slide, 6)

    img = chart_grade_distribution()
    slide.shapes.add_picture(img, Inches(0.4), Inches(1.2), Inches(12.5), Inches(5.0))

    add_text(slide, '★  A등급 81건 (23.4%) — 즉시 입찰 검토 대상',
             0.5, 6.35, 12.0, 0.4, size=13, bold=True, color=C_GREEN)
    add_text(slide, '  D등급은 198건 (57.2%)으로 과반수 — 경매 시장 일반적 품질 분포 반영',
             0.5, 6.72, 12.0, 0.35, size=11, color=C_GRAY)


def slide_07_naver(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '네이버 부동산 크롤링', '역공학 API + Playwright Stealth')
    slide_number(slide, 7)

    add_rect(slide, 0.4, 1.3, 5.8, 5.6, RGBColor(0xF0, 0xFE, 0xFB))
    add_text(slide, '크롤링 전략', 0.6, 1.4, 5.4, 0.45, size=14, bold=True, color=C_TEAL)

    strategy = [
        ('1. 세션 획득', 'fin.land.naver.com에서\nPlaywright Stealth로 쿠키·세션 확보'),
        ('2. 법정동 코드 조회', 'GET /legalDivision/searchByCoordinate\n좌표 → Naver 내부 legalDivisionNumber'),
        ('3. 매물 수집', 'POST /front-api/v1/article/boundedArticles\npage.evaluate(fetch()) — same-origin 필수'),
        ('4. 페이지네이션', 'articlePagingRequest.lastInfo 커서 방식\n429 방지: context.request.post 불가'),
    ]
    for j, (step, desc) in enumerate(strategy):
        yy = 1.95 + j * 1.2
        add_rect(slide, 0.55, yy, 5.4, 0.95, RGBColor(0xE0, 0xFA, 0xF5))
        add_text(slide, step, 0.65, yy + 0.05, 5.2, 0.35, size=12, bold=True, color=C_TEAL)
        add_text(slide, desc, 0.65, yy + 0.38, 5.2, 0.55, size=10, color=C_GRAY)

    add_rect(slide, 6.6, 1.3, 6.3, 2.7, RGBColor(0xF7, 0xF9, 0xFF))
    add_text(slide, 'Request 구조 (핵심)', 6.8, 1.4, 5.9, 0.4, size=14, bold=True, color=C_DARK)
    req_lines = [
        'filter.tradeTypes: ["A1","B1","B2"]',
        'filter.realEstateTypes: ["D03","D04","E01","Z00"]',
        '  D03=상가/빌딩  D04=상가건물',
        '  E01=사무실      Z00=건물',
        'filter.legalDivisionNumbers: ["4111312600"]',
        'boundingBox: {left, right, top, bottom}',
        'articlePagingRequest.size: 30',
    ]
    for j, line in enumerate(req_lines):
        color = C_BLUE if not line.startswith(' ') else C_GRAY
        add_text(slide, line, 6.8, 1.9 + j * 0.27, 5.9, 0.27, size=9.5,
                 bold=not line.startswith(' '), color=color)

    add_rect(slide, 6.6, 4.15, 6.3, 2.6, RGBColor(0xF4, 0xFF, 0xF4))
    add_text(slide, '수집 커버리지', 6.8, 4.25, 5.9, 0.4, size=14, bold=True, color=C_GREEN)
    coverage = [
        '서울: 마포구, 구로구, 중구 (시범)',
        '경기: 수원·성남·안양·용인·안산·구리',
        '인천: 미추홀구',
        '',
        '가격 단위: 원 → DB 저장 시 만원 변환',
        'naver_listings 592건 수집 완료',
    ]
    for j, c in enumerate(coverage):
        color = C_GREEN if ('서울' in c or '경기' in c or '인천' in c) else C_GRAY
        add_text(slide, c, 6.8, 4.72 + j * 0.33, 5.9, 0.33, size=11,
                 bold=('서울' in c or '경기' in c or '인천' in c), color=color)

    img2 = chart_naver_region()
    slide.shapes.add_picture(img2, Inches(0.4), Inches(5.3), Inches(5.8), Inches(2.1))


def slide_08_compare(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '경매 × 시세 비교 분석', 'compare.py — 할인율 · 예상 수익률 자동 계산')
    slide_number(slide, 8)

    img = chart_compare_logic()
    slide.shapes.add_picture(img, Inches(0.4), Inches(1.2), Inches(12.5), Inches(3.5))

    # 계산 공식 설명
    add_rect(slide, 0.4, 4.85, 5.8, 2.4, RGBColor(0xF0, 0xFF, 0xF4))
    add_text(slide, '할인율 계산', 0.6, 4.95, 5.4, 0.4, size=14, bold=True, color=C_GREEN)
    add_text(slide, '할인율 = (1 - 최저매각가 / 감정가) × 100\n\n예) 감정가 3억, 최저가 2억 1천만 → 30% 할인', 0.6, 5.42, 5.4, 0.9,
             size=12, color=C_GRAY)
    add_text(slide, 'match: legal_div_no (법정동 코드) 일치 우선\n폴백: addr_emd (읍면동명) 유사도 매칭', 0.6, 6.4, 5.4, 0.65,
             size=11, color=C_TEAL)

    add_rect(slide, 6.8, 4.85, 5.8, 2.4, RGBColor(0xF7, 0xF9, 0xFF))
    add_text(slide, '수익률 계산', 7.0, 4.95, 5.4, 0.4, size=14, bold=True, color=C_BLUE)
    add_text(slide, '연수익률 = (월세 × 12 / 낙찰가) × 100\n\n예) 낙찰가 2.1억, 월세 80만 → 연 4.6%', 7.0, 5.42, 5.4, 0.9,
             size=12, color=C_GRAY)
    add_text(slide, 'CLI 필터: --region, --min-yield, --max-bid\n현재 108건 면적정보 보유 (비교 활성)', 7.0, 6.4, 5.4, 0.65,
             size=11, color=C_TEAL)


def slide_09_dashboard(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, 'Streamlit 대시보드', 'dashboard.py — 3탭 구성')
    slide_number(slide, 9)

    tabs = [
        ('Tab 1\n경매 물건', C_DARK, [
            'AI 점수 내림차순 정렬',
            '감정가 / 최저가 / 할인율',
            '등급 배지 (A~D 색상 구분)',
            '유찰횟수 강조 표시',
            '소재지 필터 + 검색',
        ]),
        ('Tab 2\n네이버 시세', C_TEAL, [
            '매물 목록 (전세/월세/매매)',
            '지역별 평균 시세',
            '면적 단위 (㎡ / 평)',
            '거래유형 필터',
            '최근 수집일 표시',
        ]),
        ('Tab 3\n경매 × 시세 비교', C_GREEN, [
            '법정동 코드 매칭 결과',
            '경매 할인율 컬럼',
            '예상 월세 수익률',
            '매칭 네이버 매물 수',
            'min-yield / max-bid 필터',
        ]),
    ]

    for i, (title, color, items) in enumerate(tabs):
        bx = 0.4 + i * 4.25
        add_rect(slide, bx, 1.3, 3.9, 5.5, RGBColor(0xF7, 0xF9, 0xFF))
        add_rect(slide, bx, 1.3, 3.9, 0.7, color)
        add_text(slide, title, bx + 0.15, 1.35, 3.6, 0.65,
                 size=14, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)
        for j, item in enumerate(items):
            add_text(slide, f'  •  {item}', bx + 0.15, 2.1 + j * 0.55, 3.6, 0.5,
                     size=12, color=C_GRAY)

    add_text(slide, 'streamlit run dashboard.py  —  실시간 DB 읽기 (60초 캐시)',
             0.4, 6.95, 12.5, 0.4, size=13, bold=True, color=C_DARK, align=PP_ALIGN.CENTER)


def slide_10_hermes(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, 'Hermes 모니터링 에이전트', '24시간 운영 감시 + Slack 알람 + Aider 자동 디버깅')
    slide_number(slide, 10)

    add_rect(slide, 0.4, 1.3, 5.8, 3.2, RGBColor(0xFF, 0xF9, 0xE6))
    add_text(slide, '동작 방식', 0.6, 1.4, 5.4, 0.4, size=14, bold=True, color=C_GOLD)
    steps = [
        '① logs/events.jsonl 30초마다 폴링 (커서 파일로 중복 방지)',
        '② agent_inbox/hermes/ 리포트 파일 감지',
        '③ 에러 카테고리별 Slack #ops-hermes 포맷 전송',
        '④ IP_BLOCK 2회 / PARSE_ERROR 3회 → Aider 태스크 자동 생성',
    ]
    for j, s in enumerate(steps):
        add_text(slide, s, 0.6, 1.9 + j * 0.55, 5.4, 0.52, size=11, color=C_GRAY)

    add_rect(slide, 0.4, 4.6, 5.8, 2.2, RGBColor(0xFF, 0xF3, 0xCD))
    add_text(slide, '에러 카테고리', 0.6, 4.7, 5.4, 0.4, size=14, bold=True, color=C_DARK)
    cats = [
        ('IP_BLOCK', '🚨', '#E53E3E', '크롤러 IP 차단'),
        ('PARSE_ERROR', '⚠️', '#DD6B20', '페이지 파싱 실패'),
        ('API_ERROR', '🔶', '#D69E2E', 'OpenAI API 오류'),
        ('TIMEOUT', '⏱', '#718096', '응답 타임아웃'),
    ]
    for j, (cat, emoji, color_hex, desc) in enumerate(cats):
        x_offset = 0.65 + (j % 2) * 2.8
        y_offset = 5.22 + (j // 2) * 0.7
        add_text(slide, f'{emoji} {cat}: {desc}', x_offset, y_offset, 2.6, 0.45,
                 size=10.5, bold=(j < 2), color=C_DARK)

    add_rect(slide, 6.6, 1.3, 6.3, 5.5, RGBColor(0xF7, 0xF9, 0xFF))
    add_text(slide, 'Slack 메시지 구조', 6.8, 1.4, 5.9, 0.4, size=14, bold=True, color=C_DARK)
    slack_lines = [
        'attachment: color (카테고리별)',
        '  title: "[Hermes] ⚠️ PARSE_ERROR 감지"',
        '  fields:',
        '    - 발생시각: 2026-06-18 02:31:44',
        '    - 에러코드: PARSE_ERROR',
        '    - 상세: XHR 응답 빈값 (case_number 누락)',
        '    - 연속 발생: 3회',
        '',
        '→ 3회 초과 시:',
        '  agent_inbox/aider/<timestamp>.json 생성',
        '  Aider 자동 디버깅 태스크 큐잉',
    ]
    for j, line in enumerate(slack_lines):
        color = C_BLUE if line.startswith('attachment') or line.startswith('→') else C_GRAY
        bold = line.startswith('→')
        add_text(slide, line, 6.8, 1.88 + j * 0.37, 5.9, 0.37,
                 size=10, bold=bold, color=color)

    add_text(slide, '실행 모드:  --once (일회성)  /  --summary (일일 요약)  /  상시 데몬',
             0.4, 6.95, 12.5, 0.35, size=12, color=C_GRAY, align=PP_ALIGN.CENTER)


def slide_11_data_status(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '수집 현황', '실제 DB 데이터 기준 (2026-06)')
    slide_number(slide, 11)

    img_vol = chart_data_volume()
    slide.shapes.add_picture(img_vol, Inches(0.4), Inches(1.2), Inches(6.5), Inches(3.0))

    # 상위 A등급 물건 테이블
    add_rect(slide, 7.0, 1.2, 6.0, 0.5, C_DARK)
    add_text(slide, 'AI 점수 상위 A등급 물건 예시', 7.1, 1.27, 5.8, 0.35,
             size=13, bold=True, color=C_WHITE)

    top_items = [
        ('2022타경106133', '서울 종로구 평창동', 85, '144.8억'),
        ('2022타경112823', '서울 성북구 삼선동', 85,  '31.1억'),
        ('2024타경102050', '경기 안양시 관양동', 85, '128.0억'),
        ('2024타경68541',  '경기 안산시 월피동', 85,   '3.0억'),
        ('2023타경2513',   '경기 의정부시',       85,   '2.7억'),
    ]
    headers = ['사건번호', '소재지', 'AI점수', '감정가']
    col_xs = [7.1, 9.2, 11.2, 11.9]
    col_ws = [2.0, 2.0, 0.65, 1.0]
    for ci, (hdr, cx, cw) in enumerate(zip(headers, col_xs, col_ws)):
        add_rect(slide, cx, 1.72, cw, 0.38, RGBColor(0x21, 0x6B, 0xE5))
        add_text(slide, hdr, cx + 0.02, 1.75, cw - 0.04, 0.32,
                 size=10, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)
    for ri, (case, loc, score, appr) in enumerate(top_items):
        row_bg = RGBColor(0xF7, 0xF9, 0xFF) if ri % 2 == 0 else C_WHITE
        add_rect(slide, 7.1, 2.12 + ri * 0.4, 5.8, 0.38, row_bg)
        row_data = [case, loc, str(score), appr]
        for ci, (val, cx, cw) in enumerate(zip(row_data, col_xs, col_ws)):
            color = C_GREEN if ci == 2 else C_DARK
            add_text(slide, val, cx + 0.02, 2.15 + ri * 0.4, cw - 0.04, 0.35,
                     size=9.5, bold=(ci == 2), color=color, align=PP_ALIGN.CENTER if ci in (2, 3) else PP_ALIGN.LEFT)

    # 비교 현황
    add_rect(slide, 0.4, 4.3, 6.5, 2.85, RGBColor(0xF0, 0xFF, 0xF4))
    add_text(slide, '비교 분석 현황', 0.6, 4.4, 6.1, 0.4, size=14, bold=True, color=C_GREEN)
    status_items = [
        ('경매 전체', '346건', C_DARK),
        ('AI 분석 완료', '346건 (100%)', C_GREEN),
        ('면적정보 보유 경매', '108건 → 비교 가능', C_BLUE),
        ('네이버 시세 매물', '592건', C_TEAL),
        ('경매×시세 매칭 가능', '108건 경매 × 해당 지역 시세', C_GOLD),
    ]
    for j, (label, val, color) in enumerate(status_items):
        y = 4.88 + j * 0.42
        add_text(slide, label, 0.6, y, 3.2, 0.38, size=11.5, color=C_GRAY)
        add_text(slide, val, 3.9, y, 2.8, 0.38, size=11.5, bold=True, color=color)

    add_rect(slide, 7.0, 4.3, 6.0, 2.85, RGBColor(0xFF, 0xF9, 0xE6))
    add_text(slide, '네이버 시세 지역 커버', 7.2, 4.4, 5.6, 0.4, size=14, bold=True, color=C_GOLD)
    naver_regions = [
        '마포구 150건  |  안양시 동안구 99건',
        '수원시 권선구 66건  |  성남시 분당구 62건',
        '구리시 57건  |  구로구 53건',
        '용인시 수지구 45건  |  안산시 단원구 34건',
        '인천 미추홀구 13건  外',
    ]
    for j, r in enumerate(naver_regions):
        add_text(slide, r, 7.2, 4.88 + j * 0.42, 5.6, 0.38, size=11, color=C_GRAY)


def slide_12_roadmap(prs):
    slide = add_slide(prs)
    slide_bg(slide)
    header_bar(slide, '향후 계획', '미해결 항목 및 개선 로드맵')
    slide_number(slide, 12)

    items = [
        ('완료', C_GREEN, [
            '서울 5개 법원 순회 크롤링',
            'GPT-4.1-nano 권리분석 + 점수화',
            '네이버 부동산 상가 시세 수집',
            'compare.py 할인율·수익률 계산',
            'Streamlit 3탭 대시보드',
            'Hermes 모니터링 에이전트',
        ]),
        ('진행 중', C_GOLD, [
            'area_m2 경기도 경매 재크롤링',
            '→ compare.py 비교 활성화 확대',
            '주거용 임차인 파싱 검증\n  (현재 토지 물건만 테스트)',
        ]),
        ('계획', C_BLUE, [
            '로그인 연동 → 2주 날짜 제한 해제',
            '경기 법원 B코드 확정\n  (수원·성남·안양지원)',
            '서울 상권 시세 커버리지 확대',
            '자동 일일 크롤링 스케줄러',
            '카카오톡 / 텔레그램 알람 연동',
        ]),
    ]

    for i, (status, color, sub_items) in enumerate(items):
        bx = 0.4 + i * 4.25
        add_rect(slide, bx, 1.3, 3.9, 0.55, color)
        add_text(slide, status, bx + 0.15, 1.35, 3.6, 0.45,
                 size=16, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)
        add_rect(slide, bx, 1.85, 3.9, 4.8, RGBColor(0xF7, 0xF9, 0xFF))
        for j, item in enumerate(sub_items):
            add_text(slide, f'  •  {item}', bx + 0.1, 2.0 + j * 0.62, 3.7, 0.6,
                     size=12, color=C_GRAY)

    add_text(slide,
             '목표: 법원경매 물건 탐색 시간 90% 단축  —  수익성 있는 물건만 자동 필터링',
             0.4, 6.8, 12.5, 0.45, size=14, bold=True, color=C_DARK, align=PP_ALIGN.CENTER)


# ══════════════════════════════════════════════════════════════
# 메인 실행
# ══════════════════════════════════════════════════════════════

def main():
    prs = Presentation()
    prs.slide_width = Inches(13.33)
    prs.slide_height = Inches(7.5)

    print("슬라이드 생성 중...")
    slide_01_title(prs);    print("  1/12 타이틀")
    slide_02_overview(prs); print("  2/12 프로젝트 개요")
    slide_03_architecture(prs); print("  3/12 시스템 아키텍처")
    slide_04_crawling(prs); print("  4/12 법원경매 크롤링")
    slide_05_ai_engine(prs); print("  5/12 AI 분석 엔진")
    slide_06_grade_dist(prs); print("  6/12 등급 분포")
    slide_07_naver(prs);    print("  7/12 네이버 크롤링")
    slide_08_compare(prs);  print("  8/12 시세 비교 분석")
    slide_09_dashboard(prs); print("  9/12 대시보드")
    slide_10_hermes(prs);   print(" 10/12 Hermes 모니터링")
    slide_11_data_status(prs); print(" 11/12 수집 현황")
    slide_12_roadmap(prs);  print(" 12/12 로드맵")

    out_path = os.path.join(os.path.dirname(__file__), "auction_agent_발표자료.pptx")
    prs.save(out_path)
    print(f"\n저장 완료: {out_path}")


if __name__ == "__main__":
    main()
