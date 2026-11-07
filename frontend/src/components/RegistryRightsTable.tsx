'use client';

import React, { useState } from 'react';

interface RightItem {
  name: string;
  date: string;
}

interface RegistryRightsTableProps {
  rightsListJson?: string | any[];
  tenantRegistrationDate?: string;
  aiReport?: {
    extinguished_rights?: string[];
    retained_rights?: string[];
    tenants?: any[];
  } | null;
}

export default function RegistryRightsTable({
  rightsListJson,
  tenantRegistrationDate,
  aiReport
}: RegistryRightsTableProps) {
  const [isOpen, setIsOpen] = useState(true);

  // 1. 등기부 권리 목록 파싱
  let rightsList: RightItem[] = [];
  if (rightsListJson) {
    try {
      const parsed = typeof rightsListJson === 'string' ? JSON.parse(rightsListJson) : rightsListJson;
      if (Array.isArray(parsed)) {
        rightsList = parsed
          .filter(r => r && (r.name || r.date))
          .map(r => ({
            name: String(r.name || '').trim(),
            date: String(r.date || '').trim()
          }));
      }
    } catch {
      rightsList = [];
    }
  }

  // 2. 말소기준권리(Base Date of Annulment) 탐색
  const malsoKeywords = ['담보가등기', '근저당', '가압류', '경매개시결정', '경매개시', '압류', '저당'];
  const candidates = rightsList.filter(r => 
    malsoKeywords.some(k => r.name.includes(k)) && r.date.replace(/[^0-9]/g, '').length >= 8
  );
  candidates.sort((a, b) => a.date.replace(/[^0-9]/g, '').localeCompare(b.date.replace(/[^0-9]/g, '')));
  const malsoStandard = candidates.length > 0 ? candidates[0] : null;
  const cleanMalso = malsoStandard ? malsoStandard.date.replace(/[^0-9]/g, '') : '';

  // 3. 권리 목록을 일자순으로 정렬
  const sortedRights = [...rightsList].sort((a, b) => {
    const da = a.date.replace(/[^0-9]/g, '');
    const db = b.date.replace(/[^0-9]/g, '');
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });

  // 4. 소멸되는 권리 및 인수 권리 요약 추출
  const extinguishedFromAI = aiReport?.extinguished_rights?.filter(r => r && r !== '없음') || [];
  const retainedFromAI = aiReport?.retained_rights?.filter(r => r && r !== '없음') || [];

  // 등기 권리 개수 및 소멸 개수 계산
  const totalCount = sortedRights.length;
  let extinguishedCount = 0;
  let seniorRiskCount = 0;

  sortedRights.forEach(r => {
    const dClean = r.date.replace(/[^0-9]/g, '');
    if (malsoStandard && r.name === malsoStandard.name && r.date === malsoStandard.date) {
      extinguishedCount++;
    } else if (cleanMalso && dClean && dClean > cleanMalso) {
      extinguishedCount++;
    } else if (cleanMalso && dClean && dClean < cleanMalso) {
      if (['가처분', '가등기', '지상권', '전세권'].some(k => r.name.includes(k))) {
        seniorRiskCount++;
      } else {
        extinguishedCount++;
      }
    } else {
      extinguishedCount++;
    }
  });

  return (
    <div className="p-4 rounded-2xl border bg-white border-blue-200/80 shadow-2xs space-y-3">
      {/* 카드 상단 헤더 & 토글 버튼 */}
      <div 
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-base">📜</span>
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span>등기부 권리 전체 내역 &amp; 소멸(말소) 투명 분석</span>
          </h4>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
            등기 권리 {totalCount}건
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {seniorRiskCount > 0 ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200">
              🚨 인수위험 {seniorRiskCount}건
            </span>
          ) : (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
              ✅ 낙찰 시 100% 소멸(말소)
            </span>
          )}
          <button 
            type="button"
            className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded transition-colors"
          >
            {isOpen ? '▲ 닫기' : '▼ 펼치기'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-3 pt-1">
          {/* 1. 핵심 요약 배너 */}
          <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="text-gray-500 block text-[11px] font-medium mb-0.5">기준이 되는 말소기준권리</span>
              <span className="font-bold text-blue-900 break-words">
                {malsoStandard ? (
                  <>🎯 {malsoStandard.name} <span className="font-normal text-blue-700">({malsoStandard.date} 설정)</span></>
                ) : (
                  '등기부 확인 필요 (공고 기본내역 없음)'
                )}
              </span>
            </div>
            <div className="sm:text-right shrink-0">
              <span className="text-gray-500 block text-[11px] font-medium mb-0.5">등기부 권리 처리 상태</span>
              <span className="font-extrabold text-emerald-700">
                {seniorRiskCount === 0 ? '낙찰 후 전액 소멸 (인수 0건)' : `선순위 주의 ${seniorRiskCount}건`}
              </span>
            </div>
          </div>

          {/* 2. 등기부 등재 권리 일자순 타임라인 리스트 */}
          {sortedRights.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-gray-500 px-0.5 flex items-center justify-between">
                <span>등기 순서 (설정일자순)</span>
                <span>권리 처리 판정</span>
              </div>

              {sortedRights.map((right, idx) => {
                const dClean = right.date.replace(/[^0-9]/g, '');
                const isMalso = malsoStandard && right.name === malsoStandard.name && right.date === malsoStandard.date;
                const isJunior = cleanMalso && dClean ? dClean > cleanMalso : false;
                const isSenior = cleanMalso && dClean ? dClean < cleanMalso : false;
                const isRiskySenior = isSenior && ['가처분', '가등기', '지상권', '전세권'].some(k => right.name.includes(k));

                return (
                  <div 
                    key={idx}
                    className={`p-3 rounded-xl border transition-all text-xs ${
                      isRiskySenior
                        ? 'bg-red-50/80 border-red-200'
                        : isMalso
                        ? 'bg-indigo-50/70 border-indigo-200 shadow-2xs'
                        : 'bg-gray-50/80 border-gray-200/80'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="font-mono text-gray-400 font-bold text-[11px]">#{idx + 1}</span>
                        <span className="font-bold text-gray-900 text-xs sm:text-sm">{right.name}</span>
                        {right.date && (
                          <span className="text-[11px] text-gray-500 font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200">
                            {right.date}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0">
                        {isRiskySenior ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                            🚨 선순위 인수 주의
                          </span>
                        ) : isMalso ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                            🎯 말소기준권리 (소멸)
                          </span>
                        ) : isJunior ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                            ✅ 낙찰 시 소멸 (말소)
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-300">
                            ✅ 배당 후 소멸 (말소)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 법적 상세 설명 */}
                    <div className="text-[11px] leading-relaxed text-gray-600 bg-white/80 p-2 rounded-lg border border-gray-100">
                      {isRiskySenior ? (
                        <p className="text-red-800 font-medium">
                          ⚠️ 말소기준권리보다 앞서 설정된 권리입니다. 매각허가로 소멸되지 않고 <strong>낙찰자가 권리상 부담을 인수</strong>해야 하므로 입찰 전 확인이 필수적입니다.
                        </p>
                      ) : isMalso ? (
                        <p className="text-indigo-950 font-medium">
                          💡 <strong>말소기준권리</strong>로서 후순위 권리들의 소멸 기준선이 됩니다. 낙찰 대금에서 배당 순위에 따라 배당받고 <strong>등기부상 완전히 말소(소멸)</strong>됩니다.
                        </p>
                      ) : isJunior ? (
                        <p className="text-emerald-950">
                          🛡️ 말소기준권리 이후에 설정된 권리입니다. 민사집행법 제91조 <strong>소멸주의 원칙에 따라 낙찰자가 잔금을 납부하면 법원의 등기 촉탁으로 100% 전부 말소(소멸)</strong>되며 낙찰자가 갚을 의무가 없습니다.
                        </p>
                      ) : (
                        <p className="text-gray-700">
                          낙찰 후 배당절차를 거쳐 매각으로 인해 소멸(말소)되는 권리입니다.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200/80 text-xs text-gray-600 text-center">
              등기부 권리 요약이 등록되지 않았거나 소유자 단독 점유 매물입니다. (법원 매각물건명세서 원본 열람 권장)
            </div>
          )}

          {/* 3. AI 리포트 연계: 소멸 권리 목록 (extinguished_rights) */}
          {extinguishedFromAI.length > 0 && (
            <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 text-xs">
              <span className="text-emerald-900 font-bold block mb-1.5 flex items-center gap-1.5">
                <span>🛡️</span>
                <span>낙찰 시 등기부에서 지워지는 권리 목록 (AI 권리분석 매칭)</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {extinguishedFromAI.map((r, i) => (
                  <span 
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white text-emerald-800 border border-emerald-300 font-semibold text-[11px] shadow-2xs"
                  >
                    <span>✓</span>
                    <span>{r}</span>
                    <span className="text-[10px] text-emerald-600 font-normal">(말소)</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 4. 소멸주의 법적 원리 투명 안내 박스 */}
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-200/80 text-xs text-gray-700 space-y-1">
            <div className="font-bold text-gray-900 flex items-center gap-1">
              <span>💡</span>
              <span>왜 후순위 빚이나 근저당이 아무리 많아도 안전한가요? (소멸주의 원칙)</span>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-600">
              대한민국 <strong>민사집행법 제91조</strong>에 따라, 말소기준권리(최선순위 근저당·압류·가압류 등)를 포함하여 그 이후에 등기된 모든 권리는 <strong>낙찰자가 잔금을 완납하면 법원이 등기소에 말소촉탁</strong>을 보내 등기부에서 깨끗하게 지워줍니다. 따라서 채무액이 수억 원이라도 낙찰자에게 승계되지 않고 100% 안전하게 소멸됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
