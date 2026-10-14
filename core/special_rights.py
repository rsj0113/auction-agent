"""
매각물건명세서 비고란 및 등기부 특수권리 자동 감지 & 태깅 엔진 (Special Rights Tagging Engine)
- 유치권, 위반건축물, 대지권미등기, 지분매각, 법정지상권, 농취증, 분묘기지권, 재매각 등 자동 태깅
"""

import re
import json
from typing import List, Dict, Optional, Any

TAG_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "lien",
        "name": "유치권 신고 있음",
        "short": "유치권",
        "badge_color": "bg-red-100 text-red-700 border-red-200",
        "risk_level": "CRITICAL",
        "icon": "🚨",
        "desc": "공사대금 등 유치권 신고가 접수된 매물입니다. 낙찰자에게 대항할 수 있는 유치권인지 점유 및 피담보채권의 실재성을 철저히 조사해야 합니다.",
        "patterns": [r"유치권", r"유치권자", r"유치권\s*신고"]
    },
    {
        "id": "violation",
        "name": "위반건축물",
        "short": "위반건축물",
        "badge_color": "bg-rose-100 text-rose-700 border-rose-200",
        "risk_level": "HIGH",
        "icon": "⚠️",
        "desc": "건축물대장상 위반건축물로 등재된 매물입니다. 시가표준액 기준 매년 이행강제금이 반복 부과될 수 있으며 원상복구 의무가 따릅니다.",
        "patterns": [r"위반건축", r"불법건축", r"이행강제금", r"무단증축", r"위반등재"]
    },
    {
        "id": "land_rights",
        "name": "대지권 미등기/별도등기",
        "short": "대지권미등기",
        "badge_color": "bg-amber-100 text-amber-800 border-amber-200",
        "risk_level": "HIGH",
        "icon": "⚠️",
        "desc": "토지 지분이 미등기 또는 토지 등기부에 별도등기가 설정되어 있습니다. 분양대금 완납 증명 및 대지권 취득 가능 여부를 반드시 확인해야 합니다.",
        "patterns": [r"대지권\s*미등기", r"대지권미등기", r"별도등기", r"토지별도등기", r"대지권\s*없음"]
    },
    {
        "id": "share",
        "name": "지분 매각",
        "short": "지분매각",
        "badge_color": "bg-purple-100 text-purple-700 border-purple-200",
        "risk_level": "MEDIUM",
        "icon": "ℹ️",
        "desc": "부동산 전체가 아닌 특정 공유자의 지분만 경매되는 매물입니다. 전체 배타적 점유가 불가하며 공유자 우선매수권 또는 공유물분할 청구 소송이 필요합니다.",
        "patterns": [r"지분\s*매각", r"지분매각", r"공유지분", r"지분경매", r"지분\s*경매", r"지분임"]
    },
    {
        "id": "superficies",
        "name": "법정지상권 성립여지",
        "short": "법정지상권",
        "badge_color": "bg-orange-100 text-orange-800 border-orange-200",
        "risk_level": "HIGH",
        "icon": "🏛️",
        "desc": "토지만 매각되는 사건 등으로 지상 건물 소유자를 위한 법정지상권이 성립할 여지가 있어 토지 인도 청구 및 지료 산정이 쟁점이 됩니다.",
        "patterns": [r"법정지상권", r"지상권\s*성립", r"지상권성립"]
    },
    {
        "id": "farmland",
        "name": "농취증(농지취득자격) 필요",
        "short": "농취증",
        "badge_color": "bg-emerald-100 text-emerald-800 border-emerald-200",
        "risk_level": "MEDIUM",
        "icon": "🌾",
        "desc": "농지(전·답·과수원)로서 낙찰 후 최고가매수신고인 증명서를 발급받아 관할 지자체에서 농지취득자격증명을 기일 내 제출해야 하며, 미제출 시 보증금이 몰수됩니다.",
        "patterns": [r"농취증", r"농지취득자격", r"농지취득"]
    },
    {
        "id": "grave",
        "name": "분묘기지권 성립여지",
        "short": "분묘기지권",
        "badge_color": "bg-stone-100 text-stone-700 border-stone-300",
        "risk_level": "MEDIUM",
        "icon": "🪦",
        "desc": "토지 내 분묘(묘지)가 소재하여 분묘기지권이 성립할 수 있으며 분묘 굴이(이장)가 제한될 수 있습니다.",
        "patterns": [r"분묘기지권", r"분묘\s*소재", r"분묘기지", r"분묘"]
    },
    {
        "id": "resale",
        "name": "재매각 (보증금 20~30%)",
        "short": "재매각",
        "badge_color": "bg-red-100 text-red-800 border-red-300",
        "risk_level": "HIGH",
        "icon": "🔄",
        "desc": "이전 낙찰자의 대금 미납으로 다시 경매되는 물건입니다. 통상 입찰보증금이 최저가의 20~30%로 상향 적용되며 이전 낙찰자의 미납 사유를 철저히 조사해야 합니다.",
        "patterns": [r"재매각", r"특별매각조건"]
    },
    {
        "id": "prior_provisional",
        "name": "선순위 가처분/가등기",
        "short": "선순위가처분",
        "badge_color": "bg-rose-100 text-rose-800 border-rose-300",
        "risk_level": "CRITICAL",
        "icon": "🚨",
        "desc": "말소기준권리보다 앞선 처분금지가처분 또는 소유권이전청구권가등기로 낙찰자가 소유권을 상실할 위험이 있는 고위험 권리입니다.",
        "patterns": [r"선순위\s*가처분", r"선순위\s*가등기", r"처분금지가처분"]
    }
]


