import { FeedItem } from '../types/feed';
import { isOnbidLease } from './sourceBadge';

/**
 * 지역별 소액임차보증금(방공제) 기준 산출 — 상세 화면 계산기와 동일 기준
 */
export function getRegionalBangGongje(location: string, usage: string): number {
  if (usage === '상가' || usage === '토지') return 0;
  const loc = location || '';
  if (loc.includes('서울')) return 55_000_000;
  const metroOvercrowded = [
    '인천', '성남', '분당', '수원', '용인', '안양', '과천', '광명', '의왕', '군포',
    '부천', '시흥', '고양', '일산', '하남', '구리', '남양주', '의정부', '화성', '김포', '파주', '경기',
  ];
  if (metroOvercrowded.some((kw) => loc.includes(kw))) return 48_000_000;
  return 28_000_000;
}

/**
 * 경락잔금대출(주거 LTV 70% · 비주거 60%) + 지역별 방공제 + 부대비용 + 선순위 인수금 기준
 * 매각 물건의 예상 실투자금(필요 자기자본)을 원 단위로 산출한다.
 * 공매 임대 물건은 null 반환.
 */
export function estimateQuickEquity(item: FeedItem): number | null {
  if (!item || isOnbidLease(item)) return null;
  const basePrice = item.min_bid || 0;
  if (basePrice <= 0) return null;

  const isNonResidential = item.usage === '상가' || item.usage === '토지';
  const ltv = isNonResidential ? 0.6 : 0.7;
  const appraisalBase = Math.min(basePrice, item.appraisal || basePrice);
  const bang = getRegionalBangGongje(item.location, item.usage);
  const estLoan = Math.max(0, Math.floor(appraisalBase * ltv) - bang);
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
