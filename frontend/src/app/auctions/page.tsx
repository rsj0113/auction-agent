"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
}

interface AIReport {
  verdict: string;
  risks: string[];
  retained_rights: string[];
  expected_yield: string;
  suggested_bid: string;
  analysis_detail?: string;
  tenants?: any[];
}

interface AuctionDetail extends AuctionItem {
  ai_report_json: string;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  is_payout_requested?: number;
  rights_list?: string;
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
  statusBadge: { text: string; color: string };
  depositText: string;
  summaryText: string;
  riskLevel: 'SAFE' | 'WARNING' | 'CRITICAL';
}

export function analyzeSeniorDeposit(
  rightsListJson?: string,
  tenantDate?: string,
  deposit?: number,
  isPayoutRequested?: number
): SeniorDepositAnalysis {
  const malso = getMalsoStandard(rightsListJson);
  const cleanTenant = (tenantDate || '').replace(/[^0-9]/g, '');
  const cleanMalso = malso ? malso.date.replace(/[^0-9]/g, '') : '';
  const dep = deposit || 0;

  if (!cleanTenant || tenantDate === '임차인없음' || tenantDate === '해당없음') {
    return {
      malsoStandard: malso,
      hasTenant: false,
      isSenior: false,
      seniorDeposit: 0,
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
      statusBadge: { text: '선순위 추정 (주의)', color: 'bg-amber-100 text-amber-800 border-amber-300' },
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
        statusBadge: { text: '⚠️ 선순위 (보증금 미상)', color: 'bg-red-100 text-red-800 border-red-300' },
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
        statusBadge: { text: `🚨 선순위 인수: ${formatMoney(dep)}`, color: 'bg-red-100 text-red-800 border-red-300 font-bold' },
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
        statusBadge: { text: `선순위(배당요구): ${formatMoney(dep)}`, color: 'bg-amber-100 text-amber-800 border-amber-300' },
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
      statusBadge: { text: '✅ 후순위 (소멸/안전)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
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

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // 필터 상태
  const [gradeFilter, setGradeFilter] = useState<string>("");
  const [priceFilter, setPriceFilter] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<string>("recent");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState<string>("");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [regionInput, setRegionInput] = useState<string>("");

  // 모달 상태
  const [selectedDetail, setSelectedDetail] = useState<AuctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchAuctions = async (pageIndex: number, overrideParams?: { grade?: string, price?: string, sort?: string, propertyType?: string, region?: string, hasTenant?: string }) => {
    try {
      if (pageIndex === 0) setLoading(true);
      const grade = overrideParams?.grade ?? gradeFilter;
      const price = overrideParams?.price ?? priceFilter;
      const sort = overrideParams?.sort ?? sortOrder;
      const propertyType = overrideParams?.propertyType ?? propertyTypeFilter;
      const tenant = overrideParams?.hasTenant ?? tenantFilter;
      const region = overrideParams?.region ?? regionFilter;
      
      let url = `/api/auctions?limit=20&offset=${pageIndex * 20}`;
      if (grade) url += `&grade=${grade}`;
      if (sort) url += `&sort=${sort}`;
      if (propertyType) url += `&property_type=${propertyType}`;
      if (tenant) url += `&has_tenant=${tenant}`;
      if (region) url += `&region=${encodeURIComponent(region)}`;
      if (price) {
        if (price === "under1") url += `&max_price=100000000`;
        else if (price === "1to3") url += `&min_price=100000000&max_price=300000000`;
        else if (price === "3to5") url += `&min_price=300000000&max_price=500000000`;
        else if (price === "over5") url += `&min_price=500000000`;
      }

      const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } });
      if (res.ok) {
        const data = await res.json();
        if (data.data.length < 20) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
        if (pageIndex === 0) {
          setAuctions(data.data);
        } else {
          setAuctions(prev => [...prev, ...data.data]);
        }
      }
    } catch (error) {
      console.error("데이터 로딩 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  // 필터 변경시 페이지 초기화 후 다시 호출
  useEffect(() => {
    setPage(0);
    const timer = setTimeout(() => {
      fetchAuctions(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [gradeFilter, priceFilter, sortOrder, propertyTypeFilter, tenantFilter, regionFilter]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchAuctions(nextPage);
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

  const formatMoney = (val: number) => {
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
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">전체 매물 보기</h1>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-5 pt-6">
                {/* Filters */}
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex gap-2">
            <select 
              value={propertyTypeFilter} 
              onChange={(e) => setPropertyTypeFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">전체 매물</option>
              <option value="apartment">아파트</option>
              <option value="officetel">오피스텔</option>
              <option value="villa">빌라/다세대</option>
              <option value="commercial">상가/근린</option>
              <option value="land">임야/토지</option>
            </select>

            <select 
              value={tenantFilter} 
              onChange={(e) => setTenantFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">임차인 전체</option>
              <option value="yes">👤 임차인 있음</option>
              <option value="no">🏠 소유자 점유 (임차인 없음)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <input 
              type="text"
              placeholder="지역 검색 (예: 강남구, 분당)"
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setRegionFilter(regionInput)}
              className="w-full text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            />
            <button 
              onClick={() => setRegionFilter(regionInput)}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              검색
            </button>
          </div>

          <div className="flex gap-2">
            <select 
              value={gradeFilter} 
              onChange={(e) => setGradeFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">모든 등급</option>
              <option value="S">S 등급</option>
              <option value="A">A 등급</option>
              <option value="B">B 등급</option>
              <option value="C">C 등급</option>
              <option value="D">D 등급</option>
            </select>

            <select 
              value={priceFilter} 
              onChange={(e) => setPriceFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">가격 전체</option>
              <option value="under1">1억 미만</option>
              <option value="1to3">1억 ~ 3억</option>
              <option value="3to5">3억 ~ 5억</option>
              <option value="over5">5억 이상</option>
            </select>

            <select 
              value={sortOrder} 
              onChange={(e) => setSortOrder(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="recommend">추천순(S/A)</option>
              <option value="recent">최신 등록순</option>
              <option value="oldest">오래된 등록순</option>
              <option value="price_asc">낮은 가격순</option>
              <option value="price_desc">높은 가격순</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {auctions.map((item) => (
            <article 
              key={item.case_number} 
              onClick={() => handleSelectAuction(item)}
              className="bg-white border border-gray-200 hover:border-blue-500/50 rounded-2xl p-5 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
                    {item.case_number}
                  </span>
                  {(() => {
                    const analysis = analyzeSeniorDeposit(
                      item.rights_list,
                      item.tenant_registration_date,
                      item.tenant_deposit,
                      item.is_payout_requested
                    );
                    return (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${analysis.statusBadge.color}`}>
                        {analysis.statusBadge.text}
                      </span>
                    );
                  })()}
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${getGradeColor(item.ai_grade)}`}>
                  {item.ai_grade} 등급
                </span>
              </div>
              <h3 className="text-sm font-medium text-gray-800 mb-4 line-clamp-2 leading-snug group-hover:text-blue-700 transition-colors">
                {item.location}
              </h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-0.5">감정가</p>
                  <p className="text-sm font-semibold text-gray-900">{formatMoney(item.appraisal)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 font-medium mb-0.5">최저가 <span className="text-red-500 ml-1">유찰 {item.failed_count}회</span></p>
                  <p className="text-sm font-bold text-blue-600">{formatMoney(item.min_bid)}</p>
                  {item.auction_date && (
                    <p className="text-xs text-gray-500 mt-1">기일: {item.auction_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}</p>
                  )}
                </div>
              </div>
            </article>
          ))}
          
          {loading && [1,2,3].map(i => (
            <div key={i} className="bg-white h-32 rounded-2xl border border-gray-100 animate-pulse"></div>
          ))}
        </div>
        
        {!loading && hasMore && (
          <button 
            onClick={handleLoadMore}
            className="w-full mt-6 bg-white border border-gray-200 text-gray-700 font-semibold py-3.5 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors shadow-sm"
          >
            더 보기
          </button>
        )}
        
        {!loading && !hasMore && auctions.length > 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            모든 물건을 불러왔습니다.
          </div>
        )}
      </main>

      {/* 모달 (page.tsx와 동일 로직) */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setSelectedDetail(null)}></div>
          <div className="bg-white rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-200">
            {detailLoading ? (
               <div className="p-8 text-center text-gray-500">
                 <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                 데이터를 불러오는 중입니다...
               </div>
            ) : (
              <div>
                <div className="sticky top-0 bg-white/90 backdrop-blur-md px-6 py-4 border-b border-gray-100 flex justify-between items-center z-20">
                  <h3 className="font-bold text-gray-900">{selectedDetail.case_number} 상세 분석</h3>
                  <button onClick={() => setSelectedDetail(null)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="p-6 space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">물건 소재지</h4>
                    <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 leading-relaxed">
                      <span className="inline-block mb-2 text-xs font-bold px-2 py-0.5 bg-gray-200 text-gray-700 rounded mr-2">
                        {getPropertyType(selectedDetail.location, (selectedDetail as any).usage)}
                      </span>
                      {selectedDetail.location}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <a 
                        href={`https://map.kakao.com/link/search/${encodeURIComponent(selectedDetail.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors"
                      >
                        📍 카카오맵 / 로드뷰
                      </a>
                      <a 
                        href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedDetail.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        🗺️ 네이버지도
                      </a>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                     <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <p className="text-xs text-blue-600 font-medium mb-1">감정가</p>
                        <p className="text-lg font-bold text-gray-900">{formatMoney(selectedDetail.appraisal)}</p>
                     </div>
                     <div className="bg-red-50/50 p-4 rounded-xl border border-red-100">
                        <p className="text-xs text-red-600 font-medium mb-1">최저 매각가</p>
                        <p className="text-lg font-bold text-red-600">{formatMoney(selectedDetail.min_bid)}</p>
                     </div>
                  </div>

                  {/* 선순위 권리 & 낙찰자 인수 보증금 핵심 분석 카드 */}
                  {(() => {
                    const analysis = analyzeSeniorDeposit(
                      selectedDetail.rights_list,
                      selectedDetail.tenant_registration_date,
                      selectedDetail.tenant_deposit,
                      selectedDetail.is_payout_requested
                    );
                    const malso = analysis.malsoStandard;

                    return (
                      <div className={`p-4 rounded-2xl border transition-all ${
                        analysis.riskLevel === 'CRITICAL' 
                          ? 'bg-red-50/70 border-red-200 shadow-2xs' 
                          : analysis.riskLevel === 'WARNING'
                          ? 'bg-amber-50/70 border-amber-200 shadow-2xs'
                          : 'bg-emerald-50/70 border-emerald-200'
                      }`}>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold flex items-center gap-1.5 text-gray-900">
                            <span>{analysis.riskLevel === 'CRITICAL' ? '🚨' : analysis.riskLevel === 'WARNING' ? '⚠️' : '🛡️'}</span>
                            <span>선순위 권리 &amp; 인수 보증금 분석</span>
                          </h4>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${analysis.statusBadge.color}`}>
                            {analysis.statusBadge.text}
                          </span>
                        </div>

                        {/* 4분할 지표 그리드 */}
                        <div className="grid grid-cols-2 gap-2 text-xs bg-white/90 p-3 rounded-xl border border-gray-100 shadow-2xs mb-2.5">
                          <div className="border-r border-gray-100 pr-2">
                            <span className="text-gray-400 block text-[11px] mb-0.5">말소기준권리</span>
                            <span className="font-semibold text-gray-800">
                              {malso ? `${malso.name} (${malso.date})` : '등기 미기재 / 확인필요'}
                            </span>
                          </div>
                          <div className="pl-1">
                            <span className="text-gray-400 block text-[11px] mb-0.5">최초 전입신고일</span>
                            <span className="font-semibold text-gray-800">
                              {selectedDetail.tenant_registration_date === '임차인없음'
                                ? '없음 (소유자 점유)'
                                : (selectedDetail.tenant_registration_date || '현황조사서 미등재')}
                            </span>
                          </div>
                          <div className="border-r border-gray-100 pr-2 pt-2 border-t">
                            <span className="text-gray-400 block text-[11px] mb-0.5">신고 임차보증금</span>
                            <span className="font-semibold text-gray-900">
                              {selectedDetail.tenant_deposit 
                                ? formatMoney(selectedDetail.tenant_deposit) 
                                : (analysis.hasTenant ? '미상 (현황조사서 미표기)' : '해당 없음')}
                            </span>
                          </div>
                          <div className="pl-1 pt-2 border-t border-gray-100">
                            <span className="text-gray-400 block text-[11px] mb-0.5">배당요구 여부</span>
                            <span className="font-semibold text-gray-800">
                              {selectedDetail.is_payout_requested 
                                ? '✅ 요구함' 
                                : (analysis.hasTenant ? '❌ 미요구' : '해당 없음')}
                            </span>
                          </div>
                        </div>

                        {/* 인수 보증금 하이라이트 배너 */}
                        <div className={`p-3 rounded-xl mb-2 flex items-center justify-between ${
                          analysis.riskLevel === 'CRITICAL'
                            ? 'bg-red-100/80 text-red-950 border border-red-200'
                            : analysis.riskLevel === 'WARNING'
                            ? 'bg-amber-100/80 text-amber-950 border border-amber-200'
                            : 'bg-emerald-100/80 text-emerald-950 border border-emerald-200'
                        }`}>
                          <div className="text-xs font-semibold">낙찰자 인수 예상 보증금</div>
                          <div className={`text-base font-extrabold ${
                            analysis.riskLevel === 'CRITICAL' ? 'text-red-700' : analysis.riskLevel === 'WARNING' ? 'text-amber-700' : 'text-emerald-700'
                          }`}>
                            {analysis.depositText}
                          </div>
                        </div>

                        <p className="text-xs text-gray-700 leading-relaxed">
                          {analysis.summaryText}
                        </p>

                        {/* 현황조사서 임차인 개별 목록 (각각 선순위/후순위 판정) */}
                        {aiReport?.tenants && aiReport.tenants.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-200/60 text-xs">
                            <p className="font-semibold text-gray-900 mb-2 flex items-center justify-between">
                              <span>현황조사서 등재 임차인 상세</span>
                              <span className="text-blue-600 font-bold">총 {aiReport.tenants.length}명</span>
                            </p>
                            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                              {aiReport.tenants.map((t: any, idx: number) => {
                                const tClean = (t.move_in_date || '').replace(/[^0-9]/g, '');
                                const mClean = malso ? malso.date.replace(/[^0-9]/g, '') : '';
                                const isIndivSenior = mClean && tClean ? tClean < mClean : null;

                                return (
                                  <div key={idx} className="bg-white p-2.5 rounded-xl border border-gray-100 flex justify-between items-center text-gray-700 shadow-2xs">
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-gray-900">{t.name || '미상'}</span>
                                        {t.room && <span className="text-gray-500 text-[11px]">({t.room})</span>}
                                        {isIndivSenior === true && (
                                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                                            선순위 인수주의
                                          </span>
                                        )}
                                        {isIndivSenior === false && (
                                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            후순위 소멸
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-gray-500 mt-1">
                                        전입: {t.move_in_date || '미상'} {t.fixed_date ? `| 확정: ${t.fixed_date}` : ''}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <span className={`font-bold block ${isIndivSenior ? 'text-red-600' : 'text-gray-800'}`}>
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
                    );
                  })()}

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🤖</span>
                        <h4 className="font-bold text-gray-900">AI 권리분석 리포트</h4>
                      </div>
                      <span className={`text-sm font-bold px-3 py-1 rounded-full border ${getGradeColor(selectedDetail.ai_grade)}`}>
                        {selectedDetail.ai_grade} 등급
                      </span>
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
