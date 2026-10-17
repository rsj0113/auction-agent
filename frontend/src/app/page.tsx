"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { analyzeSeniorDeposit, formatMoney, formatMoneyShort, formatDateShort, QUICK_CHIPS } from "./auctions/page";
import InvestmentCalculator from "@/components/InvestmentCalculator";
import AuctionMap from "@/components/AuctionMap";

interface SummaryData {
  total_active_auctions: number;
  today_recommended: number;
  briefing_text: string;
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
}

interface AuctionDetail extends AuctionItem {
  ai_report_json?: string;
  ai_suggested_bid?: string;
  ai_verdict?: string;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  is_payout_requested?: number;
  rights_list?: string;
  sample_listings?: SampleListing[];
  senior_deposit_assumed?: number;
  min_market_price?: number;
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


function getGradeColor(grade: string) {
  if (!grade) return 'bg-gray-100 text-gray-500 border-gray-200';
  const g = grade.toUpperCase();
  if (g === 'S') return 'bg-red-50 text-red-600 border-red-200';
  if (g === 'A') return 'bg-blue-50 text-blue-600 border-blue-200';
  if (g === 'B') return 'bg-green-50 text-green-600 border-green-200';
  if (g === 'C') return 'bg-yellow-50 text-yellow-600 border-yellow-200';
  if (g === 'D') return 'bg-gray-50 text-gray-600 border-gray-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
}

export default function Home() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickFilter, setQuickFilter] = useState<string>("");
  const [quickCounts, setQuickCounts] = useState<{ [key: string]: number }>({});
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [selectedAuction, setSelectedAuction] = useState<AuctionItem | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AuctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  let aiReport = null;
  if (selectedDetail?.ai_report_json) {
    try {
      aiReport = JSON.parse(selectedDetail.ai_report_json);
    } catch (e) {}
  }
    const handleSelectAuction = async (item: AuctionItem) => {
    setSelectedDetail({ ...item, ai_report_json: "{}" } as AuctionDetail);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/auctions/${item.case_number}`, { headers: { "ngrok-skip-browser-warning": "1" } });
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

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const [summaryRes, countsRes] = await Promise.all([
          fetch("/api/dashboard/summary", { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null),
          fetch("/api/auctions/quick-counts", { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null),
        ]);

        if (summaryRes?.ok) {
          const sData = await summaryRes.json();
          setSummary(sData);
        }
        if (countsRes?.ok) {
          const cData = await countsRes.json();
          if (cData && typeof cData.total === "number") {
            setQuickCounts(cData);
          }
        }
      } catch (error) {
        console.error("초기 요약 로딩 실패:", error);
      }
    };
    fetchInitial();
  }, []);

  useEffect(() => {
    const fetchAuctions = async () => {
      setLoading(true);
      try {
        const limit = viewMode === "map" ? 300 : (quickFilter ? 12 : 6);
        let url = `/api/auctions?limit=${limit}&sort=recommend`;
        if (quickFilter) {
          url += `&quick_filter=${quickFilter}`;
        }
        const auctionsRes = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null);
        if (auctionsRes?.ok) {
          const aData = await auctionsRes.json();
          setAuctions(aData.data);
        }
      } catch (error) {
        console.error("매물 로딩 실패:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAuctions();
  }, [quickFilter, viewMode]);

  // 금액 포맷 (ex: 5억 2,000만)
  const formatPrice = (price: number) => {
    if (!price) return "-";
    const uk = Math.floor(price / 100000000);
    const man = Math.floor((price % 100000000) / 10000);
    return `${uk > 0 ? uk + '억 ' : ''}${man > 0 ? man + '만' : ''}원`;
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* 1. 요약 브리핑 섹션 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700">오늘의 요약 브리핑</h2>
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
              🗺️ 지도보기
            </button>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {loading && !summary ? (
            <div className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xl font-medium text-gray-900 leading-relaxed">
                {summary?.briefing_text || "오늘은 어떤 좋은 물건이 나왔을까요? 데이터를 분석 중입니다."}
              </p>
              <div className="flex gap-4 pt-4 border-t border-gray-100">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 uppercase">진행중 물건</span>
                  <span className="text-2xl font-bold text-gray-900">{summary?.total_active_auctions || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 uppercase">A등급 이상</span>
                  <span className="text-2xl font-bold text-blue-600">{summary?.today_recommended || 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 투자자 원클릭 퀵 필터 & 전체 검색 배너 */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">⚡</span>
            <h3 className="text-sm font-bold text-gray-900">투자자 원클릭 퀵 필터</h3>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/auctions?region=성남&view=map"
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors"
            >
              📍 성남·분당 지도보기
            </Link>
            <Link
              href={quickFilter ? `/auctions?qf=${quickFilter}` : "/auctions"}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 transition-colors"
            >
              상세 조건 검색 열기 &rarr;
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_CHIPS.map((chip) => {
            const isActive = quickFilter === chip.id;
            const count = quickCounts[chip.countKey];
            return (
              <button
                key={chip.id}
                onClick={() => setQuickFilter(isActive ? "" : chip.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30 font-bold scale-[1.02]"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100 hover:text-gray-900 border border-gray-200"
                }`}
              >
                <span>{chip.icon}</span>
                <span>{chip.label}</span>
                {typeof count === "number" && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                    isActive ? "bg-white/25 text-white" : "bg-white text-gray-500 border border-gray-200/60"
                  }`}>
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 지도 보기 활성화 시 인터랙티브 지도 표시 */}
      {viewMode === "map" && (
        <section>
          <AuctionMap
            items={auctions}
            onSelectItem={(item) => handleSelectAuction(item)}
            focusRegion={quickFilter}
          />
        </section>
      )}

      {/* 2. 추천 물건 리스트 */}
      <section>
        <div className="flex justify-between items-end mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-700">
              {quickFilter
                ? `${QUICK_CHIPS.find((c) => c.id === quickFilter)?.icon || "⚡"} ${QUICK_CHIPS.find((c) => c.id === quickFilter)?.label || ""} 매물`
                : "AI 추천 물건 Top 6"}
            </h2>
            {quickFilter && (
              <button
                onClick={() => setQuickFilter("")}
                className="text-xs text-gray-500 hover:text-red-600 bg-gray-100 px-2 py-0.5 rounded-md font-medium"
              >
                필터 해제 ✕
              </button>
            )}
          </div>
          <Link href={quickFilter ? `/auctions?qf=${quickFilter}` : "/auctions"} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
            전체 매물 더보기 &rarr;
          </Link>
        </div>
        
        <div className="grid grid-cols-1 gap-4">
          {loading && [1,2,3].map(i => (
            <div key={i} className="bg-white h-48 rounded-2xl border border-gray-100 animate-pulse"></div>
          ))}
          
          {!loading && auctions.map((item) => (
            <article 
              key={item.case_number} 
              onClick={() => handleSelectAuction(item)}
              className="bg-white border border-gray-200 hover:border-blue-500/50 rounded-2xl p-4 sm:p-5 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-2.5 gap-2">
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  <span className={`px-2 py-0.5 text-xs font-bold rounded-lg border shrink-0 ${getGradeColor(item.ai_grade)}`}>
                    {item.ai_grade || '분석중'} 등급
                  </span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg shrink-0">
                    {getPropertyType(item.location, item.usage)}
                  </span>
                  {(() => {
                    const analysis = analyzeSeniorDeposit(
                      item.rights_list,
                      item.tenant_registration_date,
                      item.tenant_deposit,
                      item.is_payout_requested
                    );
                    return (
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-lg border shrink-0 ${analysis.statusBadge.color}`}>
                        {analysis.statusBadge.text}
                      </span>
                    );
                  })()}
                  {/* 특수권리 태그 배지 */}
                  {(() => {
                    try {
                      const tags = item.special_rights ? JSON.parse(item.special_rights) : [];
                      return tags.map((t: any) => (
                        <span key={t.id} className={`px-2 py-0.5 text-xs font-bold rounded-lg border shrink-0 ${t.badge_color || 'bg-amber-100 text-amber-800 border-amber-200'}`} title={t.desc}>
                          {t.icon || '🏷️'} {t.short || t.name}
                        </span>
                      ));
                    } catch {
                      return null;
                    }
                  })()}
                </div>
                <span className="text-xs text-gray-400 font-medium shrink-0">{item.case_number}</span>
              </div>
              
              <h3 className="text-base font-medium text-gray-900 mb-4 line-clamp-2 min-h-[3rem] group-hover:text-blue-600 transition-colors">
                {item.location}
              </h3>
              
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">감정가</span>
                  <span className="text-gray-400 line-through decoration-gray-400">{formatPrice(item.appraisal)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span className="text-gray-600">최저가</span>
                  <span className="text-red-500">{formatPrice(item.min_bid)}</span>
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
                      네이버 시세 {formatMoney(item.market_price)} ({item.market_match_level} {item.market_match_count}건)
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 rounded-md font-bold text-[11px] bg-emerald-600 text-white shadow-2xs">
                      시세 대비 {item.market_discount_pct}%↓
                    </span>
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
              
              <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-2 text-xs text-gray-500">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span>유찰 {item.failed_count}회</span>
                    {item.auction_date && (
                      <span className="text-gray-600 font-medium">· 매각기일: {item.auction_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}</span>
                    )}
                  </div>
                  <span className="text-blue-600 font-medium">
                    {item.status_flag?.toUpperCase() === 'UNCHANGED' ? '기일변경' : item.status_flag}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-gray-600">
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
              </div>
            </article>
          ))}
          
          {!loading && auctions.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500 bg-gray-50 rounded-2xl border border-gray-200 border-dashed">
              서버를 연결하거나 데이터를 채워주세요. (FastAPI가 꺼져있을 수 있습니다)
            </div>
          )}
        </div>
      </section>

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
                    <h3 className="font-bold text-gray-900 text-base truncate">{selectedDetail.case_number} 상세 분석</h3>
                    <p className="text-xs text-gray-500 truncate">{selectedDetail.location}</p>
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

                        {/* 현황조사서 임차인 개별 목록 */}
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
