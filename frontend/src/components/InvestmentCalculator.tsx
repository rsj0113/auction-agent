"use client";

import React, { useState, useEffect } from "react";

interface InvestmentCalculatorProps {
  appraisal: number;
  minBid: number;
  seniorDeposit?: number;
  isHouse?: boolean;
  location?: string;
}

export function formatMoney(val?: number): string {
  if (!val) return "0원";
  if (val >= 100000000) {
    const eok = Math.floor(val / 100000000);
    const man = Math.floor((val % 100000000) / 10000);
    return `${eok}억${man > 0 ? ` ${man.toLocaleString()}만` : ""}원`;
  }
  if (val >= 10000) {
    const man = Math.floor(val / 10000);
    return `${man.toLocaleString()}만원`;
  }
  return `${val.toLocaleString()}원`;
}

export function formatMoneyShort(val?: number): string {
  if (!val) return "0원";
  if (val >= 100000000) {
    const eok = (val / 100000000).toFixed(1).replace(/\.0$/, "");
    return `${eok}억`;
  }
  if (val >= 10000) {
    const man = Math.round(val / 10000);
    return `${man.toLocaleString()}만`;
  }
  return `${val.toLocaleString()}원`;
}

function getPriorityDeposit(location?: string): number {
  const loc = location || "";
  if (loc.includes("서울")) return 5500; // 5,500만원
  if (loc.includes("과천") || loc.includes("성남") || loc.includes("하남") || loc.includes("광명") || loc.includes("부천") || loc.includes("인천") || loc.includes("수원") || loc.includes("고양") || loc.includes("안양")) return 4800;
  if (loc.includes("부산") || loc.includes("대구") || loc.includes("대전") || loc.includes("광주") || loc.includes("울산") || loc.includes("세종")) return 2800;
  return 2500;
}

function getDefaultTaxRate(priceWon: number, isHouse: boolean): number {
  if (!isHouse) return 4.6;
  const eok = priceWon / 100000000;
  if (eok <= 6) return 1.1;
  if (eok > 9) return 3.5;
  return Math.round(((eok * 2) / 3 - 3 + 0.2) * 100) / 100;
}

