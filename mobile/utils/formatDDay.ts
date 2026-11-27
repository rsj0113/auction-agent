/**
 * 경매 기일/마감 라벨을 일관된 자연어 표기로 정규화한다.
 * - 오늘 마감: '오늘 마감'
 * - 다가오는 기일: '마감 N일 전' (예: 'D-9' -> '마감 9일 전')
 * - 기일 경과(차기 기일 지정 대기): '차기 기일 대기'
 */
export function formatDDayLabel(dDay?: string | null): string {
  const raw = (dDay || '').trim();
  if (!raw) return '기일 미정';

  if (raw === '오늘 마감' || /^D-Day/i.test(raw) || /^D-0$/i.test(raw)) {
    return '오늘 마감';
  }

  const dMinusMatch = raw.match(/^D-(\d+)$/i);
  if (dMinusMatch) {
    const n = parseInt(dMinusMatch[1], 10);
    return n <= 0 ? '오늘 마감' : `마감 ${n}일 전`;
  }

  // 기존 캐시(찜 목록 등)에 남아 있을 수 있는 'N일 전 마감' / 'N일전 마감' 표기 방어
  if (/^\d+\s*일\s*전\s*마감$/.test(raw)) {
    return '차기 기일 대기';
  }

  return raw;
}
