"use client";

import { useEffect, useState } from "react";

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

export default function Home() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // API 서버 호출 (uvicorn이 켜져있어야 함)
    const fetchData = async () => {
      try {
        const [summaryRes, auctionsRes] = await Promise.all([
          fetch("http://127.0.0.1:8000/api/dashboard/summary").catch(() => null),
          fetch("http://127.0.0.1:8000/api/auctions?limit=6").catch(() => null)
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
    <div className="space-y-8 animate-fade-in">
      {/* 1. 요약 브리핑 섹션 */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-gray-300">오늘의 요약 브리핑</h2>
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 shadow-lg">
          {loading ? (
            <div className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-gray-600 rounded w-3/4"></div>
                <div className="h-4 bg-gray-600 rounded w-1/2"></div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xl font-medium text-white leading-relaxed">
                {summary?.briefing_text || "오늘은 어떤 좋은 물건이 나왔을까요? 데이터를 분석 중입니다."}
              </p>
              <div className="flex gap-4 pt-4 border-t border-gray-700">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400 uppercase">진행중 물건</span>
                  <span className="text-2xl font-bold text-white">{summary?.total_active_auctions || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400 uppercase">A등급 이상</span>
                  <span className="text-2xl font-bold text-blue-400">{summary?.today_recommended || 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. 추천 물건 리스트 */}
      <section>
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-semibold text-gray-300">AI 추천 물건 Top 6</h2>
          <button className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            전체보기 &rarr;
          </button>
        </div>
        
        <div className="grid grid-cols-1 gap-4">
          {loading && [1,2,3].map(i => (
            <div key={i} className="bg-gray-800 h-48 rounded-2xl animate-pulse"></div>
          ))}
          
          {!loading && auctions.map((item) => (
            <article 
              key={item.case_number} 
              className="bg-gray-800 border border-gray-700 hover:border-blue-500/50 rounded-2xl p-5 shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-3">
                <span className={`px-2 py-1 text-xs font-bold rounded ${
                  item.ai_grade === 'S' ? 'bg-red-500/20 text-red-400' :
                  item.ai_grade === 'A' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {item.ai_grade || '분석중'} 등급
                </span>
                <span className="text-xs text-gray-500">{item.case_number}</span>
              </div>
              
              <h3 className="text-base font-medium text-white mb-4 line-clamp-2 min-h-[3rem] group-hover:text-blue-400 transition-colors">
                {item.location}
              </h3>
              
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">감정가</span>
                  <span className="text-gray-300 line-through decoration-gray-500">{formatPrice(item.appraisal)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span className="text-gray-400">최저가</span>
                  <span className="text-white text-red-400">{formatPrice(item.min_bid)}</span>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between text-xs text-gray-400">
                <span>유찰 {item.failed_count}회</span>
                <span className="text-blue-400 font-medium">{item.status_flag}</span>
              </div>
            </article>
          ))}
          
          {!loading && auctions.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500 bg-gray-800/50 rounded-2xl border border-gray-700 border-dashed">
              서버를 연결하거나 데이터를 채워주세요. (FastAPI가 꺼져있을 수 있습니다)
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
