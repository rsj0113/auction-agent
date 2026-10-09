"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AuctionItem {
  case_number: string;
  location: string;
  appraisal: number;
  min_bid: number;
  failed_count: number;
  ai_grade: string;
  status_flag: string;
}

interface AIReport {
  verdict: string;
  risks: string[];
  retained_rights: string[];
  expected_yield: string;
  suggested_bid: string;
  analysis_detail?: string;
}

interface AuctionDetail extends AuctionItem {
  ai_report_json: string;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  is_payout_requested?: number;
}


function getPropertyType(location: string): string {
  if (!location) return "기타";
  if (location.includes("아파트")) return "🏢 아파트";
  if (location.includes("오피스텔")) return "🏬 오피스텔";
  if (location.includes("다세대") || location.includes("빌라")) return "🏘️ 빌라/다세대";
  if (location.includes("상가") || location.includes("근린")) return "상가/근린시설";
  if (location.includes("산") && location.match(/산\s*[0-9]+/)) return "🌲 임야(산)";
  if (location.includes("임야")) return "🌲 임야(산)";
  if (location.match(/[0-9]+번지/)) return "🗺️ 토지/대지";
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
  const [regionFilter, setRegionFilter] = useState<string>("");

  // 모달 상태
  const [selectedDetail, setSelectedDetail] = useState<AuctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchAuctions = async (pageIndex: number, overrideParams?: { grade?: string, price?: string, sort?: string, propertyType?: string, region?: string }) => {
    try {
      if (pageIndex === 0) setLoading(true);
      const grade = overrideParams?.grade ?? gradeFilter;
      const price = overrideParams?.price ?? priceFilter;
      const sort = overrideParams?.sort ?? sortOrder;
      const propertyType = overrideParams?.propertyType ?? propertyTypeFilter;
      const region = overrideParams?.region ?? regionFilter;
      
      let url = `/api/auctions?limit=20&offset=${pageIndex * 20}`;
      if (grade) url += `&grade=${grade}`;
      if (sort) url += `&sort=${sort}`;
      if (propertyType) url += `&property_type=${propertyType}`;
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
  }, [gradeFilter, priceFilter, sortOrder, propertyTypeFilter, regionFilter]);

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
            
            <input 
              type="text"
              placeholder="지역 검색 (예: 강남구)"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            />
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
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg">
                  {item.case_number}
                </span>
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
                        {getPropertyType(selectedDetail.location)}
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

                  {/* 임차인 정보 */}
                  <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100">
                    <h4 className="text-sm font-semibold text-orange-900 mb-2 flex items-center gap-1">
                      <span>👤</span> 임차인 정보 (권리분석용)
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
                      <div>
                        <span className="text-gray-500 text-xs block">전입신고일</span>
                        <span className="font-medium">{selectedDetail?.tenant_registration_date || '정보 없음'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs block">보증금</span>
                        <span className="font-medium text-red-600">{selectedDetail?.tenant_deposit ? formatMoney(selectedDetail.tenant_deposit) : '미상/없음'}</span>
                      </div>
                      <div className="col-span-2 mt-1">
                        <span className="text-gray-500 text-xs mr-2">배당요구:</span>
                        <span className="font-medium">{selectedDetail?.is_payout_requested ? '✅ 요구함' : '❌ 미요구/해당없음'}</span>
                      </div>
                    </div>
                  </div>

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
