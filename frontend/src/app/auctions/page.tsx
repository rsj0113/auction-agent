"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import InvestmentCalculator from "@/components/InvestmentCalculator";
import AuctionMap, { formatNaverPrice10k } from "@/components/AuctionMap";

export interface OnbidItem {
  cltr_no: string;
  onbid_cltr_no?: string;
  cltr_nm: string;
  addr_sido?: string;
  addr_sgg?: string;
  addr_emd?: string;
  addr_full?: string;
  prpt_div?: string;
  disposal_method?: string;
  usage?: string;
  appraisal: number;
  min_bid: number;
  discount_pct: number;
  bid_status?: string;
  remain_time?: string;
  bid_start_date?: string;
  bid_end_date?: string;
  floor: number;
  is_first_floor: number;
  land_area_m2?: number;
  bld_area_m2?: number;
  bld_area_pyeong: number;
  reg_org_nm?: string;
  detail_url?: string;
  is_favorite?: number;
  recommend_tag?: string;
  scraped_at?: string;
}

export interface NaverListing {
  article_id: string;
  region_name?: string;
  addr_sgg?: string;
  addr_emd: string;
  article_name?: string;
  trade_type: string;
  trade_type_cd?: string;
  realty_type_cd?: string;
  price_sale_10k: number;
  deposit_10k: number;
  monthly_rent_10k: number;
  floor: number;
  total_floor: number;
  area_m2: number;
  area_pyeong: number;
  detail_url?: string;
  confirm_date?: string;
  realtor?: string;
  lat?: number;
  lng?: number;
  is_favorite?: number;
  recommend_tag?: string;
}

interface SampleListing {
  article_id?: string;
  article_name?: string;
  trade_type?: string;
  price_sale_10k?: number;
  area_m2?: number;
  area_pyeong?: number;
  floor?: number | string | null;
  total_floor?: number | string | null;
  detail_url?: string;
}

interface AuctionItem {
  case_number: string;
  location: string;
  usage?: string;
  appraisal: number;
  min_bid: number;
  failed_count: number;
  ai_grade: string;
  status_flag: string;
  auction_date?: string;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  is_payout_requested?: number;
  rights_list?: string;
  remarks?: string;
  special_rights?: string;
  market_price?: number;
  safety_margin?: number;
  market_discount_pct?: number;
  market_match_count?: number;
  market_match_level?: string;
  est_monthly_rent?: number;
  rental_yield?: number;
  last_updated?: string;
  created_at?: string;
  ai_model?: string;
  lat?: number;
  lng?: number;
  floor?: number;
  area_m2?: number;
  area_pyeong?: number;
  is_favorite?: number;
  recommend_tag?: string;
}

interface AIReport {
  verdict: string;
  risks: string[];
  retained_rights: string[];
  expected_yield: string;
  suggested_bid: string;
  analysis_detail?: string;
  tenants?: any[];
  ai_model?: string;
}

interface AuctionDetail extends AuctionItem {
  ai_report_json: string;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  is_payout_requested?: number;
  rights_list?: string;
  sample_listings?: SampleListing[];
  senior_deposit_assumed?: number;
  min_market_price?: number;
}

export function formatDateShort(dateStr?: string): string {
  if (!dateStr) return '-';
  // "2026-10-16 18:05:12" -> "10.16 18:05" or "2026.10.16"
  const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) {
    return m[4] ? `${m[1].slice(2)}.${m[2]}.${m[3]} ${m[4]}:${m[5]}` : `${m[1].slice(2)}.${m[2]}.${m[3]}`;
  }
  return dateStr;
}

export function formatMoney(val?: number): string {
  if (!val) return '0원';
  if (val >= 100000000) {
    const eok = Math.floor(val / 100000000);
    const man = Math.floor((val % 100000000) / 10000);
    return `${eok}억${man > 0 ? ` ${man.toLocaleString()}만` : ''}원`;
  }
  if (val >= 10000) {
    const man = Math.floor(val / 10000);
    return `${man.toLocaleString()}만원`;
  }
  return `${val.toLocaleString()}원`;
}

export function formatMoneyShort(val?: number): string {
  if (!val) return '0원';
  if (val >= 100000000) {
    const eok = (val / 100000000).toFixed(1).replace(/\.0$/, '');
    return `${eok}억`;
  }
  if (val >= 10000) {
    const man = Math.round(val / 10000);
    return `${man.toLocaleString()}만`;
  }
  return `${val.toLocaleString()}원`;
}

