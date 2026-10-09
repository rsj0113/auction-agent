"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SummaryData {
  total_active_auctions: number;
  today_recommended: number;
  briefing_text: string;
}

interface AuctionItem {
  case_number: string;
  location: string;
  appraisal: number;
  min_bid: number;
  failed_count: number;
  ai_grade: string;
  status_flag: string;
}

interface AuctionDetail extends AuctionItem {
  ai_report_json?: string;
  ai_suggested_bid?: string;
  ai_verdict?: string;
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
    // API 서버 호출 (uvicorn이 켜져있어야 함)
    const fetchData = async () => {
      try {
        const [summaryRes, auctionsRes] = await Promise.all([
          fetch("/api/dashboard/summary", { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null),
          fetch("/api/auctions?limit=6&sort=recommend", { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null)
        ]);

        if (summaryRes?.ok) {
          const sData = await summaryRes.json();
          setSummary(sData);
        }
        if (auctionsRes?.ok) {
          const aData = await auctionsRes.json();
          setAuctions(aData.data);
        }
      } catch (error) {
        console.error("데이터 로딩 실패:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

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
        <h2 className="text-lg font-semibold mb-4 text-gray-700">오늘의 요약 브리핑</h2>
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {loading ? (
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

      {/* 2. 추천 물건 리스트 */}
      <section>
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-semibold text-gray-700">AI 추천 물건 Top 6</h2>
          <Link href="/auctions" className="text-sm text-blue-600 hover:text-blue-500 transition-colors">
            전체보기 &rarr;
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
              className="bg-white border border-gray-200 hover:border-blue-500/50 rounded-2xl p-5 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-bold rounded ${
                    item.ai_grade === 'S' ? 'bg-red-50 text-red-600' :
                    item.ai_grade === 'A' ? 'bg-blue-50 text-blue-600' :
                    item.ai_grade === 'B' ? 'bg-green-50 text-green-600' :
                    item.ai_grade === 'C' ? 'bg-yellow-50 text-yellow-600' :
                    item.ai_grade === 'D' ? 'bg-gray-50 text-gray-800' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {item.ai_grade || '분석중'} 등급
                  </span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                    {getPropertyType(item.location)}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{item.case_number}</span>
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
              
              <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                <span>유찰 {item.failed_count}회</span>
                <span className="text-blue-600 font-medium">
                  {item.status_flag?.toUpperCase() === 'UNCHANGED' ? '기일변경' : item.status_flag}
                </span>
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
                        <p className="text-lg font-bold text-gray-900">{formatPrice(selectedDetail.appraisal)}</p>
                     </div>
                     <div className="bg-red-50/50 p-4 rounded-xl border border-red-100">
                        <p className="text-xs text-red-600 font-medium mb-1">최저 매각가</p>
                        <p className="text-lg font-bold text-red-600">{formatPrice(selectedDetail.min_bid)}</p>
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
                        <span className="font-medium text-red-600">{selectedDetail?.tenant_deposit ? formatPrice(selectedDetail.tenant_deposit) : '미상/없음'}</span>
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
