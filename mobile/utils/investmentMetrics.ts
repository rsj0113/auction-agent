import { FeedItem } from '../types/feed';
import { isOnbidLease } from './sourceBadge';

export type BangCategory = 'residential' | 'commercial' | 'land';

export interface BangGongjeInfo {
  category: BangCategory;
  amount: number;
  regionShort: string;
  regionLabel: string;
}

const METRO_OVERCROWDED = [
  '인천', '성남', '분당', '수원', '용인', '안양', '과천', '광명', '의왕', '군포',
  '부천', '시흥', '고양', '일산', '하남', '구리', '남양주', '의정부', '화성', '김포', '파주', '경기',
];

const METROPOLITAN_CITIES = ['부산', '대구', '대전', '광주', '울산', '세종'];

/**
 * 용도별(주거용 / 상가·근린 / 토지) 법정 소액임차보증금(방공제) 기준 산출
 * - 주거용(아파트·빌라·오피스텔): 주택임대차보호법 (서울 5,500만 / 과밀억제 4,800만 / 광역시 2,800만 / 기타 2,500만)
 * - 상가·근린생활시설: 상가건물 임대차보호법 (서울 2,200만 / 과밀억제 1,900만 / 광역시 1,300만 / 기타 1,000만)
 * - 토지: 미적용 (0원)
 */
export function getBangGongjeInfo(location: string, usage: string): BangGongjeInfo {
  const u = (usage || '').trim();
  const loc = location || '';

  if (u === '토지' || u.includes('토지') || u.includes('대지') || u.includes('임야')) {
    return { category: 'land', amount: 0, regionShort: '토지', regionLabel: '토지 미적용' };
  }

  const isCommercial = u === '상가' || u.includes('상가') || u.includes('근린');
  const isSeoul = loc.includes('서울');
  const isOvercrowded = METRO_OVERCROWDED.some((kw) => loc.includes(kw));
  const isMetroCity = METROPOLITAN_CITIES.some((kw) => loc.includes(kw));

  if (isCommercial) {
    if (isSeoul) {
      return { category: 'commercial', amount: 22_000_000, regionShort: '서울', regionLabel: '서울 2,200만원' };
    }
    if (isOvercrowded) {
      return { category: 'commercial', amount: 19_000_000, regionShort: '과밀억제', regionLabel: '과밀억제권역 1,900만원' };
    }
    if (isMetroCity) {
      return { category: 'commercial', amount: 13_000_000, regionShort: '광역시', regionLabel: '광역시 1,300만원' };
    }
    return { category: 'commercial', amount: 10_000_000, regionShort: '기타', regionLabel: '기타 지역 1,000만원' };
  }

  // 주거용 (아파트·빌라·오피스텔 등)
  if (isSeoul) {
    return { category: 'residential', amount: 55_000_000, regionShort: '서울', regionLabel: '서울 5,500만원' };
  }
  if (isOvercrowded) {
    return { category: 'residential', amount: 48_000_000, regionShort: '과밀억제', regionLabel: '과밀억제권역 4,800만원' };
  }
  if (isMetroCity) {
    return { category: 'residential', amount: 28_000_000, regionShort: '광역시', regionLabel: '광역시 2,800만원' };
  }
  return { category: 'residential', amount: 25_000_000, regionShort: '기타', regionLabel: '기타 지역 2,500만원' };
}

/**
 * 지역별 소액임차보증금(방공제) 기준 금액(원) 반환
 */
export function getRegionalBangGongje(location: string, usage: string): number {
  return getBangGongjeInfo(location, usage).amount;
}

/**
 * 매각 물건의 예상 실투자금(필요 자기자본)을 원 단위로 산출한다.
 * - 주거용(LTV 70%): 기본 방공제 면제(MCI/MCG 보증보험 ON) → 방공제 0원
 * - 상가(LTV 60%): 주택용 MCI 비대상 · 실무상 자가사용/신탁 등 기본 방공제 0원 (conservativeBangDeduct=true 시 상가임대차법 차감)
 * - 토지(LTV 60%): 방공제 0원(미적용)
 * - 공매 임대 물건은 null 반환.
 */
export function estimateQuickEquity(
  item: FeedItem,
  options?: { mciExempt?: boolean; commercialBangDeduct?: boolean }
): number | null {
  if (!item || isOnbidLease(item)) return null;
  const basePrice = item.min_bid || 0;
  if (basePrice <= 0) return null;

  const bangInfo = getBangGongjeInfo(item.location, item.usage);
  const isNonResidential = bangInfo.category !== 'residential';
  const ltv = isNonResidential ? 0.6 : 0.7;
  const appraisalBase = Math.min(basePrice, item.appraisal || basePrice);

  const mciExempt = options?.mciExempt ?? true;
  const commercialBangDeduct = options?.commercialBangDeduct ?? false;

  let appliedBang = 0;
  if (bangInfo.category === 'residential') {
    appliedBang = mciExempt ? 0 : bangInfo.amount;
  } else if (bangInfo.category === 'commercial') {
    appliedBang = commercialBangDeduct ? bangInfo.amount : 0;
  } else {
    appliedBang = 0;
  }

  const estLoan = Math.max(0, Math.floor(appraisalBase * ltv) - appliedBang);
  const pureEquity = Math.max(0, basePrice - estLoan);

  const taxRate = isNonResidential ? 0.046 : basePrice <= 600_000_000 ? 0.013 : 0.025;
  const extraCost = Math.round((basePrice * taxRate + 2_000_000) / 100_000) * 100_000;
  const assumedDeposit = item.ai_analysis?.assumed_deposit || 0;

  return pureEquity + extraCost + assumedDeposit;
}

/**
 * 짧은 금액 표기 (예: 4,820만 / 2.4억)
 */
export function formatShortEquity(val: number): string {
  if (!val || val <= 0) return '0원';
  const rounded = Math.round(val / 100_000) * 100_000;
  if (rounded >= 100_000_000) {
    const eok = (rounded / 100_000_000).toFixed(1).replace(/\.0$/, '');
    return `${eok}억`;
  }
  const man = Math.round(rounded / 10_000);
  return `${man.toLocaleString()}만`;
}

/**
 * 매각 물건의 예상 연 수익률(%) 반환 (인근 전월세 시세 매칭 데이터 없으면 null)
 */
export function getEstimatedYieldPct(item: FeedItem): number | null {
  if (!item || isOnbidLease(item)) return null;
  const y = item.rental_estimate?.annual_yield_pct;
  if (typeof y === 'number' && Number.isFinite(y) && y > 0) {
    return y;
  }
  return null;
}