export function getMalsoStandard(rightsListJson?: string): { name: string; date: string } | null {
  if (!rightsListJson) return null;
  try {
    const list = typeof rightsListJson === 'string' ? JSON.parse(rightsListJson) : rightsListJson;
    if (!Array.isArray(list) || list.length === 0) return null;
    const malsoKeywords = ['담보가등기', '근저당', '가압류', '경매개시결정', '경매개시', '압류', '저당'];
    const candidates: { name: string; date: string }[] = [];
    for (const r of list) {
      const name = r.name || '';
      if (malsoKeywords.some(k => name.includes(k))) {
        if (r.date) {
          const cleanDate = r.date.replace(/[^0-9]/g, '');
          if (cleanDate.length >= 8) {
            candidates.push({ name, date: r.date });
          }
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.date.replace(/[^0-9]/g, '').localeCompare(b.date.replace(/[^0-9]/g, '')));
    return candidates[0];
  } catch {
    return null;
  }
}

export interface SeniorDepositAnalysis {
  malsoStandard: { name: string; date: string } | null;
  hasTenant: boolean;
  isSenior: boolean;
  seniorDeposit: number;
  seniorCount: number;
  unknownSeniorCount: number;
  seniorNoPayoutDeposit: number;
  seniorPayoutDeposit: number;
  juniorCount: number;
  totalTenantsCount: number;
  statusBadge: { text: string; color: string };
  depositText: string;
  summaryText: string;
  riskLevel: 'SAFE' | 'WARNING' | 'CRITICAL';
}

export function analyzeSeniorDeposit(
  rightsListJson?: string,
  tenantDate?: string,
  deposit?: number,
  isPayoutRequested?: number,
  tenants?: any[]
): SeniorDepositAnalysis {
  const malso = getMalsoStandard(rightsListJson);
  const cleanTenant = (tenantDate || '').replace(/[^0-9]/g, '');
  const cleanMalso = malso ? malso.date.replace(/[^0-9]/g, '') : '';
  const dep = deposit || 0;

  // 복수 임차인 목록(tenants)이 제공된 경우: 개별 임차인 전입일 및 보증금 정밀 합산
  if (tenants && Array.isArray(tenants) && tenants.length > 0) {
    let seniorCount = 0;
    let unknownSeniorCount = 0;
    let seniorDepositSum = 0;
    let seniorNoPayoutDeposit = 0;
    let seniorPayoutDeposit = 0;
    let juniorCount = 0;

    for (const t of tenants) {
      const tDateClean = (t.move_in_date || '').replace(/[^0-9]/g, '');
      let tDep = 0;
      if (typeof t.deposit === 'number') {
        tDep = t.deposit;
      } else if (typeof t.deposit === 'string') {
        const matches = t.deposit.match(/[\d,]+/g);
        if (matches) {
          tDep = parseInt(matches.join('').replace(/,/g, ''), 10) || 0;
        }
      }

      // 선순위 판정: 말소기준일이 있으면 비교, 없으면 보수적으로 선순위 간주
      const isIndivSenior = cleanMalso ? (tDateClean ? tDateClean < cleanMalso : true) : true;

      if (isIndivSenior) {
        seniorCount++;
        if (tDep > 0) {
          seniorDepositSum += tDep;
          if (t.is_payout_requested) {
            seniorPayoutDeposit += tDep;
          } else {
            seniorNoPayoutDeposit += tDep;
          }
        } else {
          unknownSeniorCount++;
        }
      } else {
        juniorCount++;
      }
    }

    if (seniorCount > 0) {
      const isCritical = seniorNoPayoutDeposit > 0 || (seniorDepositSum === 0 && unknownSeniorCount > 0);
      let badgeText = "";
      if (seniorCount > 1) {
        badgeText = seniorDepositSum > 0 
          ? `🚨 선순위 ${seniorCount}명 (${formatMoneyShort(seniorDepositSum)})`
          : `⚠️ 선순위 ${seniorCount}명 (미상)`;
      } else {
        badgeText = seniorDepositSum > 0
          ? `🚨 선순위 (${formatMoneyShort(seniorDepositSum)})`
          : `⚠️ 선순위 (미상)`;
      }

      let depText = "";
      if (seniorDepositSum > 0) {
        depText = `${formatMoney(seniorDepositSum)} 전액 합산 인수${unknownSeniorCount > 0 ? ` (+미상 ${unknownSeniorCount}명)` : ''}`;
      } else {
        depText = `보증금 미상 ${unknownSeniorCount}명 (전액 인수 위험)`;
      }

      let summary = `말소기준권리(${malso ? `${malso.name} ${malso.date}` : '등기 미확인'})보다 앞선 선순위 임차인이 총 ${seniorCount}명 존재합니다. `;
      if (seniorDepositSum > 0) {
        summary += `선순위 보증금 총 합계는 ${formatMoney(seniorDepositSum)}입니다. `;
      }
      if (seniorNoPayoutDeposit > 0) {
        summary += `이 중 배당 미요구 보증금 ${formatMoney(seniorNoPayoutDeposit)}은 낙찰자가 전액 인수해야 합니다. `;
      }
      if (seniorPayoutDeposit > 0) {
        summary += `배당 요구 보증금 ${formatMoney(seniorPayoutDeposit)}은 우선 배당되나 낙찰가 부족 시 잔액을 인수해야 합니다. `;
      }
      if (unknownSeniorCount > 0) {
        summary += `보증금이 확인되지 않은 선순위 임차인이 ${unknownSeniorCount}명 있어 추가 인수 위험이 있으므로 현황조사서 열람이 필수입니다.`;
      }

      return {
        malsoStandard: malso,
        hasTenant: true,
        isSenior: true,
        seniorDeposit: seniorDepositSum,
        seniorCount,
        unknownSeniorCount,
        seniorNoPayoutDeposit,
        seniorPayoutDeposit,
        juniorCount,
        totalTenantsCount: tenants.length,
        statusBadge: { 
          text: badgeText, 
          color: isCritical ? 'bg-red-100 text-red-800 border-red-300 font-bold' : 'bg-amber-100 text-amber-800 border-amber-300 font-bold' 
        },
        depositText: depText,
        summaryText: summary,
        riskLevel: isCritical ? 'CRITICAL' : 'WARNING'
      };
    } else if (juniorCount > 0) {
      return {
        malsoStandard: malso,
        hasTenant: true,
        isSenior: false,
        seniorDeposit: 0,
        seniorCount: 0,
        unknownSeniorCount: 0,
        seniorNoPayoutDeposit: 0,
        seniorPayoutDeposit: 0,
        juniorCount,
        totalTenantsCount: tenants.length,
        statusBadge: { text: `✅ 대항력 없음 (안전)`, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        depositText: '0원 (낙찰 시 권리 소멸)',
        summaryText: `등재된 ${juniorCount}명의 임차인 모두 말소기준권리(${malso ? `${malso.name} ${malso.date}` : ''}) 이후 전입하여 대항력이 없습니다. 경매 낙찰 시 권리가 모두 소멸되어 낙찰자가 인수할 보증금이 없습니다.`,
        riskLevel: 'SAFE'
      };
    }
  }

  // 단일 임차인 또는 tenants 미전달 시 fallback
  if (!cleanTenant || tenantDate === '임차인없음' || tenantDate === '해당없음') {
    return {
      malsoStandard: malso,
      hasTenant: false,
      isSenior: false,
      seniorDeposit: 0,
      seniorCount: 0,
      unknownSeniorCount: 0,
      seniorNoPayoutDeposit: 0,
      seniorPayoutDeposit: 0,
      juniorCount: 0,
      totalTenantsCount: 0,
      statusBadge: { text: '소유자 점유', color: 'bg-gray-100 text-gray-600 border-gray-200' },
      depositText: '0원 (인수 없음)',
      summaryText: '현황조사서상 대항력 있는 임차인이 확인되지 않아 낙찰자 인수 보증금이 없습니다.',
      riskLevel: 'SAFE'
    };
  }

  // 말소기준권리가 없는 경우
  if (!cleanMalso || !malso) {
    return {
      malsoStandard: null,
      hasTenant: true,
      isSenior: true,
      seniorDeposit: dep,
      seniorCount: 1,
      unknownSeniorCount: dep === 0 ? 1 : 0,
      seniorNoPayoutDeposit: isPayoutRequested ? 0 : dep,
      seniorPayoutDeposit: isPayoutRequested ? dep : 0,
      juniorCount: 0,
      totalTenantsCount: 1,
      statusBadge: { text: dep > 0 ? `선순위 추정 (${formatMoneyShort(dep)})` : '선순위 추정 (주의)', color: 'bg-amber-100 text-amber-800 border-amber-300' },
      depositText: dep > 0 ? `${formatMoney(dep)} (인수 주의)` : '보증금 미상 (주의)',
      summaryText: '등기상 말소기준권리를 특정할 수 없어 보수적으로 선순위 인수 가능성을 점검해야 합니다.',
      riskLevel: 'WARNING'
    };
  }

  // 선순위 여부 판단: 전입일자가 말소기준일보다 빠르면 선순위 대항력 보유
  const isSenior = cleanTenant < cleanMalso;

  if (isSenior) {
    if (!dep || dep === 0) {
      return {
        malsoStandard: malso,
        hasTenant: true,
        isSenior: true,
        seniorDeposit: 0,
        seniorCount: 1,
        unknownSeniorCount: 1,
        seniorNoPayoutDeposit: 0,
        seniorPayoutDeposit: 0,
        juniorCount: 0,
        totalTenantsCount: 1,
        statusBadge: { text: '⚠️ 선순위 (미상)', color: 'bg-red-100 text-red-800 border-red-300' },
        depositText: '보증금 미상 (전액 인수 위험)',
        summaryText: `말소기준권리(${malso.name} ${malso.date})보다 앞선 전입(${tenantDate})으로 대항력이 있습니다. 보증금이 미상이므로 낙찰자 전액 인수 위험이 커 현황조사서 및 임대차 서류 열람이 필수입니다.`,
        riskLevel: 'CRITICAL'
      };
    } else if (!isPayoutRequested) {
      return {
        malsoStandard: malso,
        hasTenant: true,
        isSenior: true,
        seniorDeposit: dep,
        seniorCount: 1,
        unknownSeniorCount: 0,
        seniorNoPayoutDeposit: dep,
        seniorPayoutDeposit: 0,
        juniorCount: 0,
        totalTenantsCount: 1,
        statusBadge: { text: `🚨 선순위 (${formatMoneyShort(dep)})`, color: 'bg-red-100 text-red-800 border-red-300 font-bold' },
        depositText: `${formatMoney(dep)} 전액 인수`,
        summaryText: `대항력 있는 선순위 임차인이 법원에 배당요구를 하지 않았습니다. 낙찰가 외에 보증금 ${formatMoney(dep)}을 낙찰자가 별도로 전액 물어줘야 합니다.`,
        riskLevel: 'CRITICAL'
      };
    } else {
      return {
        malsoStandard: malso,
        hasTenant: true,
        isSenior: true,
        seniorDeposit: dep,
        seniorCount: 1,
        unknownSeniorCount: 0,
        seniorNoPayoutDeposit: 0,
        seniorPayoutDeposit: dep,
        juniorCount: 0,
        totalTenantsCount: 1,
        statusBadge: { text: `선순위(배당): ${formatMoneyShort(dep)}`, color: 'bg-amber-100 text-amber-800 border-amber-300' },
        depositText: `최대 ${formatMoney(dep)} (배당 후 잔여액 인수)`,
        summaryText: `대항력 있는 선순위 임차인이 배당요구를 했습니다. 낙찰대금에서 우선 배당받으나, 낙찰가가 낮거나 세금 체납 등으로 배당받지 못한 잔여 보증금은 낙찰자가 인수합니다.`,
        riskLevel: 'WARNING'
      };
    }
  } else {
    return {
      malsoStandard: malso,
      hasTenant: true,
      isSenior: false,
      seniorDeposit: 0,
      seniorCount: 0,
      unknownSeniorCount: 0,
      seniorNoPayoutDeposit: 0,
      seniorPayoutDeposit: 0,
      juniorCount: 1,
      totalTenantsCount: 1,
      statusBadge: { text: '✅ 대항력 없음 (안전)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      depositText: '0원 (낙찰 시 권리 소멸)',
      summaryText: `말소기준권리(${malso.name} ${malso.date}) 이후 전입(${tenantDate})으로 대항력이 없습니다. 경매 낙찰 시 권리가 소멸되어 낙찰자가 인수할 보증금이 없습니다.`,
      riskLevel: 'SAFE'
    };
  }
}

function getPropertyType(location: string, usage?: string): string {
  if (!location && !usage) return "기타";
  const target = (usage || "") + " " + (location || "");
  
  // 상가/근린을 가장 먼저 체크 (예: "아파트 단지내 상가", "신촌럭키아파트 이룸타워" 등은 상가로 분류되어야 함)
  if (target.includes("상가") || target.includes("근린") || target.includes("타워") || target.includes("지식산업") || target.includes("프라자") || target.includes("플라자") || target.includes("센터") || target.includes("에이스")) return "상가/근린시설";
  
  if (target.includes("아파트")) return "🏢 아파트";
  if (target.includes("오피스텔")) return "🏬 오피스텔";
  if (target.includes("다세대") || target.includes("빌라")) return "🏘️ 빌라/다세대";
  if (target.includes("산") && target.match(/산\s*[0-9]+/)) return "🌲 임야(산)";
  if (target.includes("임야")) return "🌲 임야(산)";
  if (target.match(/[0-9]+번지/)) return "🗺️ 토지/대지";
  return "🏠 주택/기타";
}

export const QUICK_CHIPS = [
  { id: "", label: "전체", countKey: "total", icon: "📋" },
  { id: "favorite", label: "관심매물", countKey: "favorite", icon: "⭐" },
  { id: "golf_b1", label: "⛳ 지하1층 골프·체육(30평+)", countKey: "golf_b1", icon: "⛳" },
  { id: "first_floor_shop", label: "1층 상가", countKey: "first_floor_shop", icon: "🏪" },
  { id: "margin_100m", label: "안전마진 1억+", countKey: "margin_100m", icon: "🎯" },
  { id: "market_matched", label: "네이버 시세 검증", countKey: "market_matched", icon: "🏢" },
  { id: "clean", label: "깨끗한 일반물건", countKey: "clean", icon: "🛡️" },
  { id: "half_price", label: "반값 경매", countKey: "half_price", icon: "🔥" },
  { id: "owner", label: "소유자 점유", countKey: "owner", icon: "🏠" },
  { id: "apartment", label: "아파트", countKey: "apartment", icon: "🏢" },
  { id: "small_budget", label: "1억 이하", countKey: "small_budget", icon: "💰" },
  { id: "top_grade", label: "AI 추천", countKey: "top_grade", icon: "💎" },
  { id: "special", label: "특수권리 주의", countKey: "special", icon: "⚠️" },
];

export default function AuctionsPage() {
  // 자산 구분 상태 ('auction' | 'onbid' | 'naver')
  const [assetSource, setAssetSource] = useState<"auction" | "onbid" | "naver">("auction");

  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [onbidItems, setOnbidItems] = useState<OnbidItem[]>([]);
  const [naverListings, setNaverListings] = useState<NaverListing[]>([]);
  const [totalMatching, setTotalMatching] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // 보기 모드 ('list' | 'map')
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  // 퀵 필터 칩 상태
  const [quickFilter, setQuickFilter] = useState<string>("");
  const [quickCounts, setQuickCounts] = useState<{ [key: string]: number }>({});

  // 상세 필터 상태
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [priceFilter, setPriceFilter] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<string>("recent");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState<string>("");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [pyeongFilter, setPyeongFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [regionInput, setRegionInput] = useState<string>("");

  // 모달 상태 (법원경매 상세)
  const [selectedDetail, setSelectedDetail] = useState<AuctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // URL 파라미터(?source=... & ?qf=... & ?view=map & ?region=...) 및 퀵 필터 카운트 불러오기
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const srcParam = params.get("source");
      const qfParam = params.get("qf");
      const viewParam = params.get("view");
      const floorParam = params.get("floor");
      const pyeongParam = params.get("pyeong");
      const regParam = params.get("region");
      if (srcParam === "onbid" || srcParam === "naver" || srcParam === "auction") {
        setAssetSource(srcParam);
      }
      if (qfParam) setQuickFilter(qfParam);
      if (floorParam) setFloorFilter(floorParam);
      if (pyeongParam) setPyeongFilter(pyeongParam);
      if (viewParam === "map") setViewMode("map");
      if (regParam) {
        setRegionInput(regParam);
        setRegionFilter(regParam);
      }
    }
    fetch("/api/auctions/quick-counts", { headers: { "ngrok-skip-browser-warning": "1" } })
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.total === 'number') {
          setQuickCounts(data);
        }
      })
      .catch(err => console.error("퀵 필터 카운트 로딩 실패:", err));
  }, []);

  const fetchListings = async (
    pageIndex: number,
    sourceOverride?: "auction" | "onbid" | "naver",
    overrideParams?: {
      grade?: string;
      price?: string;
      sort?: string;
      propertyType?: string;
      region?: string;
      hasTenant?: string;
      quickFilter?: string;
      floor?: string;
      pyeong?: string;
    }
  ) => {
    try {
      if (pageIndex === 0) setLoading(true);
      const curSource = sourceOverride ?? assetSource;
      const grade = overrideParams?.grade ?? gradeFilter;
      const price = overrideParams?.price ?? priceFilter;
      const sort = overrideParams?.sort ?? sortOrder;
      const propertyType = overrideParams?.propertyType ?? propertyTypeFilter;
      const tenant = overrideParams?.hasTenant ?? tenantFilter;
      const floor = overrideParams?.floor ?? floorFilter;
      const pyeong = overrideParams?.pyeong ?? pyeongFilter;
      const region = overrideParams?.region ?? regionFilter;
      const qf = overrideParams?.quickFilter ?? quickFilter;
      const pageSize = viewMode === "map" ? 300 : 20;

      let minP: number | undefined;
      let maxP: number | undefined;
      if (price === "under1") maxP = 100000000;
      else if (price === "1to3") { minP = 100000000; maxP = 300000000; }
      else if (price === "3to5") { minP = 300000000; maxP = 500000000; }
      else if (price === "over5") { minP = 500000000; }

      let minPy: number | undefined;
      let maxPy: number | undefined;
      if (pyeong === "under10") maxPy = 10;
      else if (pyeong === "10to30") { minPy = 10; maxPy = 30; }
      else if (pyeong === "30to60") { minPy = 30; maxPy = 60; }
      else if (pyeong === "over60") { minPy = 60; }

      // 퀵 필터에 따른 조건 보정
      let effectiveFloor = floor;
      let effectiveMinPy = minPy;
      let effectiveMaxP = maxP;
      const isFavoriteOnly = qf === "favorite";

      if (qf === "golf_b1") {
        effectiveFloor = "b1";
        effectiveMinPy = 30;
      } else if (qf === "first_floor_shop") {
        effectiveFloor = "1f";
      } else if (qf === "small_budget") {
        effectiveMaxP = 100000000;
      }

      if (curSource === "auction") {
        let url = `/api/auctions?limit=${pageSize}&offset=${pageIndex * pageSize}`;
        if (grade) url += `&grade=${grade}`;
        if (sort && sort !== "default") url += `&sort=${sort}`;
        if (propertyType) url += `&property_type=${propertyType}`;
        if (tenant) url += `&has_tenant=${tenant}`;
        if (effectiveFloor) url += `&floor_type=${effectiveFloor}`;
        if (region) url += `&region=${encodeURIComponent(region)}`;
        if (qf) url += `&quick_filter=${qf}`;
        if (minP) url += `&min_price=${minP}`;
        if (effectiveMaxP) url += `&max_price=${effectiveMaxP}`;
        if (effectiveMinPy) url += `&min_pyeong=${effectiveMinPy}`;
        if (maxPy) url += `&max_pyeong=${maxPy}`;

        const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } });
        if (res.ok) {
          const data = await res.json();
          setHasMore(data.data.length >= pageSize);
          if (pageIndex === 0) setAuctions(data.data);
          else setAuctions(prev => [...prev, ...data.data]);
          if (typeof data.total_matching === "number") setTotalMatching(data.total_matching);
        }
      } else if (curSource === "onbid") {
        let url = `/api/onbid-items?limit=${pageSize}&offset=${pageIndex * pageSize}`;
        if (region) url += `&region=${encodeURIComponent(region)}`;
        if (effectiveFloor) url += `&floor_type=${effectiveFloor}`;
        if (isFavoriteOnly) url += `&favorite_only=true`;
        if (minP) url += `&min_price=${minP}`;
        if (effectiveMaxP) url += `&max_price=${effectiveMaxP}`;
        if (effectiveMinPy) url += `&min_pyeong=${effectiveMinPy}`;
        if (maxPy) url += `&max_pyeong=${maxPy}`;
        if (sort && sort !== "recent") url += `&sort=${sort}`;
        if (propertyType) {
          if (propertyType === "rent") url += `&disposal_method=임대`;
          else if (propertyType === "sale") url += `&disposal_method=매각`;
        }

        const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } });
        if (res.ok) {
          const data = await res.json();
          setHasMore(data.data.length >= pageSize);
          if (pageIndex === 0) setOnbidItems(data.data);
          else setOnbidItems(prev => [...prev, ...data.data]);
          if (typeof data.total_matching === "number") setTotalMatching(data.total_matching);
        }
      } else if (curSource === "naver") {
        let url = `/api/naver-listings?limit=${pageSize}&offset=${pageIndex * pageSize}`;
        if (region) url += `&region=${encodeURIComponent(region)}`;
        if (effectiveFloor) url += `&floor_type=${effectiveFloor}`;
        if (isFavoriteOnly) url += `&favorite_only=true`;
        if (minP) url += `&min_price=${minP}`;
        if (effectiveMaxP) url += `&max_price=${effectiveMaxP}`;
        if (effectiveMinPy) url += `&min_pyeong=${effectiveMinPy}`;
        if (maxPy) url += `&max_pyeong=${maxPy}`;
        if (sort && sort !== "recent") url += `&sort=${sort}`;
        if (propertyType) {
          if (propertyType === "rent") url += `&trade_type=월세`;
          else if (propertyType === "sale") url += `&trade_type=매매`;
        }

        const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } });
        if (res.ok) {
          const data = await res.json();
          setHasMore(data.data.length >= pageSize);
          if (pageIndex === 0) setNaverListings(data.data);
          else setNaverListings(prev => [...prev, ...data.data]);
          if (typeof data.total_matching === "number") setTotalMatching(data.total_matching);
        }
      }
    } catch (error) {
      console.error("데이터 로딩 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  // 필터 및 자산 구분 변경시 페이지 초기화 후 다시 호출
  useEffect(() => {
    setPage(0);
    const timer = setTimeout(() => {
      fetchListings(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [assetSource, gradeFilter, priceFilter, sortOrder, propertyTypeFilter, tenantFilter, floorFilter, pyeongFilter, regionFilter, quickFilter, viewMode]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchListings(nextPage);
  };

  const handleSelectAuction = async (item: AuctionItem) => {
    setSelectedDetail({ ...item, ai_report_json: "{}" } as AuctionDetail);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/auctions/${item.case_number}`, {
        headers: { "ngrok-skip-browser-warning": "1" }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedDetail(data.data);
      }
    } catch (error) {
      console.error("상세 데이터 로딩 실패:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleToggleFavorite = async (itemType: "auction" | "naver" | "onbid", itemId: string) => {
    try {
      if (itemType === "auction") {
        setAuctions((prev) =>
          prev.map((a) =>
            a.case_number === itemId ? { ...a, is_favorite: a.is_favorite ? 0 : 1 } : a
          )
        );
        if (selectedDetail && selectedDetail.case_number === itemId) {
          setSelectedDetail((prev) =>
            prev ? { ...prev, is_favorite: prev.is_favorite ? 0 : 1 } : null
          );
        }
      } else if (itemType === "onbid") {
        setOnbidItems((prev) =>
          prev.map((o) =>
            o.cltr_no === itemId ? { ...o, is_favorite: o.is_favorite ? 0 : 1 } : o
          )
        );
      } else if (itemType === "naver") {
        setNaverListings((prev) =>
          prev.map((n) =>
            n.article_id === itemId ? { ...n, is_favorite: n.is_favorite ? 0 : 1 } : n
          )
        );
      }

      const res = await fetch("/api/favorites/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ item_type: itemType, item_id: itemId }),
      });
      if (res.ok) {
        fetch("/api/auctions/quick-counts", { headers: { "ngrok-skip-browser-warning": "1" } })
          .then((r) => r.json())
          .then((data) => {
            if (data && typeof data.total === "number") setQuickCounts(data);
          })
          .catch(() => {});
      }
    } catch (e) {
      console.error("관심매물 토글 실패:", e);
    }
  };

  const handleResetFilters = () => {
    setQuickFilter("");
    setRegionFilter("");
    setRegionInput("");
    setPropertyTypeFilter("");
    setTenantFilter("");
    setFloorFilter("");
    setPyeongFilter("");
    setPriceFilter("");
    setGradeFilter("");
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'S': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'A': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'B': return 'bg-green-100 text-green-700 border-green-200';
      case 'C': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'D':
      case 'F': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const formatMoney = (val?: number) => {
    if (!val) return '0원';
    if (val >= 100000000) {
      const eok = Math.floor(val / 100000000);
      const man = Math.floor((val % 100000000) / 10000);
      return man > 0 ? `${eok}억 ${man}만` : `${eok}억`;
    }
    return `${Math.floor(val / 10000)}만`;
  };

  let aiReport: AIReport | null = null;
  if (selectedDetail && selectedDetail.ai_report_json) {
    try {
      aiReport = JSON.parse(selectedDetail.ai_report_json);
    } catch (e) {
      console.error("JSON 파싱 에러", e);
    }
  }

  const currentListLength =
    assetSource === "auction"
      ? auctions.length
      : assetSource === "onbid"
      ? onbidItems.length
      : naverListings.length;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-md mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-700 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">전체 매물 검색</h1>
              <p className="text-[11px] text-gray-500 font-medium">
                {assetSource === "auction" ? "⚖️ 법원경매" : assetSource === "onbid" ? "🏛️ 온비드 공매" : "🟢 네이버 상가"} · 총 {totalMatching.toLocaleString()}건
              </p>
            </div>
          </div>
          {/* 리스트 / 지도 보기 전환 탭 */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200">
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === "list"
                  ? "bg-white text-blue-600 shadow-2xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              📋 리스트
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === "map"
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              🗺️ 지도 + N상가
            </button>
          </div>
        </div>
      </header>

      <main className="w-full mx-auto px-4 sm:px-5 pt-5 max-w-5xl">
        {/* 🌟 핵심 3대 자산 구분 탭 (온비드 / 경매 / 네이버) */}
        <div className="flex items-center gap-1.5 sm:gap-2 p-1.5 bg-white rounded-2xl border border-gray-200/90 shadow-2xs mb-4">
          <button
            onClick={() => setAssetSource("auction")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              assetSource === "auction"
                ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30 scale-[1.01]"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            <span>⚖️ 법원경매</span>
            <span className={`text-[10px] sm:text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              assetSource === "auction" ? "bg-white/20 text-white" : "bg-blue-50 text-blue-700"
            }`}>
              {quickCounts.total ? quickCounts.total.toLocaleString() : "1,281"}
            </span>
          </button>

          <button
            onClick={() => setAssetSource("onbid")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              assetSource === "onbid"
                ? "bg-purple-600 text-white shadow-sm ring-2 ring-purple-600/30 scale-[1.01]"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            <span>🏛️ 온비드 공매</span>
            <span className={`text-[10px] sm:text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              assetSource === "onbid" ? "bg-white/20 text-white" : "bg-purple-50 text-purple-700"
            }`}>
              {quickCounts.onbid_total ? quickCounts.onbid_total.toLocaleString() : "626"}
            </span>
          </button>

          <button
            onClick={() => setAssetSource("naver")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              assetSource === "naver"
                ? "bg-[#03c75a] text-white shadow-sm ring-2 ring-emerald-500/30 scale-[1.01]"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            <span>🟢 네이버 상가</span>
            <span className={`text-[10px] sm:text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              assetSource === "naver" ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700"
            }`}>
              {quickCounts.naver_shops ? quickCounts.naver_shops.toLocaleString() : "4,740"}
            </span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2.5 mb-5 bg-gray-50/80 p-3.5 rounded-2xl border border-gray-200/80">
          <div className="flex gap-2">
            <input 
              type="text"
              placeholder={`${assetSource === "auction" ? "법원경매" : assetSource === "onbid" ? "온비드 공매" : "네이버 상가"} 지역 검색 (예: 성남, 분당, 강남)`}
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setRegionFilter(regionInput)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-gray-800 outline-none focus:border-blue-500 shadow-2xs"
            />
            <button 
              onClick={() => setRegionFilter(regionInput)}
              className="bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors shadow-2xs shrink-0"
            >
              검색
            </button>
          </div>

          {/* Quick Filter Chips (투자자용 원클릭 퀵 필터) */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                <span>⚡</span> <span>투자자 퀵 필터</span>
              </span>
              {(quickFilter || regionFilter || propertyTypeFilter || tenantFilter || floorFilter || pyeongFilter || priceFilter || gradeFilter) && (
                <button
                  onClick={handleResetFilters}
                  className="text-[11px] text-gray-500 hover:text-red-600 font-semibold flex items-center gap-1 transition-colors bg-white px-2 py-0.5 rounded-lg border border-gray-200"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  초기화
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {QUICK_CHIPS.map((chip) => {
                const isActive = quickFilter === chip.id;
                let count = quickCounts[chip.countKey];
                if (chip.id === "golf_b1") {
                  count = assetSource === "onbid" ? quickCounts["onbid_b1"] : assetSource === "naver" ? quickCounts["naver_b1"] : quickCounts["golf_b1"];
                } else if (chip.id === "first_floor_shop") {
                  count = assetSource === "onbid" ? quickCounts["onbid_first_floor"] : assetSource === "naver" ? quickCounts["naver_first_floor"] : quickCounts["first_floor_shop"];
                }
                return (
                  <button
                    key={chip.id}
                    onClick={() => setQuickFilter(isActive ? "" : chip.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30 font-bold scale-[1.02]"
                        : "bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 border border-gray-200 shadow-2xs"
                    }`}
                  >
                    <span>{chip.icon}</span>
                    <span>{chip.label}</span>
                    {typeof count === "number" && (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                        isActive ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"
                      }`}>
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* 네이버 지도 바로보기 버튼 */}
              <button
                onClick={() => setViewMode(viewMode === "map" ? "list" : "map")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "map"
                    ? "bg-[#03c75a] text-white shadow-sm ring-2 ring-emerald-500/30 scale-[1.02]"
                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 shadow-2xs"
                }`}
              >
                <span className="px-1 py-0.2 rounded bg-[#03c75a] text-white text-[9px] font-black">N</span>
                <span>지도 오버레이</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm pt-1">
            {/* 1. 자산별 맞춤 유형/방식 */}
            {assetSource === "auction" ? (
              <select 
                value={propertyTypeFilter} 
                onChange={(e) => setPropertyTypeFilter(e.target.value)}
                className="w-full text-xs sm:text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-2xs"
              >
                <option value="">전체 용도</option>
                <option value="commercial">🏪 상가/근린</option>
                <option value="apartment">🏢 아파트</option>
                <option value="officetel">🏬 오피스텔</option>
                <option value="villa">🏘️ 빌라/다세대</option>
                <option value="land">🌲 임야/토지</option>
              </select>
            ) : assetSource === "onbid" ? (
              <select 
                value={propertyTypeFilter} 
                onChange={(e) => setPropertyTypeFilter(e.target.value)}
                className="w-full text-xs sm:text-sm bg-white border border-purple-200 rounded-xl px-3 py-2 text-purple-900 font-semibold outline-none focus:border-purple-500 shadow-2xs"
              >
                <option value="">처분방식 전체</option>
                <option value="sale">🏷️ 매각만</option>
                <option value="rent">🔑 임대(대부)만</option>
              </select>
            ) : (
              <select 
                value={propertyTypeFilter} 
                onChange={(e) => setPropertyTypeFilter(e.target.value)}
                className="w-full text-xs sm:text-sm bg-white border border-emerald-200 rounded-xl px-3 py-2 text-emerald-900 font-semibold outline-none focus:border-emerald-500 shadow-2xs"
              >
                <option value="">거래유형 전체</option>
                <option value="sale">🏷️ 매매만</option>
                <option value="rent">🔑 월세만</option>
              </select>
            )}

            {/* 2. 층수 (1층 / 지하1층 / 2층이상) */}
            <select 
              value={floorFilter} 
              onChange={(e) => setFloorFilter(e.target.value)}
              className={`w-full text-xs sm:text-sm bg-white border rounded-xl px-3 py-2 outline-none shadow-2xs font-bold ${
                floorFilter === "b1" ? "border-purple-400 text-purple-700 bg-purple-50/50" : floorFilter === "1f" ? "border-orange-400 text-orange-700 bg-orange-50/50" : "border-gray-200 text-gray-700 focus:border-blue-500"
              }`}
            >
              <option value="">층수 전체</option>
              <option value="1f">🏪 1층만</option>
              <option value="b1">⛳ 지하1층 (B1 골프·체육)</option>
              <option value="upper">🏢 2층 이상</option>
            </select>

            {/* 3. 평수 (면적) */}
            <select 
              value={pyeongFilter} 
              onChange={(e) => setPyeongFilter(e.target.value)}
              className={`w-full text-xs sm:text-sm bg-white border rounded-xl px-3 py-2 outline-none shadow-2xs font-bold ${
                pyeongFilter === "over60" || pyeongFilter === "30to60" ? "border-blue-400 text-blue-700 bg-blue-50/50" : "border-gray-200 text-gray-700 focus:border-blue-500"
              }`}
            >
              <option value="">평수 전체</option>
              <option value="under10">소형 (~10평)</option>
              <option value="10to30">중형 (10~30평)</option>
              <option value="30to60">중대형 (30~60평)</option>
              <option value="over60">대형 (60평+ 골프장용)</option>
            </select>

            {/* 4. 가격 */}
            <select 
              value={priceFilter} 
              onChange={(e) => setPriceFilter(e.target.value)}
              className="w-full text-xs sm:text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-2xs"
            >
              <option value="">가격 전체</option>
              <option value="under1">1억 미만</option>
              <option value="1to3">1억 ~ 3억</option>
              <option value="3to5">3억 ~ 5억</option>
              <option value="over5">5억 이상</option>
            </select>
          </div>

          {/* 법원경매 전용 추가 필터 (임차인, AI 등급) */}
          {assetSource === "auction" && (
            <div className="grid grid-cols-2 gap-2 text-sm pt-1">
              <select 
                value={tenantFilter} 
                onChange={(e) => setTenantFilter(e.target.value)}
                className="w-full text-xs sm:text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-2xs"
              >
                <option value="">임차인 전체</option>
                <option value="yes">👤 임차인 있음</option>
                <option value="no">🏠 소유자 점유</option>
              </select>

              <select 
                value={gradeFilter} 
                onChange={(e) => setGradeFilter(e.target.value)}
                className="w-full text-xs sm:text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-2xs"
              >
                <option value="">AI 등급 전체</option>
                <option value="S">S 등급</option>
                <option value="A">A 등급</option>
                <option value="B">B 등급</option>
                <option value="C">C 등급</option>
                <option value="D">D 등급</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-gray-200/50">
            <span className="text-xs text-gray-500 shrink-0 font-medium">정렬:</span>
            {assetSource === "auction" ? (
              <select 
                value={sortOrder} 
                onChange={(e) => setSortOrder(e.target.value)}
                className="flex-1 text-xs sm:text-sm bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-gray-700 outline-none focus:border-blue-500 shadow-2xs"
              >
                <option value="recommend">⭐ AI 추천순(S/A)</option>
                <option value="margin_desc">🎯 진짜 안전마진 높은 순</option>
                <option value="market_discount">📉 시세 대비 할인율 높은 순</option>
                <option value="yield_desc">📊 임대 수익률 높은 순</option>
                <option value="recent">최신 등록순</option>
                <option value="oldest">오래된 등록순</option>
                <option value="price_asc">낮은 가격순</option>
                <option value="price_desc">높은 가격순</option>
              </select>
            ) : assetSource === "onbid" ? (
              <select 
                value={sortOrder} 
                onChange={(e) => setSortOrder(e.target.value)}
                className="flex-1 text-xs sm:text-sm bg-white border border-purple-200 rounded-xl px-3 py-1.5 text-purple-900 font-semibold outline-none focus:border-purple-500 shadow-2xs"
              >
                <option value="default">🔥 추천 / 고할인율순</option>
                <option value="discount_desc">📉 할인율 높은 순</option>
                <option value="price_asc">💰 낮은 가격순</option>
                <option value="price_desc">💎 높은 가격순</option>
                <option value="area_desc">📐 넓은 면적순</option>
              </select>
            ) : (
              <select 
                value={sortOrder} 
                onChange={(e) => setSortOrder(e.target.value)}
                className="flex-1 text-xs sm:text-sm bg-white border border-emerald-200 rounded-xl px-3 py-1.5 text-emerald-900 font-semibold outline-none focus:border-emerald-500 shadow-2xs"
              >
                <option value="default">✨ 추천 / 1층 우선순</option>
                <option value="price_asc">💰 낮은 가격순</option>
                <option value="price_desc">💎 높은 가격순</option>
                <option value="area_desc">📐 넓은 면적순</option>
              </select>
            )}
          </div>
        </div>

        {/* 지도 보기 모드 */}
        {viewMode === "map" && (
          <div className="mb-6">
            <AuctionMap
              items={auctions}
              onSelectItem={(item) => handleSelectAuction(item)}
              focusRegion={regionFilter || regionInput}
              priceRange={priceFilter}
            />
          </div>
        )}

        {/* 결과 타이틀 브리핑 바 */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold text-white shadow-2xs ${
              assetSource === "auction" ? "bg-blue-600" : assetSource === "onbid" ? "bg-purple-600" : "bg-[#03c75a]"
            }`}>
              {assetSource === "auction" ? "⚖️ 법원경매" : assetSource === "onbid" ? "🏛️ 온비드 공매" : "🟢 네이버 상가"}
            </span>
            <span className="text-xs text-gray-600 font-medium">
              총 <strong className="text-gray-900 font-extrabold">{totalMatching.toLocaleString()}건</strong> 검색됨
            </span>
            {floorFilter === "b1" && (
              <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                ⛳ 지하1층 골프·체육 필터 적용중
              </span>
            )}
          </div>
          {currentListLength > 0 && (
            <span className="text-[11px] text-gray-400">
              현재 {currentListLength}건 표시중
            </span>
          )}
        </div>

        {/* 매물 리스트 렌더링 */}
        <div className="grid grid-cols-1 gap-4">
          {/* 1. 법원경매 목록 */}
          {assetSource === "auction" && auctions.map((item) => (
            <article 
              key={item.case_number} 
              onClick={() => handleSelectAuction(item)}
              className="bg-white border border-gray-200 hover:border-blue-500/50 rounded-2xl p-4 sm:p-5 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-2.5 gap-2">
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg shrink-0">
                    ⚖️ 법원경매
                  </span>
                  <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg shrink-0">
                    {item.case_number}
                  </span>
                  <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-lg shrink-0">
                    {getPropertyType(item.location, item.usage)}
                  </span>
                  {item.floor !== undefined && item.floor !== 0 && (
                    item.floor < 0 ? (
                      <span className="text-xs font-extrabold text-purple-800 bg-purple-100 border border-purple-300 px-2 py-0.5 rounded-lg shrink-0">
                        ⛳ 지하{Math.abs(item.floor)}층{item.area_pyeong ? `·${item.area_pyeong}평(골프/체육)` : ""}
                      </span>
                    ) : item.floor === 1 && getPropertyType(item.location, item.usage).includes("상가") ? (
                      <span className="text-xs font-bold text-orange-800 bg-orange-100 border border-orange-300 px-2 py-0.5 rounded-lg shrink-0">
                        ✨ 1층 상가
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg shrink-0">
                        {item.floor > 0 ? `${item.floor}층` : `지하${Math.abs(item.floor)}층`}
                      </span>
                    )
                  )}
                  {(() => {
                    const analysis = analyzeSeniorDeposit(
                      item.rights_list,
                      item.tenant_registration_date,
                      item.tenant_deposit,
                      item.is_payout_requested
                    );
                    return (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border shrink-0 ${analysis.statusBadge.color}`}>
                        {analysis.statusBadge.text}
                      </span>
                    );
                  })()}
                  {/* 특수권리 태그 배지 */}
                  {(() => {
                    try {
                      const tags = item.special_rights ? JSON.parse(item.special_rights) : [];
                      return tags.map((t: any) => (
                        <span key={t.id} className={`text-xs font-bold px-2 py-0.5 rounded-md border shrink-0 ${t.badge_color || 'bg-amber-100 text-amber-800 border-amber-200'}`} title={t.desc}>
                          {t.icon || '🏷️'} {t.short || t.name}
                        </span>
                      ));
                    } catch {
                      return null;
                    }
                  })()}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite("auction", item.case_number);
                    }}
                    className={`p-1 rounded-lg text-base transition-transform hover:scale-125 cursor-pointer ${
                      item.is_favorite ? "text-amber-500 font-black" : "text-gray-300 hover:text-amber-400"
                    }`}
                    title={item.is_favorite ? "관심매물 해제" : "관심매물 등록"}
                  >
                    {item.is_favorite ? "⭐" : "☆"}
                  </button>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border shrink-0 ${getGradeColor(item.ai_grade)}`}>
                    {item.ai_grade} 등급
                  </span>
                </div>
              </div>
              {item.recommend_tag && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 text-purple-900 font-extrabold text-xs shadow-xs">
                  <span>{item.recommend_tag}</span>
                </div>
              )}
              <h3 className="text-sm font-medium text-gray-800 mb-3 line-clamp-2 min-h-[2.5rem] leading-snug group-hover:text-blue-700 transition-colors">
                {item.location}
              </h3>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-0.5">감정가</p>
                  <p className="text-sm font-semibold text-gray-900">{formatMoney(item.appraisal)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-0.5">최저가 <span className="text-red-500 ml-1">유찰 {item.failed_count}회</span></p>
                  <p className="text-sm font-bold text-blue-600">{formatMoney(item.min_bid)}</p>
                  {item.auction_date && (
                    <p className="text-xs text-gray-500 mt-0.5">기일: {item.auction_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}</p>
                  )}
                </div>
              </div>

              {/* 진짜 안전마진 배너 */}
              {item.market_match_count && item.market_match_count > 0 && item.market_price && item.market_price > 0 ? (
                <div className="mt-3 p-2.5 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/90 flex items-center justify-between text-xs">
                  <div className="min-w-0 pr-2">
                    <span className="font-extrabold text-emerald-900 flex items-center gap-1">
                      <span>🎯 진짜 안전마진</span>
                      <span className="text-sm text-emerald-700">+{formatMoney(item.safety_margin)}</span>
                    </span>
                    <span className="text-[11px] text-emerald-700 font-medium block mt-0.5 truncate">
                      네이버 시세 {formatMoney(item.market_price)} ({item.market_match_level} {item.market_match_count}건 비교)
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 rounded-md font-bold text-[11px] bg-emerald-600 text-white shadow-2xs">
                      시세 대비 {item.market_discount_pct}%↓
                    </span>
                    {item.rental_yield && item.rental_yield > 0 ? (
                      <span className="text-[10px] text-teal-800 block font-semibold mt-0.5">
                        월세 {formatMoney(item.est_monthly_rent)} ({item.rental_yield}%)
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : item.safety_margin && item.safety_margin > 0 ? (
                <div className="mt-3 p-2 rounded-xl bg-gray-50/80 border border-gray-200/60 flex items-center justify-between text-xs">
                  <span className="text-gray-600 font-medium">
                    🏛️ 감정가 기준 마진: <strong className="text-gray-900">+{formatMoney(item.safety_margin)}</strong>
                  </span>
                  <span className="text-[11px] text-gray-600 font-semibold bg-gray-200/60 px-1.5 py-0.5 rounded">
                    할인 {item.market_discount_pct}%
                  </span>
                </div>
              ) : null}

              {/* 메타 정보 */}
              <div className="mt-3 pt-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold border ${
                  item.ai_model === 'gpt-4o-mini'
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : item.ai_model === 'gpt-4o'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-gray-100 text-gray-700 border-gray-200'
                }`}>
                  <span>🤖</span>
                  <span>{item.ai_model || 'gpt-4o-mini'}</span>
                </span>
                <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs font-medium text-gray-600">
                  <span className="bg-gray-50 px-2 py-0.5 rounded border border-gray-200/80">
                    📥 추가일 <strong className="text-gray-800">{formatDateShort(item.created_at || item.last_updated)}</strong>
                  </span>
                  <span className="bg-blue-50/60 px-2 py-0.5 rounded border border-blue-100 text-blue-800">
                    🔄 업데이트 <strong className="font-bold">{formatDateShort(item.last_updated)}</strong>
                  </span>
                </div>
              </div>
            </article>
          ))}

          {/* 2. 온비드(KAMCO) 공매 목록 */}
          {assetSource === "onbid" && onbidItems.map((item) => (
            <article
              key={item.cltr_no}
              className="bg-white border border-gray-200 hover:border-purple-500/50 rounded-2xl p-4 sm:p-5 shadow-sm transition-all group"
            >
              <div className="flex justify-between items-start mb-2.5 gap-2">
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  <span className="px-2 py-0.5 rounded-lg bg-purple-600 text-white text-xs font-black shrink-0">
                    🏛️ 온비드 공매
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border shrink-0 ${
                    item.disposal_method === "임대"
                      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                      : "bg-blue-50 text-blue-700 border-blue-200"
                  }`}>
                    {item.disposal_method || "매각"} ({item.prpt_div || "공유재산"})
                  </span>
                  {item.floor !== undefined && item.floor < 0 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-300 text-xs font-extrabold shrink-0">
                      ⛳ 지하1층·{item.bld_area_pyeong}평(골프/체육)
                    </span>
                  ) : item.is_first_floor === 1 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-orange-100 text-orange-800 border border-orange-300 text-xs font-bold shrink-0">
                      ✨ 1층 상가
                    </span>
                  ) : item.floor > 0 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold shrink-0">
                      {item.floor}층
                    </span>
                  ) : null}
                  {item.discount_pct > 0 && item.discount_pct < 100 && (
                    <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-800 border border-red-200 text-xs font-extrabold shrink-0">
                      🔥 {Math.round(item.discount_pct)}% 할인
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium shrink-0">
                    {item.addr_sgg || item.addr_sido} {item.addr_emd}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite("onbid", item.cltr_no)}
                    className={`p-1 rounded-lg text-base transition-transform hover:scale-125 cursor-pointer ${
                      item.is_favorite ? "text-amber-500 font-black" : "text-gray-300 hover:text-amber-400"
                    }`}
                    title={item.is_favorite ? "관심매물 해제" : "관심매물 등록"}
                  >
                    {item.is_favorite ? "⭐" : "☆"}
                  </button>
                  <span className="text-xs text-gray-400 font-medium">#{item.cltr_no}</span>
                </div>
              </div>

              {item.recommend_tag && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 text-purple-900 font-extrabold text-xs shadow-xs">
                  <span>{item.recommend_tag}</span>
                </div>
              )}

              <h3 className="text-base font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-purple-700 transition-colors">
                {item.cltr_nm}
              </h3>

              <p className="text-xs text-gray-500 mb-3">
                📍 {item.addr_full || `${item.addr_sido} ${item.addr_sgg} ${item.addr_emd}`} · 건물: <strong className="text-gray-900">{item.bld_area_pyeong}평</strong> ({item.bld_area_m2}㎡) {item.land_area_m2 ? `· 토지: ${item.land_area_m2}㎡` : ""}
              </p>

              <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-3 mb-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-800">
                      {item.disposal_method === "임대" ? "최저 입찰 연간임대료" : "최저 입찰 매각가"}
                    </span>
                    {item.appraisal > 0 && item.appraisal !== item.min_bid && (
                      <span className="text-[11px] text-gray-400 line-through">
                        감정가 {formatMoney(item.appraisal)}
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-black text-purple-700">
                    {formatMoney(item.min_bid)}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-extrabold ${
                    (item.remain_time || "").includes("마감") || (item.remain_time || "").includes("시간")
                      ? "bg-red-100 text-red-700 border border-red-200 animate-pulse"
                      : "bg-purple-100 text-purple-800 border border-purple-200"
                  }`}>
                    ⏰ {item.remain_time || "입찰진행"}
                  </span>
                  {item.bid_end_date && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      마감: {item.bid_end_date}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-gray-500 truncate max-w-xs">
                  🏛️ 기관: <strong className="text-gray-800">{item.reg_org_nm || "한국자산관리공사"}</strong> · 용도: {item.usage || "근린생활시설"}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://map.kakao.com/link/search/${encodeURIComponent(item.addr_full || item.cltr_nm)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 font-bold transition-colors"
                  >
                    📍 카카오 로드뷰
                  </a>
                  <a
                    href={item.detail_url || `https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-extrabold transition-colors shadow-2xs"
                  >
                    온비드 공매 원문 ↗
                  </a>
                </div>
              </div>
            </article>
          ))}

          {/* 3. 네이버 부동산 상가 실매물 목록 */}
          {assetSource === "naver" && naverListings.map((item) => (
            <article
              key={item.article_id}
              className="bg-white border border-gray-200 hover:border-emerald-500/50 rounded-2xl p-4 sm:p-5 shadow-sm transition-all group"
            >
              <div className="flex justify-between items-start mb-2.5 gap-2">
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  <span className="px-2 py-0.5 rounded-lg bg-[#03c75a] text-white text-xs font-black shrink-0">
                    N 실매물 ({item.trade_type})
                  </span>
                  {item.floor !== undefined && item.floor < 0 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-300 text-xs font-extrabold shrink-0">
                      ⛳ 지하1층·{item.area_pyeong}평(골프/체육)
                    </span>
                  ) : item.floor === 1 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-orange-100 text-orange-800 border border-orange-300 text-xs font-bold shrink-0">
                      ✨ 1층 상가
                    </span>
                  ) : item.floor > 0 ? (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold shrink-0">
                      {item.floor}층
                    </span>
                  ) : null}
                  <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium shrink-0">
                    {item.addr_sgg} {item.addr_emd}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite("naver", item.article_id)}
                    className={`p-1 rounded-lg text-base transition-transform hover:scale-125 cursor-pointer ${
                      item.is_favorite ? "text-amber-500 font-black" : "text-gray-300 hover:text-amber-400"
                    }`}
                    title={item.is_favorite ? "관심매물 해제" : "관심매물 등록"}
                  >
                    {item.is_favorite ? "⭐" : "☆"}
                  </button>
                  <span className="text-xs text-gray-400 font-medium">#{item.article_id}</span>
                </div>
              </div>

              {item.recommend_tag && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 text-purple-900 font-extrabold text-xs shadow-xs">
                  <span>{item.recommend_tag}</span>
                </div>
              )}

              <h3 className="text-base font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-emerald-700 transition-colors">
                {item.article_name || "일반상가 점포"}
              </h3>

              <p className="text-xs text-gray-500 mb-3">
                📍 {item.addr_sgg} {item.addr_emd} · 층수: <strong>{item.floor > 0 ? `${item.floor}층` : `지하${Math.abs(item.floor)}층`}</strong> / {item.total_floor || "-"}층 · 전용: <strong className="text-gray-900">{item.area_pyeong}평</strong> ({item.area_m2}㎡)
              </p>

              <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3 mb-3 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-800">
                    {item.trade_type === "매매" ? "네이버 호가 (매매)" : "보증금 / 월세"}
                  </span>
                  <p className="text-lg font-black text-emerald-700">
                    {item.trade_type === "매매"
                      ? `${formatNaverPrice10k(item.price_sale_10k)}원`
                      : `${formatNaverPrice10k(item.deposit_10k)} / 월 ${formatNaverPrice10k(item.monthly_rent_10k)}`}
                  </p>
                </div>
                {item.trade_type === "매매" && item.area_pyeong > 0 && (
                  <div className="text-right">
                    <span className="text-[11px] text-gray-500">평당 매매가</span>
                    <p className="text-sm font-extrabold text-gray-800">
                      {Math.round(item.price_sale_10k / item.area_pyeong).toLocaleString()}만원/평
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-gray-500 truncate max-w-xs">
                  🏢 {item.realtor || "중개업소"} {item.confirm_date ? `· 확인 ${item.confirm_date}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://map.kakao.com/link/search/${encodeURIComponent(item.addr_sgg + " " + item.addr_emd + " " + (item.article_name || ""))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 font-bold transition-colors"
                  >
                    📍 카카오 로드뷰
                  </a>
                  <a
                    href={item.detail_url || `https://m.land.naver.com/article/info/${item.article_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-lg bg-[#03c75a] hover:bg-emerald-600 text-white font-extrabold transition-colors shadow-2xs"
                  >
                    네이버 부동산 확인 ↗
                  </a>
                </div>
              </div>
            </article>
          ))}
          
          {loading && [1,2,3].map(i => (
            <div key={i} className="bg-white h-32 rounded-2xl border border-gray-100 animate-pulse"></div>
          ))}
        </div>

        {/* 빈 검색 결과 */}
        {!loading && currentListLength === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 p-8 shadow-xs">
            <p className="text-4xl mb-3">🔍</p>
            <h3 className="text-base font-bold text-gray-800 mb-1">
              검색 조건에 맞는 {assetSource === "auction" ? "법원경매" : assetSource === "onbid" ? "온비드 공매" : "네이버 상가"} 매물이 없습니다.
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              필터 조건을 변경하거나 초기화하여 다시 검색해보세요.
            </p>
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer"
            >
              필터 전체 초기화
            </button>
          </div>
        )}
        
        {!loading && hasMore && currentListLength > 0 && (
          <button 
            onClick={handleLoadMore}
            className="w-full mt-6 bg-white border border-gray-200 text-gray-700 font-semibold py-3.5 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors shadow-sm cursor-pointer"
          >
            {assetSource === "auction" ? "법원경매" : assetSource === "onbid" ? "온비드 공매" : "네이버 상가"} 더 보기 ({currentListLength} / {totalMatching.toLocaleString()}건)
          </button>
        )}
        
        {!loading && !hasMore && currentListLength > 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            모든 {assetSource === "auction" ? "법원경매" : assetSource === "onbid" ? "온비드 공매" : "네이버 상가"} 매물을 불러왔습니다. (총 {totalMatching.toLocaleString()}건)
          </div>
        )}
      </main>

      {/* 모달 (page.tsx와 동일 로직) */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={() => setSelectedDetail(null)}></div>
          <div className="bg-white rounded-3xl w-full max-w-lg md:max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-200">
            {detailLoading ? (
               <div className="p-8 text-center text-gray-500">
                 <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                 데이터를 불러오는 중입니다...
               </div>
            ) : (
              <div>
                <div className="sticky top-0 bg-white/95 backdrop-blur-md px-5 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center z-20">
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900 text-base truncate">{selectedDetail.case_number} 상세 분석</h3>
                      <button
                        type="button"
                        onClick={() => handleToggleFavorite("auction", selectedDetail.case_number)}
                        className={`text-sm font-bold flex items-center gap-1 px-2 py-0.5 rounded-lg border transition-all cursor-pointer ${
                          selectedDetail.is_favorite 
                            ? "bg-amber-50 text-amber-800 border-amber-300" 
                            : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-amber-50 hover:text-amber-700"
                        }`}
                        title={selectedDetail.is_favorite ? "관심매물 해제" : "관심매물 등록"}
                      >
                        <span>{selectedDetail.is_favorite ? "⭐" : "☆"}</span>
                        <span>{selectedDetail.is_favorite ? "관심매물" : "관심등록"}</span>
                      </button>
                    </div>
                    {selectedDetail.recommend_tag && (
                      <div className="mt-1">
                        <span className="inline-block text-[11px] font-bold text-purple-900 bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-md">
                          {selectedDetail.recommend_tag}
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 truncate mt-0.5">{selectedDetail.location}</p>
                  </div>
                  <button onClick={() => setSelectedDetail(null)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="p-4 sm:p-6 space-y-5">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">물건 소재지</h4>
                    <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 leading-relaxed">
                      <span className="inline-block mb-1.5 text-xs font-bold px-2 py-0.5 bg-gray-200 text-gray-700 rounded mr-2">
                        {getPropertyType(selectedDetail.location, (selectedDetail as any).usage)}
                      </span>
                      <span>{selectedDetail.location}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a 
                        href={`https://map.kakao.com/link/search/${encodeURIComponent(selectedDetail.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-800 bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors"
                      >
                        📍 카카오맵 / 로드뷰
                      </a>
                      <a 
                        href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedDetail.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-green-800 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        🗺️ 네이버지도
                      </a>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-blue-50/50 p-3.5 rounded-xl border border-blue-100">
                        <p className="text-xs text-blue-600 font-medium mb-1">감정가</p>
                        <p className="text-base sm:text-lg font-bold text-gray-900">{formatMoney(selectedDetail.appraisal)}</p>
                     </div>
                     <div className="bg-red-50/50 p-3.5 rounded-xl border border-red-100">
                        <p className="text-xs text-red-600 font-medium mb-1">최저 매각가</p>
                        <p className="text-base sm:text-lg font-bold text-red-600">{formatMoney(selectedDetail.min_bid)}</p>
                     </div>
                  </div>

                  {/* 네이버 부동산 시세 비교 & 진짜 안전마진 카드 */}
                  <div className="p-4 rounded-2xl border bg-white border-emerald-200/90 shadow-sm space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold flex items-center gap-1.5 text-gray-900">
                        <span>📊</span>
                        <span>네이버 부동산 시세 &amp; 진짜 안전마진</span>
                      </h4>
                      {selectedDetail.market_match_count && selectedDetail.market_match_count > 0 ? (
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                          <span>🏢 실매물</span>
                          <span>{selectedDetail.market_match_level} {selectedDetail.market_match_count}건 연동</span>
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-lg bg-gray-100 text-gray-600 border border-gray-200">
                          인근 실매물 수집 대기 (감정가 기준)
                        </span>
                      )}
                    </div>

                    {/* 4분할 시세 vs 최저가 vs 마진 비교 그리드 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="text-gray-400 block text-[11px] mb-0.5 font-medium">법원 감정가</span>
                        <span className="font-bold text-gray-900 text-sm">{formatMoney(selectedDetail.appraisal)}</span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">법원 감정평가액</span>
                      </div>

                      <div className="bg-blue-50/70 p-2.5 rounded-xl border border-blue-100">
                        <span className="text-blue-600 block text-[11px] mb-0.5 font-medium">네이버 시세</span>
                        <span className="font-bold text-blue-900 text-sm">
                          {selectedDetail.market_price && selectedDetail.market_price > 0 
                            ? formatMoney(selectedDetail.market_price) 
                            : formatMoney(selectedDetail.appraisal)}
                        </span>
                        <span className="text-[10px] text-blue-500 block mt-0.5">
                          {selectedDetail.market_match_count && selectedDetail.market_match_count > 0 
                            ? `${selectedDetail.market_match_level} 평균 호가` 
                            : '감정가 추정'}
                        </span>
                      </div>

                      <div className="bg-amber-50/70 p-2.5 rounded-xl border border-amber-100">
                        <span className="text-amber-700 block text-[11px] mb-0.5 font-medium">최저가 + 인수금</span>
                        <span className="font-bold text-amber-900 text-sm">
                          {formatMoney(selectedDetail.min_bid + (selectedDetail.senior_deposit_assumed || 0))}
                        </span>
                        <span className="text-[10px] text-amber-600 block mt-0.5">
                          {selectedDetail.senior_deposit_assumed && selectedDetail.senior_deposit_assumed > 0
                            ? `인수 ${formatMoney(selectedDetail.senior_deposit_assumed)} 포함`
                            : '인수 보증금 0원'}
                        </span>
                      </div>

                      <div className="bg-gradient-to-br from-emerald-100 to-teal-100 p-2.5 rounded-xl border border-emerald-300">
                        <span className="text-emerald-800 block text-[11px] mb-0.5 font-extrabold">🎯 진짜 안전마진</span>
                        <span className="font-extrabold text-emerald-900 text-sm">
                          +{formatMoney(selectedDetail.safety_margin)}
                        </span>
                        <span className="text-[10px] text-emerald-700 font-bold block mt-0.5">
                          {selectedDetail.market_discount_pct}% 저렴
                        </span>
                      </div>
                    </div>

                    {/* 임대 수익률 시뮬레이션 (월세 매물이 있는 경우) */}
                    {selectedDetail.est_monthly_rent && selectedDetail.est_monthly_rent > 0 ? (
                      <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-100 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-teal-900 block">📈 인근 월세 및 예상 임대 수익률</span>
                          <span className="text-teal-700 text-[11px]">
                            예상 월세: <strong>{formatMoney(selectedDetail.est_monthly_rent)}/월</strong>
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-extrabold text-teal-800 bg-white px-2 py-1 rounded-lg border border-teal-200">
                            연 {selectedDetail.rental_yield}% 수익률
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {/* 네이버 부동산 인근 비교 매물 목록 (실시간 링크) */}
                    {selectedDetail.sample_listings && selectedDetail.sample_listings.length > 0 && (
                      <div className="pt-2 border-t border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-700">🏢 인근 네이버 부동산 비교 매물</span>
                          <a
                            href={`https://land.naver.com/search/result.naver?keyword=${encodeURIComponent(selectedDetail.location.split(' ').slice(0, 3).join(' '))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 hover:underline font-medium"
                          >
                            네이버 부동산에서 더보기 →
                          </a>
                        </div>
                        <div className="space-y-1.5">
                          {selectedDetail.sample_listings.map((item, idx) => (
                            <div key={item.article_id || idx} className="p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100/80 border border-gray-200/70 transition-colors flex items-center justify-between text-xs">
                              <div className="min-w-0 pr-2">
                                <span className="font-semibold text-gray-800 block truncate">
                                  {item.article_name} {item.floor ? `(${item.floor}층)` : ''}
                                </span>
                                <span className="text-[11px] text-gray-500">
                                  {item.area_m2}㎡ ({item.area_pyeong}평) · {item.trade_type}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-bold text-gray-900">
                                  {formatMoney((item.price_sale_10k || 0) * 10000)}
                                </span>
                                {item.detail_url && (
                                  <a
                                    href={item.detail_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium text-[11px] border border-blue-200 transition-colors"
                                  >
                                    매물보기 ↗
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 선순위 권리 & 낙찰자 인수 보증금 핵심 분석 카드 */}
                  {(() => {
                    const analysis = analyzeSeniorDeposit(
                      selectedDetail.rights_list,
                      selectedDetail.tenant_registration_date,
                      selectedDetail.tenant_deposit,
                      selectedDetail.is_payout_requested,
                      aiReport?.tenants
                    );
                    const malso = analysis.malsoStandard;

                    return (
                      <>
                      <div className={`p-4 rounded-2xl border transition-all ${
                        analysis.riskLevel === 'CRITICAL' 
                          ? 'bg-red-50/70 border-red-200 shadow-2xs' 
                          : analysis.riskLevel === 'WARNING'
                          ? 'bg-amber-50/70 border-amber-200 shadow-2xs'
                          : 'bg-emerald-50/70 border-emerald-200'
                      }`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <h4 className="text-sm font-bold flex items-center gap-1.5 text-gray-900 min-w-0">
                            <span>{analysis.riskLevel === 'CRITICAL' ? '🚨' : analysis.riskLevel === 'WARNING' ? '⚠️' : '🛡️'}</span>
                            <span>선순위 권리 &amp; 인수 보증금 분석</span>
                          </h4>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border shrink-0 ${analysis.statusBadge.color}`}>
                            {analysis.statusBadge.text}
                          </span>
                        </div>

                        {/* 4분할 지표 그리드 */}
                        <div className="grid grid-cols-2 gap-2 text-xs bg-white/90 p-3 rounded-xl border border-gray-100 shadow-2xs mb-2.5">
                          <div className="border-r border-gray-100 pr-2 min-w-0">
                            <span className="text-gray-400 block text-[11px] mb-0.5">말소기준권리</span>
                            <span className="font-semibold text-gray-800 break-words line-clamp-2" title={malso ? `${malso.name} (${malso.date})` : ''}>
                              {malso ? `${malso.name} (${malso.date})` : '등기 미기재 / 확인필요'}
                            </span>
                          </div>
                          <div className="pl-1 min-w-0">
                            <span className="text-gray-400 block text-[11px] mb-0.5">최초 전입신고일</span>
                            <span className="font-semibold text-gray-800 break-words">
                              {selectedDetail.tenant_registration_date === '임차인없음'
                                ? '없음 (소유자 점유)'
                                : (selectedDetail.tenant_registration_date || '현황조사서 미등재')}
                            </span>
                          </div>
                          <div className="border-r border-gray-100 pr-2 pt-2 border-t min-w-0">
                            <span className="text-gray-400 block text-[11px] mb-0.5">신고 임차보증금</span>
                            <span className="font-semibold text-gray-900 break-words">
                              {selectedDetail.tenant_deposit 
                                ? formatMoney(selectedDetail.tenant_deposit) 
                                : (analysis.hasTenant ? '미상 (현황조사서 미표기)' : '해당 없음')}
                            </span>
                          </div>
                          <div className="pl-1 pt-2 border-t border-gray-100 min-w-0">
                            <span className="text-gray-400 block text-[11px] mb-0.5">배당요구 여부</span>
                            <span className="font-semibold text-gray-800 break-words">
                              {selectedDetail.is_payout_requested 
                                ? '✅ 요구함' 
                                : (analysis.hasTenant ? '❌ 미요구' : '해당 없음')}
                            </span>
                          </div>
                        </div>

                        {/* 인수 보증금 하이라이트 배너 */}
                        <div className={`p-3 rounded-xl mb-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 ${
                          analysis.riskLevel === 'CRITICAL'
                            ? 'bg-red-100/90 text-red-950 border border-red-200'
                            : analysis.riskLevel === 'WARNING'
                            ? 'bg-amber-100/90 text-amber-950 border border-amber-200'
                            : 'bg-emerald-100/90 text-emerald-950 border border-emerald-200'
                        }`}>
                          <div className="text-xs font-semibold text-gray-800">
                            낙찰자 인수 예상 보증금
                            {analysis.seniorCount > 1 && (
                              <span className="text-[11px] text-gray-600 ml-1.5 font-normal">(선순위 {analysis.seniorCount}명 합산)</span>
                            )}
                          </div>
                          <div className={`text-base font-extrabold tracking-tight ${
                            analysis.riskLevel === 'CRITICAL' ? 'text-red-700' : analysis.riskLevel === 'WARNING' ? 'text-amber-700' : 'text-emerald-700'
                          }`}>
                            {analysis.depositText}
                          </div>
                        </div>

                        {/* 다수 선순위 임차인 세부 구분 카드 */}
                        {analysis.seniorCount > 1 && (
                          <div className="grid grid-cols-2 gap-1.5 mb-2.5 text-xs">
                            <div className="bg-white/90 p-2 rounded-lg border border-red-100 shadow-2xs">
                              <span className="text-[11px] text-gray-500 block mb-0.5">⚠️ 배당 미요구 (전액 인수)</span>
                              <span className="font-bold text-red-600 text-xs">
                                {analysis.seniorNoPayoutDeposit > 0 ? formatMoney(analysis.seniorNoPayoutDeposit) : '0원'}
                              </span>
                            </div>
                            <div className="bg-white/90 p-2 rounded-lg border border-amber-100 shadow-2xs">
                              <span className="text-[11px] text-gray-500 block mb-0.5">ℹ️ 배당 요구 (우선변제)</span>
                              <span className="font-bold text-amber-700 text-xs">
                                {analysis.seniorPayoutDeposit > 0 ? formatMoney(analysis.seniorPayoutDeposit) : '0원'}
                              </span>
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-gray-700 leading-relaxed bg-white/60 p-2.5 rounded-xl border border-gray-100/80">
                          {analysis.summaryText}
                        </p>

                        {/* 현황조사서 임차인 개별 목록 (각각 선순위/후순위 판정) */}
                        {aiReport?.tenants && aiReport.tenants.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-200/60 text-xs">
                            <p className="font-semibold text-gray-900 mb-2 flex items-center justify-between">
                              <span>현황조사서 등재 임차인 상세</span>
                              <span className="text-blue-600 font-bold">총 {aiReport.tenants.length}명</span>
                            </p>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                              {aiReport.tenants.map((t: any, idx: number) => {
                                const tClean = (t.move_in_date || '').replace(/[^0-9]/g, '');
                                const mClean = malso ? malso.date.replace(/[^0-9]/g, '') : '';
                                const isIndivSenior = mClean && tClean ? tClean < mClean : null;

                                return (
                                  <div key={idx} className="bg-white p-2.5 rounded-xl border border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-gray-700 shadow-2xs">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-bold text-gray-900">{t.name || '미상'}</span>
                                        {t.room && <span className="text-gray-500 text-[11px]">({t.room})</span>}
                                        {isIndivSenior === true && (
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700 border border-red-200 shrink-0">
                                            선순위 인수
                                          </span>
                                        )}
                                        {isIndivSenior === false && (
                                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                            후순위 소멸
                                          </span>
                                        )}
                                        {t.is_payout_requested ? (
                                          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200 shrink-0">
                                            배당요구
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.2 rounded border border-gray-200 shrink-0">
                                            미요구
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-gray-400 mt-1 truncate">
                                        전입: {t.move_in_date || '미상'} {t.fixed_date ? `· 확정: ${t.fixed_date}` : ''}
                                      </div>
                                    </div>
                                    <div className="sm:text-right shrink-0 flex sm:flex-col justify-between items-center sm:items-end pt-1 sm:pt-0 border-t sm:border-t-0 border-gray-50">
                                      <span className={`font-bold block text-xs ${isIndivSenior ? 'text-red-600' : 'text-gray-800'}`}>
                                        {typeof t.deposit === 'number' ? (t.deposit > 0 ? formatMoney(t.deposit) : '미상') : (t.deposit || '미상')}
                                      </span>
                                      {t.monthly_rent && <span className="text-[10px] text-gray-500">월 {t.monthly_rent}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 실전 투자금 & 경락잔금대출 계산기 */}
                      <InvestmentCalculator
                        appraisal={selectedDetail.appraisal}
                        minBid={selectedDetail.min_bid}
                        seniorDeposit={analysis.seniorDeposit}
                        isHouse={!getPropertyType(selectedDetail.location, (selectedDetail as any).usage).includes("상가") && !getPropertyType(selectedDetail.location, (selectedDetail as any).usage).includes("토지")}
                        location={selectedDetail.location}
                      />
                    </>
                    );
                  })()}

                  {/* 매각물건명세서 특수조건 & 비고 분석 카드 */}
                  {(() => {
                    let specialTags: any[] = [];
                    try {
                      if (selectedDetail.special_rights) {
                        specialTags = JSON.parse(selectedDetail.special_rights);
                      }
                    } catch {}

                    const hasRemarks = Boolean(selectedDetail.remarks && selectedDetail.remarks.trim());

                    return (
                      <div className="p-4 rounded-2xl border bg-white border-gray-200/80 shadow-2xs space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold flex items-center gap-1.5 text-gray-900">
                            <span>📋</span>
                            <span>매각물건명세서 특수조건 &amp; 비고 분석</span>
                          </h4>
                          {specialTags.length > 0 ? (
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                              특수조건 {specialTags.length}건 감지
                            </span>
                          ) : (
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✅ 일반 물건 (특수하자 없음)
                            </span>
                          )}
                        </div>

                        {specialTags.length > 0 ? (
                          <div className="space-y-2">
                            {specialTags.map((tag: any) => (
                              <div key={tag.id} className={`p-3 rounded-xl border text-xs ${
                                tag.risk_level === 'CRITICAL' 
                                  ? 'bg-red-50/80 border-red-200 text-red-950' 
                                  : tag.risk_level === 'HIGH'
                                  ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                                  : 'bg-amber-50/80 border-amber-200 text-amber-950'
                              }`}>
                                <div className="flex items-center justify-between mb-1">
                                  <div className="font-bold flex items-center gap-1.5 text-xs">
                                    <span>{tag.icon || '🏷️'}</span>
                                    <span>{tag.name}</span>
                                  </div>
                                  <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded border bg-white/80">
                                    {tag.risk_level === 'CRITICAL' ? '치명적 위험' : tag.risk_level === 'HIGH' ? '고위험' : '주의 요망'}
                                  </span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-gray-700">
                                  {tag.desc}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-800 flex items-start gap-2">
                            <span className="text-base">🛡️</span>
                            <p className="leading-relaxed">
                              법원 매각물건명세서 및 공고상 유치권, 법정지상권, 지분매각 등 매수인이 인수해야 할 특수조건이 없는 일반 권리 물건입니다.
                            </p>
                          </div>
                        )}

                        {hasRemarks && (
                          <div className="pt-2 border-t border-gray-100">
                            <span className="text-[11px] font-bold text-gray-500 block mb-1.5">🏛️ 법원 공고 비고란 원문</span>
                            <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-200/70 text-[11px] text-gray-700 font-mono whitespace-pre-line leading-relaxed max-h-36 overflow-y-auto">
                              {selectedDetail.remarks}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🤖</span>
                        <h4 className="font-bold text-gray-900">AI 권리분석 리포트</h4>
                      </div>
                      <span className={`text-sm font-bold px-3 py-1 rounded-full border ${getGradeColor(selectedDetail.ai_grade)}`}>
                        {selectedDetail.ai_grade} 등급
                      </span>
                    </div>

                    {/* 모델 및 업데이트/추가 일자 배지 바 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200/80 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500 font-medium">분석 모델:</span>
                        <span className={`px-2 py-0.5 rounded-md font-bold border ${
                          (selectedDetail.ai_model || aiReport?.ai_model) === 'gpt-4o-mini'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : (selectedDetail.ai_model || aiReport?.ai_model) === 'gpt-4o'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : 'bg-white text-gray-700 border-gray-200'
                        }`}>
                          {selectedDetail.ai_model || aiReport?.ai_model || 'gpt-4o-mini'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                        <span>📥 최초 추가: <strong className="text-gray-700">{formatDateShort(selectedDetail.created_at || selectedDetail.last_updated)}</strong></span>
                        <span>🔄 업데이트: <strong className="text-gray-700">{formatDateShort(selectedDetail.last_updated)}</strong></span>
                      </div>
                    </div>

                    {aiReport ? (
                      <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                          <p className="text-sm font-semibold text-gray-800 mb-1">한 줄 판정</p>
                          <p className="text-sm text-gray-600 leading-relaxed">{aiReport.verdict}</p>
                        </div>

                        {aiReport.expected_yield && (
                          <div className="bg-green-50 p-4 rounded-2xl border border-green-200">
                            <div className="flex justify-between items-center mb-1">
                              <p className="text-sm font-semibold text-green-800">적정 입찰가 (AI 제안)</p>
                              <p className="text-sm font-bold text-green-700">{aiReport.suggested_bid}</p>
                            </div>
                            <p className="text-xs text-green-700/80 mt-2">{aiReport.expected_yield}</p>
                          </div>
                        )}

                        {aiReport.risks && aiReport.risks.length > 0 && (
                          <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
                            <span className="block text-red-600 mb-2 font-semibold text-sm">위험 요소 (Risk)</span>
                            <ul className="list-disc list-inside text-sm text-red-800/80 space-y-1">
                              {aiReport.risks.map((risk: string, idx: number) => (
                                <li key={idx}>{risk}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {aiReport.retained_rights && aiReport.retained_rights.length > 0 && aiReport.retained_rights[0] !== '없음' && (
                          <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100">
                            <span className="block text-orange-700 mb-2 font-semibold text-sm">인수해야 할 권리/보증금</span>
                            <ul className="list-disc list-inside text-sm text-orange-800 space-y-1">
                              {aiReport.retained_rights.map((right: string, idx: number) => (
                                <li key={idx}>{right}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                          <span className="block text-blue-700 mb-2 font-semibold text-sm">전문가 상세 분석</span>
                          <p className="text-blue-800/90 text-sm leading-relaxed whitespace-pre-wrap">
                            {aiReport.analysis_detail || "상세 분석 내용이 없습니다."}
                          </p>
                        </div>
                        
                        <div className="pt-2">
                          <button 
                            className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm flex justify-center items-center gap-2"
                            onClick={async () => {
                              setDetailLoading(true);
                              try {
                                const res = await fetch(`/api/auctions/${selectedDetail.case_number}/analyze`, { 
                                  method: "POST", 
                                  headers: { "ngrok-skip-browser-warning": "1" } 
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  setSelectedDetail(data.data);
                                  alert("실시간 AI 재분석이 완료되었습니다!");
                                }
                              } catch (e) {
                                alert("분석 중 오류가 발생했습니다.");
                              } finally {
                                setDetailLoading(false);
                              }
                            }}
                          >
                            <span>실시간 재분석</span>
                            <span>🔄</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 text-center">
                        <p className="text-sm text-gray-500 mb-3">아직 상세 AI 분석이 진행되지 않은 물건입니다.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
