"use client";

import React, { useState } from "react";
import { formatMoney } from "../app/auctions/page";

interface AgentAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAuction?: (item: any) => void;
  onAddToPlanner?: (item: any, source: string) => void;
  initialTab?: "recommend" | "chat";
  initialCaseNumber?: string;
}

interface SecretaryPick {
  case_number: string;
  title: string;
  reason: string;
}

interface ComparisonTableRow {
  metric: string;
  item1: string;
  item2?: string;
  item3?: string;
}

interface CandidateItem {
  case_number: string;
  location: string;
  usage?: string;
  floor?: number;
  area_pyeong?: number;
  area_m2?: number;
  appraisal: number;
  min_bid: number;
  winning_bid?: number;
  winning_rate?: number;
  failed_count?: number;
  safety_margin?: number;
  rental_yield?: number;
  tenant_registration_date?: string;
  source_type?: string;
  villa_trade_info?: any;
  post_auction_analysis?: any;
}

interface RecommendCompareResponse {
  intent_summary: string;
  secretary_pick: SecretaryPick | null;
  candidates: CandidateItem[];
  comparison_table: ComparisonTableRow[];
  briefing_markdown: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  referenced_item?: CandidateItem;
}

export default function AgentAdvisorModal({
  isOpen,
  onClose,
  onSelectAuction,
  onAddToPlanner,
  initialTab = "recommend",
  initialCaseNumber,
}: AgentAdvisorModalProps) {
  const [activeTab, setActiveTab] = useState<"recommend" | "chat">(initialTab);

  // Tab 1: Recommend & Compare state
  const [recPrompt, setRecPrompt] = useState("");
  const [recLoading, setRecLoading] = useState(false);
  const [recResult, setRecResult] = useState<RecommendCompareResponse | null>(null);

  // Tab 2: Results & Case Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [focusedCase, setFocusedCase] = useState<string>(initialCaseNumber || "");

  if (!isOpen) return null;

  const handleRunRecommend = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || recPrompt).trim();
    if (!promptToSend || recLoading) return;

    if (customPrompt) setRecPrompt(customPrompt);
    setRecLoading(true);

    try {
      const res = await fetch("/api/agent/recommend-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ prompt: promptToSend }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecResult(data);
      } else {
        alert("비서의 추천 분석 생성 중 오류가 발생했습니다.");
      }
    } catch (e) {
      console.error(e);
      alert("서버 통신 오류가 발생했습니다.");
    } finally {
      setRecLoading(false);
    }
  };

  const handleSendChat = async (customMsg?: string) => {
    const textToSend = (customMsg || chatInput).trim();
    if (!textToSend || chatLoading) return;

    const newHistory: ChatMessage[] = [...chatMessages, { role: "user", content: textToSend }];
    setChatMessages(newHistory);
    if (!customMsg) setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({
          message: textToSend,
          chat_history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          case_number: focusedCase || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages([
          ...newHistory,
          { role: "assistant", content: data.reply, referenced_item: data.referenced_item },
        ]);
      } else {
        setChatMessages([
          ...newHistory,
          { role: "assistant", content: "⚠️ AI 답변 생성 중 오류가 발생했습니다." },
        ]);
      }
    } catch (e) {
      console.error(e);
      setChatMessages([
        ...newHistory,
        { role: "assistant", content: "⚠️ 서버 통신 에러가 발생했습니다." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl border border-indigo-200 overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between border-b border-indigo-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center text-xl shadow-md border border-white/20">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                  AI 수석 실시간 투자 비서
                </h3>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-violet-600 text-white border border-violet-400/30">
                  gpt-4o-mini
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  온디맨드 가동중
                </span>
              </div>
              <p className="text-xs text-indigo-200 font-medium">
                원할 때 즉시 전체 매물을 스캔하고, 1:1 비교 및 낙찰 결과 심층 질의를 도와드립니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer text-sm"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="bg-gray-100/90 p-1.5 flex gap-1.5 border-b border-gray-200 text-xs sm:text-sm font-bold">
          <button
            type="button"
            onClick={() => setActiveTab("recommend")}
            className={`flex-1 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "recommend"
                ? "bg-white text-indigo-900 shadow-sm border border-indigo-100 scale-[1.01]"
                : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
            }`}
          >
            <span>⚡</span>
            <span>매물 추천 &amp; 실시간 맞비교 (Recommend &amp; Compare)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "chat"
                ? "bg-white text-indigo-900 shadow-sm border border-indigo-100 scale-[1.01]"
                : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
            }`}
          >
            <span>🏆</span>
            <span>낙찰 결과 심층 분석 대화 (Results Q&amp;A)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/50">
          {/* TAB 1: RECOMMEND & COMPARE */}
          {activeTab === "recommend" && (
            <div className="space-y-4">
              {/* Presets */}
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-gray-800 flex items-center gap-1">
                    <span>⚡</span> <span>비서에게 바로 명령하기 (원클릭 프리셋)</span>
                  </span>
                  <span className="text-[11px] text-gray-400">클릭 즉시 실시간 스캔</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleRunRecommend("예산 2억 이하 실거래가 대비 가장 싼 빌라 3개 비교해줘")}
                    disabled={recLoading}
                    className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-100/70 text-left transition-colors cursor-pointer flex items-start gap-2"
                  >
                    <span className="text-base shrink-0">🏡</span>
                    <div>
                      <strong className="text-amber-950 block">예산 2억 이하 갭투자 빌라 TOP 3</strong>
                      <span className="text-[11px] text-amber-800">국토부 실거래가 대비 최고 할인율 물건 비교</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunRecommend("수익률 7% 이상 1층 상가 vs 지하1층 체육시설 비교해줘")}
                    disabled={recLoading}
                    className="p-2.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 text-left transition-colors cursor-pointer flex items-start gap-2"
                  >
                    <span className="text-base shrink-0">🏪</span>
                    <div>
                      <strong className="text-blue-950 block">수익률 7%+ 1층 vs B1 상가 비교</strong>
                      <span className="text-[11px] text-blue-800">월세 현금흐름 및 공실 리스크 대조</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunRecommend("안전마진 1억 이상 & 선순위 권리 깨끗한 성남 매물 뽑아줘")}
                    disabled={recLoading}
                    className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 text-left transition-colors cursor-pointer flex items-start gap-2"
                  >
                    <span className="text-base shrink-0">🎯</span>
                    <div>
                      <strong className="text-emerald-950 block">안전마진 1억+ &amp; 무위험 권리 매물</strong>
                      <span className="text-[11px] text-emerald-800">대항력 임차인 없고 근저당 말소 확실한 건</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunRecommend("현금 5천만원으로 갭투자 가능한 성남/광주 빌라 2개 골라서 비교해줘")}
                    disabled={recLoading}
                    className="p-2.5 rounded-xl border border-purple-200 bg-purple-50/60 hover:bg-purple-100/70 text-left transition-colors cursor-pointer flex items-start gap-2"
                  >
                    <span className="text-base shrink-0">💰</span>
                    <div>
                      <strong className="text-purple-950 block">실투자금 5천만원 소액 갭투자 맞비교</strong>
                      <span className="text-[11px] text-purple-800">전세 세팅 시 남는 현금 및 수익률 산출</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Free-form Natural Language Input */}
              <div className="bg-white p-3 sm:p-4 rounded-2xl border border-indigo-200 shadow-sm flex items-center gap-2">
                <input
                  type="text"
                  value={recPrompt}
                  onChange={(e) => setRecPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleRunRecommend();
                    }
                  }}
                  placeholder="비서에게 원하는 조건(예: '성남 30평대 1층 상가 가성비 좋은 거 골라줘')을 말씀해 보세요..."
                  disabled={recLoading}
                  className="flex-1 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleRunRecommend()}
                  disabled={recLoading || !recPrompt.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-sm shrink-0 flex items-center gap-1.5"
                >
                  {recLoading ? (
                    <>
                      <span className="inline-block animate-spin">⏳</span>
                      <span>스캔 중...</span>
                    </>
                  ) : (
                    <>
                      <span>실시간 분석</span>
                      <span>⚡</span>
                    </>
                  )}
                </button>
              </div>

              {/* Loading State */}
              {recLoading && (
                <div className="p-8 rounded-2xl bg-white border border-indigo-100 text-center space-y-3 shadow-sm">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-2xl mx-auto animate-bounce">
                    🤖
                  </div>
                  <h4 className="text-sm font-extrabold text-gray-900">
                    전체 8,700여 건 매물 DB를 실시간 스크리닝 중입니다...
                  </h4>
                  <p className="text-xs text-gray-500">
                    권리 안전성 검증 ➔ 국토부 실거래가 및 네이버 시세 대조 ➔ 후보군 간 1:1 비교표 생성 중
                  </p>
                </div>
              )}

              {/* Result Area */}
              {recResult && !recLoading && (
                <div className="space-y-4 animate-fade-in">
                  {/* Secretary's Pick Card */}
                  {recResult.secretary_pick && (
                    <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white rounded-2xl p-4 sm:p-5 shadow-md space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider bg-black/20 px-2.5 py-0.5 rounded-lg">
                          🥇 비서의 최종 원픽 (Secretary's Pick)
                        </span>
                        <span className="text-xs font-bold text-amber-100">
                          {recResult.secretary_pick.case_number}
                        </span>
                      </div>
                      <h4 className="text-lg sm:text-xl font-black tracking-tight">
                        {recResult.secretary_pick.title}
                      </h4>
                      <p className="text-xs sm:text-sm text-amber-50 leading-relaxed font-medium">
                        {recResult.secretary_pick.reason}
                      </p>
                    </div>
                  )}

                  {/* 1:1 Side-by-Side Comparison Table */}
                  {recResult.comparison_table && recResult.comparison_table.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="p-3.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                        <h4 className="text-xs sm:text-sm font-black text-gray-900 flex items-center gap-1.5">
                          <span>⚖️</span> <span>후보 매물 1:1 항목별 맞비교 분석표</span>
                        </h4>
                        <span className="text-[11px] font-bold text-indigo-600">
                          {recResult.intent_summary}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                            <tr>
                              <th className="p-3 w-1/4">비교 항목</th>
                              <th className="p-3 text-indigo-950 font-extrabold">후보 1번 매물</th>
                              {recResult.candidates[1] && <th className="p-3 text-indigo-950 font-extrabold">후보 2번 매물</th>}
                              {recResult.candidates[2] && <th className="p-3 text-indigo-950 font-extrabold">후보 3번 매물</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium text-gray-800">
                            {recResult.comparison_table.map((row, idx) => (
                              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                                <td className="p-3 font-bold text-gray-700 bg-gray-50/80">{row.metric}</td>
                                <td className="p-3 text-gray-900 font-semibold">{row.item1}</td>
                                {recResult.candidates[1] && <td className="p-3 text-gray-900 font-semibold">{row.item2 || "-"}</td>}
                                {recResult.candidates[2] && <td className="p-3 text-gray-900 font-semibold">{row.item3 || "-"}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Candidate Property Action Cards */}
                  {recResult.candidates && recResult.candidates.length > 0 && (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-bold text-gray-700">📋 후보 물건 리스트 및 원클릭 액션:</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {recResult.candidates.map((c, idx) => (
                          <div
                            key={c.case_number || idx}
                            className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs hover:border-indigo-400 transition-all flex flex-col justify-between space-y-3"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  후보 {idx + 1}번 · {c.usage || "부동산"}
                                </span>
                                <span className="text-xs text-gray-400 font-semibold">{c.case_number}</span>
                              </div>
                              <h5 className="text-sm font-extrabold text-gray-900 leading-snug truncate">
                                📍 {c.location}
                              </h5>
                              <p className="text-xs text-gray-500 mt-1">
                                감정 {formatMoney(c.appraisal)} ➔{" "}
                                <strong className="text-blue-700 font-bold">
                                  {c.winning_bid ? `낙찰 ${formatMoney(c.winning_bid)}` : `최저 ${formatMoney(c.min_bid)}`}
                                </strong>
                              </p>
                              {c.safety_margin && c.safety_margin > 0 ? (
                                <span className="inline-block mt-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                  마진 +{formatMoney(c.safety_margin)}
                                </span>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100 text-xs">
                              <button
                                type="button"
                                onClick={() => onSelectAuction && onSelectAuction(c)}
                                className="flex-1 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors cursor-pointer text-center"
                              >
                                🔍 물건 상세
                              </button>
                              <button
                                type="button"
                                onClick={() => onAddToPlanner && onAddToPlanner(c, c.source_type || "auction")}
                                className="flex-1 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-extrabold transition-colors cursor-pointer text-center flex items-center justify-center gap-1 shadow-2xs"
                              >
                                <span>📍</span> <span>임장 담기</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Secretary's Detailed Markdown Briefing */}
                  {recResult.briefing_markdown && (
                    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm text-xs sm:text-sm text-gray-800 space-y-2 leading-relaxed">
                      <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-1.5">
                        <span>📝</span> <span>수석 비서의 종합 투자 브리핑</span>
                      </h4>
                      <div className="whitespace-pre-wrap font-medium text-gray-700 break-keep">
                        {recResult.briefing_markdown}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AUCTION RESULTS CHAT */}
          {activeTab === "chat" && (
            <div className="space-y-4">
              {/* Context Picker */}
              <div className="bg-white p-3 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-gray-800 flex items-center gap-1">
                    <span>💡</span> <span>낙찰 결과 추천 질문 (원클릭)</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-400">특정 사건번호 지정:</span>
                    <input
                      type="text"
                      value={focusedCase}
                      onChange={(e) => setFocusedCase(e.target.value)}
                      placeholder="예: 2023타경126956"
                      className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5 outline-none font-semibold w-28"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleSendChat("최근 낙찰된 물건 중에서 2등과 100만원 이하로 아슬아슬하게 낙찰된 건들은 왜 그런 거야?")}
                    disabled={chatLoading}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-semibold transition-colors cursor-pointer text-left"
                  >
                    🥈 2등과 초근접 낙찰 건 심리 분석
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChat("감정가 대비 가장 파격적인 할인가로 낙찰된 물건 3개 짚어줘")}
                    disabled={chatLoading}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-semibold transition-colors cursor-pointer text-left"
                  >
                    🏆 최고 할인율 줍줍형 낙찰 건 분석
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChat("최근 낙찰건 중 인수할 권리 없는 안전한 물건들만 짚어줘")}
                    disabled={chatLoading}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 font-semibold transition-colors cursor-pointer text-left"
                  >
                    🛡️ 권리 인수 없는 안전 낙찰 사례
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChat("상대원선경아파트(2023타경126956) 낙찰가와 2등 격차 분석해줘")}
                    disabled={chatLoading}
                    className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 font-semibold transition-colors cursor-pointer text-left"
                  >
                    🏢 성남 상대원선경아파트 실전 분석
                  </button>
                </div>
              </div>

              {/* Chat Thread */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4 min-h-[340px] max-h-[460px] overflow-y-auto space-y-3 text-xs sm:text-sm shadow-sm">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400 space-y-2">
                    <span className="text-3xl">💬</span>
                    <p className="font-bold text-gray-600">낙찰 결과에 대해 무엇이든 편하게 물어보세요.</p>
                    <p className="text-xs text-gray-400 max-w-sm">
                      "왜 이 가격에 낙찰됐어?", "2등이랑 왜 300만원밖에 차이 안 나?", "내가 낙찰받았다면 전세갭 얼마 들어?" 등 실무적 대화가 가능합니다.
                    </p>
                  </div>
                )}

                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-2xl leading-relaxed break-keep max-w-[85%] ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white ml-auto font-semibold shadow-xs"
                        : "bg-slate-100 text-gray-800 mr-auto border border-gray-200 whitespace-pre-wrap font-medium"
                    }`}
                  >
                    <span className="text-[10px] block opacity-70 font-bold mb-1">
                      {msg.role === "user" ? "👤 투자자 (나)" : "🤖 AI 수석 비서"}
                    </span>
                    {msg.content}
                    {msg.referenced_item && (
                      <div className="mt-2.5 pt-2 border-t border-gray-300/60 text-xs flex items-center justify-between">
                        <span className="font-extrabold text-indigo-950 truncate">
                          📍 {msg.referenced_item.location} ({msg.referenced_item.case_number})
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectAuction && onSelectAuction(msg.referenced_item)}
                          className="px-2 py-0.5 rounded bg-indigo-600 text-white font-bold text-[10px] hover:bg-indigo-700 ml-2 shrink-0"
                        >
                          물건보기 ↗
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 mr-auto flex items-center gap-2 max-w-[85%] animate-pulse">
                    <span className="inline-block animate-spin">⏳</span>
                    <span className="text-xs font-semibold">비서가 낙찰 기록과 권리내역, 실거래가를 검토 중입니다...</span>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="bg-white p-2.5 sm:p-3 rounded-2xl border border-indigo-200 shadow-sm flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="낙찰가 형성 이유, 2등과의 심리전, 엑시트 방안 등을 질문해 보세요..."
                  disabled={chatLoading}
                  className="flex-1 text-xs sm:text-sm bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleSendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-sm shrink-0 flex items-center gap-1"
                >
                  {chatLoading ? (
                    <span>답변 중...</span>
                  ) : (
                    <>
                      <span>질문</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
