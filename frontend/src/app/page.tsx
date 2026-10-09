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
}

export default function Home() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAuction, setSelectedAuction] = useState<AuctionItem | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AuctionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleSelectAuction = async (item: AuctionItem) => {
    setSelectedAuction(item);
    setSelectedDetail(null);
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
          fetch("/api/auctions?limit=6", { headers: { "ngrok-skip-browser-warning": "1" } }).catch(() => null)
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
                <span className={`px-2 py-1 text-xs font-bold rounded ${
                  item.ai_grade === 'S' ? 'bg-red-50 text-red-600' :
                  item.ai_grade === 'A' ? 'bg-blue-50 text-blue-600' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {item.ai_grade || '분석중'} 등급
                </span>
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
                <span className="text-blue-600 font-medium">{item.status_flag}</span>
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

      {/* 3. 모달 (Modal) UI */}
      {selectedAuction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 text-lg">물건 상세 정보</h3>
              <button 
                onClick={() => setSelectedAuction(null)}
                className="text-gray-400 hover:text-gray-700 p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-6">
              {/* 기본 정보 */}
              <div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  {selectedAuction.case_number}
                </span>
                <h4 className="mt-2 text-gray-900 font-medium leading-snug">{selectedAuction.location}</h4>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-gray-500 text-xs mb-1">감정가</p>
                    <p className="font-semibold text-gray-700">{formatPrice(selectedAuction.appraisal)}</p>
                  </div>
                  <div className="bg-red-50 p-3 rounded-lg">
                    <p className="text-red-500 text-xs mb-1">최저가 ({selectedAuction.failed_count}회 유찰)</p>
                    <p className="font-bold text-red-600">{formatPrice(selectedAuction.min_bid)}</p>
                  </div>
                </div>
              </div>

              {/* AI 리포트 (Real Data) */}
              <div className="border-t border-gray-100 pt-5 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <h4 className="font-bold text-gray-800">AI 권리분석 및 수익률 리포트</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {detailLoading && <span className="text-xs text-blue-500 animate-pulse">데이터 로딩 중...</span>}
                    {!detailLoading && selectedDetail && (
                      <button
                        onClick={async () => {
                          setDetailLoading(true);
                          try {
                            const res = await fetch(`/api/auctions/${selectedDetail.case_number}/analyze`, { method: "POST", headers: { "ngrok-skip-browser-warning": "1" } });
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
                        className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                      >
                        실시간 재분석 🔄
                      </button>
                    )}
                  </div>
                </div>
                
                {!detailLoading && selectedDetail && (() => {
                  let aiReport = null;
                  try {
                    aiReport = selectedDetail.ai_report_json ? JSON.parse(selectedDetail.ai_report_json) : null;
                  } catch (e) {
                    console.error("AI 리포트 파싱 오류:", e);
                  }

                  if (!aiReport) {
                    return (
                      <div className="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">
                        아직 AI 분석이 완료되지 않은 물건입니다.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between p-3 border border-gray-100 rounded-lg">
                        <span className="text-gray-600">추천 입찰가</span>
                        <span className="font-bold text-gray-900">{aiReport.suggested_bid || '-'}</span>
                      </div>
                      <div className="flex justify-between p-3 border border-gray-100 rounded-lg">
                        <span className="text-gray-600">예상 실효수익률</span>
                        <span className="font-bold text-blue-600">{aiReport.expected_yield || '-'}</span>
                      </div>
                      <div className="p-3 border border-gray-100 rounded-lg bg-gray-50">
                        <span className="block text-gray-600 mb-1 font-medium">권리분석 및 가치 종합</span>
                        <p className="text-gray-700">{aiReport.verdict || selectedDetail.ai_verdict}</p>
                      </div>
                      {aiReport.risks && aiReport.risks.length > 0 && (
                        <div className="p-3 border border-red-100 rounded-lg bg-red-50/50">
                          <span className="block text-red-600 mb-1 font-medium">위험 요소 (Risk)</span>
                          <ul className="list-disc list-inside text-red-800/80 space-y-1">
                            {aiReport.risks.map((risk: string, idx: number) => (
                              <li key={idx}>{risk}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {aiReport.retained_rights && aiReport.retained_rights.length > 0 && aiReport.retained_rights[0] !== '없음' && (
                        <div className="p-3 border border-orange-100 rounded-lg bg-orange-50">
                          <span className="block text-orange-700 mb-1 font-medium">인수해야 할 권리/보증금</span>
                          <ul className="list-disc list-inside text-orange-800 space-y-1">
                            {aiReport.retained_rights.map((right: string, idx: number) => (
                              <li key={idx}>{right}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="p-3 border border-blue-100 rounded-lg bg-blue-50/50 mt-2">
                        <span className="block text-blue-700 mb-1 font-medium">전문가 상세 분석</span>
                        <p className="text-blue-800/80 text-xs leading-relaxed whitespace-pre-wrap">
                          {aiReport.analysis_detail || "상세 분석 내용이 없습니다."}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50">
              <button 
                onClick={() => setSelectedAuction(null)}
                className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