def extract_special_rights(
    remarks: str = "",
    location: str = "",
    usage: str = "",
    rights_list: Optional[Any] = None,
    ai_report: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    매각물건명세서 비고란, 위치, 용도, 등기부 권리내역, AI 리포트를 종합 스캔하여
    특수권리 태그 목록을 반환합니다.
    """
    found: List[Dict[str, Any]] = []
    
    # 텍스트 코퍼스 구성 (비고란 최우선)
    corpus_parts = [remarks or "", location or "", usage or ""]
    
    if ai_report and isinstance(ai_report, dict):
        for r in ai_report.get("retained_rights", []):
            if r and r != "없음":
                corpus_parts.append(str(r))
        for risk in ai_report.get("risks", []):
            if risk:
                corpus_parts.append(str(risk))
        if ai_report.get("analysis_detail"):
            corpus_parts.append(str(ai_report["analysis_detail"]))
            
    if rights_list:
        if isinstance(rights_list, str):
            corpus_parts.append(rights_list)
        elif isinstance(rights_list, list):
            for r in rights_list:
                if isinstance(r, dict) and "name" in r:
                    corpus_parts.append(r["name"])

    corpus = " ".join(corpus_parts)

    # 1. 농지 체크 (용도 또는 소재지에 전/답/과수원 포함 시)
    is_farmland = any(u in (usage or "") for u in ["전", "답", "과수원", "농지"]) or ("농지" in (location or ""))
    if is_farmland:
        for t in TAG_DEFINITIONS:
            if t["id"] == "farmland":
                found.append({k: t[k] for k in ("id", "name", "short", "badge_color", "risk_level", "icon", "desc")})
                break

    # 2. 패턴 매칭
    for t in TAG_DEFINITIONS:
        if any(item["id"] == t["id"] for item in found):
            continue
        
        matched = False
        for pat in t["patterns"]:
            if re.search(pat, corpus):
                matched = True
                break
        
        if matched:
            found.append({k: t[k] for k in ("id", "name", "short", "badge_color", "risk_level", "icon", "desc")})

    return found


def has_critical_special_rights(tags: List[Dict[str, Any]]) -> bool:
    """위험도가 CRITICAL 또는 HIGH인 특수권리가 포함되어 있는지 여부"""
    return any(t.get("risk_level") in ("CRITICAL", "HIGH") for t in tags)
