import { FeedItem } from '../types/feed';
import { formatDDayLabel } from './formatDDay';
import { isOnbidLease } from './sourceBadge';

/**
 * '오늘의 추천' TOP N 큐레이션 점수 산출 (매각 전용: 법원경매 + 공매 매각 · 임대 제외)
 * 홈('오늘의 추천')과 상세 화면('무료 맛보기 상위 2건' 판정)이 동일한 기준을 공유한다.
 */
export function buildCuratedTopItems(allItems: FeedItem[], targetCount = 12): FeedItem[] {
  const saleOnly = allItems.filter((item) => !isOnbidLease(item));
  const scored = saleOnly.map((item) => {
    let score = 0;
    const p = item.photo_url || '';
    const isCourtPhoto = p.includes('/photos/') && !p.includes('_sv.jpg');
    const isStreetView = p.includes('_sv.jpg');

    if (isCourtPhoto) score += 45;
    else if (isStreetView) score += 25;

    if (item.safety_grade === 'GREEN') score += 38;
    else if (item.safety_grade === 'YELLOW') score += 16;
    else score += 5;

    if (item.usage === '아파트' || item.usage === '오피스텔') score += 18;
    else if (item.usage === '빌라') score += 12;
    else if (item.usage === '상가') score += 6;

    score += Math.min(item.discount_pct || 0, 50) * 0.6;
    score += (item.ai_analysis?.score || 0) * 0.2;

    if (item.min_bid >= 100_000_000 && item.min_bid <= 700_000_000) score += 8;

    // 다가오는 실매각 기일(오늘 마감 / 마감 N일 전) 매물을 오늘의 추천에 최우선 노출
    const dLabel = formatDDayLabel(item.d_day);
    if (dLabel === '오늘 마감' || dLabel.startsWith('마감 ')) score += 45;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 지역 편중 방지를 위해 같은 시군구 최대 3건까지만 우선 선택
  const picked: FeedItem[] = [];
  const regionCounts: Record<string, number> = {};

  for (const { item } of scored) {
    const regionKey = (item.short_location || '').split(' ').slice(0, 2).join(' ');
    const cnt = regionCounts[regionKey] || 0;
    if (cnt >= 3) continue;
    picked.push(item);
    regionCounts[regionKey] = cnt + 1;
    if (picked.length >= targetCount) break;
  }

  // 혹시 부족하면 남은 상위 매물로 채움
  if (picked.length < targetCount) {
    const pickedIds = new Set(picked.map((i) => i.case_number));
    for (const { item } of scored) {
      if (!pickedIds.has(item.case_number)) {
        picked.push(item);
        if (picked.length >= targetCount) break;
      }
    }
  }

  return picked;
}

/**
 * 오늘의 추천 상위 2건(index 0, 1)은 초대 코드 없이 무료 맛보기로 전체 공개
 */
export function isFreePreviewCase(allItems: FeedItem[], caseNumber: string): boolean {
  const topTwo = buildCuratedTopItems(allItems, 2);
  return topTwo.some((it) => it.case_number === caseNumber);
}