export default function InvestmentCalculator({
  appraisal,
  minBid,
  seniorDeposit = 0,
  isHouse = true,
  location = "",
}: InvestmentCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 입력 상태 (만원 단위)
  const defaultBidMan = Math.max(100, Math.round(minBid / 10000));
  const [bidPrice, setBidPrice] = useState<number>(defaultBidMan);
  const [loanType, setLoanType] = useState<"auction" | "custom" | "none">("auction");
  const [customLtv, setCustomLtv] = useState<number>(70);
  const [roomCount, setRoomCount] = useState<number>(isHouse ? 1 : 0);
  const [prioDeduction, setPrioDeduction] = useState<number>(getPriorityDeposit(location));
  const [interestRate, setInterestRate] = useState<number>(4.5);
  const [taxRate, setTaxRate] = useState<number>(getDefaultTaxRate(minBid, isHouse));
  const [etcCostRate, setEtcCostRate] = useState<number>(0.5);
  const [assumedDepMan, setAssumedDepMan] = useState<number>(Math.round(seniorDeposit / 10000));
  const [rentalDepositMan, setRentalDepositMan] = useState<number>(0);
  const [monthlyRentMan, setMonthlyRentMan] = useState<number>(0);

  // minBid나 seniorDeposit 변경 시 초기화
  useEffect(() => {
    setBidPrice(Math.max(100, Math.round(minBid / 10000)));
    setAssumedDepMan(Math.round(seniorDeposit / 10000));
    setTaxRate(getDefaultTaxRate(minBid, isHouse));
  }, [minBid, seniorDeposit, isHouse]);

  // 계산 로직 (원 단위)
  const bidWon = bidPrice * 10000;
  const appraisalWon = appraisal || bidWon;

  // 대출 한도 계산
  let loanLimitWon = 0;
  if (loanType === "auction") {
    // 경락잔금대출: 낙찰가 80% vs 감정가 70% 중 적은 것
    loanLimitWon = Math.min(bidWon * 0.8, appraisalWon * 0.7);
  } else if (loanType === "custom") {
    loanLimitWon = bidWon * (customLtv / 100);
  } else {
    loanLimitWon = 0;
  }

  // 방공제 차감
  const roomDeductionWon = loanType === "auction" ? roomCount * prioDeduction * 10000 : 0;
  const loanWon = Math.max(0, Math.round(loanLimitWon - roomDeductionWon));

  // 세금 및 부대비용
  const taxWon = Math.round(bidWon * (taxRate / 100));
  const etcWon = Math.round(bidWon * (etcCostRate / 100));
  const assumedWon = assumedDepMan * 10000;

  // 총 취득 원가 (입찰가 + 세금 + 등기비 + 선순위 인수보증금)
  const totalBuyWon = bidWon + taxWon + etcWon + assumedWon;

  // 필요 실투자금 (총 취득 원가 - 대출금 - 임대보증금)
  const rentalDepositWon = rentalDepositMan * 10000;
  const cashRequiredWon = totalBuyWon - loanWon - rentalDepositWon;

  // 이자 및 월세 수익률
  const monthlyInterestWon = Math.round((loanWon * (interestRate / 100)) / 12);
  const monthlyRentWon = monthlyRentMan * 10000;
  const netMonthlyIncomeWon = monthlyRentWon - monthlyInterestWon;
  const annualYield =
    cashRequiredWon > 0 && monthlyRentMan > 0
      ? (((netMonthlyIncomeWon * 12) / cashRequiredWon) * 100).toFixed(1)
      : null;

  // 입찰보증금 (최저가의 10%)
  const bidDepositWon = Math.round(minBid * 0.1);

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-2xl border border-blue-200/70 p-4 shadow-2xs transition-all">
      {/* 헤더 토글 바 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🧮</span>
          <div>
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>실전 투자금 &amp; 경락잔금대출 계산기</span>
              {seniorDeposit > 0 && (
                <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold border border-red-200">
                  인수액 자동반영
                </span>
              )}
            </h4>
            <p className="text-[11px] text-gray-500">
              필요 현금(실투자금), 대출 한도, 취득세, 월 수익률 시뮬레이션
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 shadow-2xs hover:bg-gray-50"
        >
          {isOpen ? "접기 ▲" : "계산기 열기 ▼"}
        </button>
      </div>

      {/* 요약 바 (닫혀 있을 때도 실투자금 요약 노출) */}
      {!isOpen && (
        <div className="mt-3 pt-3 border-t border-gray-200/60 flex items-center justify-between text-xs">
          <div className="text-gray-500">
            예상 대출: <span className="font-bold text-gray-800">{formatMoneyShort(loanWon)}</span>
          </div>
          <div className="text-gray-900 font-bold">
            필요 실투자금:{" "}
            <span className="text-blue-600 text-sm font-extrabold">
              {cashRequiredWon > 0 ? formatMoney(cashRequiredWon) : "0원 (무피/대출 충당)"}
            </span>
          </div>
        </div>
      )}

      {/* 상세 입력 및 결과 패널 (펼쳤을 때) */}
      {isOpen && (
        <div className="mt-4 pt-4 border-t border-gray-200/80 space-y-4 text-xs animate-in fade-in duration-150">
          {/* 핵심 결과 대시보드 카드 */}
          <div className="bg-white p-3.5 rounded-xl border border-blue-200 shadow-2xs space-y-2">
            <div className="flex justify-between items-baseline pb-2 border-b border-gray-100">
              <span className="text-gray-600 font-semibold">내 손에 필요한 순수 현금 (실투자금)</span>
              <span className="text-base sm:text-lg font-black text-blue-600">
                {cashRequiredWon > 0 ? formatMoney(cashRequiredWon) : "0원 (무피/플피 투자)"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
              <div>
                <span className="text-gray-400 block">총 소요 매입가</span>
                <span className="font-bold text-gray-800">{formatMoney(totalBuyWon)}</span>
              </div>
              <div>
                <span className="text-gray-400 block">예상 대출 가능액</span>
                <span className="font-bold text-emerald-700">{formatMoney(loanWon)}</span>
                {roomDeductionWon > 0 && (
                  <span className="text-[10px] text-gray-400 block">
                    (방공제 {formatMoneyShort(roomDeductionWon)} 차감)
                  </span>
                )}
              </div>
              <div>
                <span className="text-gray-400 block">취득세 + 등기법무비</span>
                <span className="font-medium text-gray-700">{formatMoney(taxWon + etcWon)}</span>
              </div>
              <div>
                <span className="text-gray-400 block">입찰보증금 (10%)</span>
                <span className="font-medium text-gray-700">{formatMoney(bidDepositWon)}</span>
              </div>
            </div>

            {/* 임대 세팅 시 월세 수익률 결과 */}
            {monthlyRentMan > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 bg-amber-50/60 p-2 rounded-lg flex justify-between items-center text-[11px]">
                <div>
                  <span className="text-gray-600">월 순수익 (월세-이자):</span>{" "}
                  <span
                    className={`font-bold ${netMonthlyIncomeWon >= 0 ? "text-amber-700" : "text-red-600"}`}
                  >
                    {netMonthlyIncomeWon >= 0
                      ? `+${formatMoney(netMonthlyIncomeWon)}/월`
                      : `-${formatMoney(-netMonthlyIncomeWon)}/월`}
                  </span>
                </div>
                {annualYield && (
                  <div>
                    <span className="text-gray-600">연 수익률:</span>{" "}
                    <span className="font-black text-amber-700 text-xs">{annualYield}%</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 파라미터 조절 입력 폼 */}
          <div className="space-y-3 bg-white/70 p-3 rounded-xl border border-gray-200/80">
            {/* 1. 입찰 희망가 */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="font-semibold text-gray-700">입찰 희망가</label>
                <span className="font-bold text-blue-600">{formatMoney(bidWon)}</span>
              </div>
              <div className="flex gap-1.5 items-center">
                <input
                  type="number"
                  step="100"
                  value={bidPrice}
                  onChange={(e) => setBidPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-500 font-semibold"
                />
                <span className="text-gray-500 text-xs">만원</span>
                <button
                  type="button"
                  onClick={() => setBidPrice((prev) => prev + 500)}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[11px] text-gray-700"
                >
                  +500만
                </button>
                <button
                  type="button"
                  onClick={() => setBidPrice((prev) => prev + 1000)}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[11px] text-gray-700"
                >
                  +1천만
                </button>
              </div>
            </div>

            {/* 2. 대출 설정 */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-gray-600 mb-1 font-medium">대출 방식</label>
                <select
                  value={loanType}
                  onChange={(e) => setLoanType(e.target.value as any)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                >
                  <option value="auction">경락잔금 (낙찰80%/감정70%)</option>
                  <option value="custom">직접입력 (LTV 지정)</option>
                  <option value="none">대출 없음 (전액현금)</option>
                </select>
              </div>

              {loanType === "custom" ? (
                <div>
                  <label className="block text-gray-600 mb-1 font-medium">LTV 비율 (%)</label>
                  <input
                    type="number"
                    value={customLtv}
                    onChange={(e) => setCustomLtv(parseFloat(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-gray-600 mb-1 font-medium">대출 금리 (연 %)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={interestRate}
                    onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>

            {/* 3. 주거용 방빼기(방공제) & 취득세 */}
            {loanType === "auction" && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-gray-600 mb-1 font-medium">
                    방공제 방 수{" "}
                    <span className="text-[10px] text-gray-400">({prioDeduction}만/방)</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setRoomCount(Math.max(0, roomCount - 1))}
                      className="w-6 h-6 bg-gray-100 rounded text-gray-700 font-bold"
                    >
                      -
                    </button>
                    <span className="flex-1 text-center font-bold text-gray-800">{roomCount}개</span>
                    <button
                      type="button"
                      onClick={() => setRoomCount(roomCount + 1)}
                      className="w-6 h-6 bg-gray-100 rounded text-gray-700 font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-gray-600 mb-1 font-medium">취득세율 (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {/* 4. 인수 보증금 (선순위 인수액 자동연동) */}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex justify-between items-center mb-1">
                <label className="font-semibold text-gray-700 flex items-center gap-1">
                  <span>낙찰자 인수 보증금</span>
                  {seniorDeposit > 0 && (
                    <span className="text-[10px] text-red-600 font-normal">
                      (권리분석 자동 연동됨)
                    </span>
                  )}
                </label>
                <span className="font-bold text-red-600">{formatMoney(assumedWon)}</span>
              </div>
              <div className="flex gap-1.5 items-center">
                <input
                  type="number"
                  step="100"
                  value={assumedDepMan}
                  onChange={(e) => setAssumedDepMan(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-500"
                />
                <span className="text-gray-500 text-xs">만원</span>
              </div>
            </div>

            {/* 5. 임대 계획 (전세/월세 회수 세팅) */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-gray-600 mb-1 font-medium">
                  임대 보증금 (전세 등)
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="100"
                    placeholder="0"
                    value={rentalDepositMan || ""}
                    onChange={(e) => setRentalDepositMan(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                  />
                  <span className="text-gray-400 text-[11px] shrink-0">만원</span>
                </div>
              </div>
              <div>
                <label className="block text-gray-600 mb-1 font-medium">월 임대료 (월세)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="5"
                    placeholder="0"
                    value={monthlyRentMan || ""}
                    onChange={(e) => setMonthlyRentMan(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-500"
                  />
                  <span className="text-gray-400 text-[11px] shrink-0">만원</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-400 leading-normal">
            * 경락잔금대출은 낙찰가 80%와 감정가 70% 중 낮은 금액에서 소액임차인 최우선변제금(방공제)을
            차감한 기준입니다. 개인 소득(DSR), 보유 주택 수, 은행 심사에 따라 실제 대출 한도는 달라질 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
