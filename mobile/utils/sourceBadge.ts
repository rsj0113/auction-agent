import { FeedItem, SourceType } from '../types/feed';

export interface SourceBadgeMeta {
  type: SourceType;
  label: string;
  shortLabel: string;
  bg: string;
  border: string;
  text: string;
}

export function getSourceType(item?: Pick<FeedItem, 'source_type' | 'disposal_method' | 'case_number'> | null): SourceType {
  if (!item) return 'auction';
  if (item.source_type === 'onbid_sale' || item.source_type === 'onbid_lease' || item.source_type === 'auction') {
    return item.source_type;
  }
  if ((item.case_number || '').startsWith('ONBID-')) {
    return item.disposal_method === '임대' ? 'onbid_lease' : 'onbid_sale';
  }
  return 'auction';
}

export function isOnbidLease(item?: Pick<FeedItem, 'source_type' | 'disposal_method' | 'case_number'> | null): boolean {
  return getSourceType(item) === 'onbid_lease';
}

export function isOnbidItem(item?: Pick<FeedItem, 'source_type' | 'disposal_method' | 'case_number'> | null): boolean {
  const t = getSourceType(item);
  return t === 'onbid_sale' || t === 'onbid_lease';
}

export function getSourceBadgeMeta(item?: Pick<FeedItem, 'source_type' | 'disposal_method' | 'case_number'> | null): SourceBadgeMeta {
  const type = getSourceType(item);
  if (type === 'onbid_sale') {
    return {
      type,
      label: '[공매 · 매각]',
      shortLabel: '공매 · 매각',
      bg: '#F5F3FF',
      border: '#DDD6FE',
      text: '#6D28D9',
    };
  }
  if (type === 'onbid_lease') {
    return {
      type,
      label: '[공매 · 임대]',
      shortLabel: '공매 · 임대',
      bg: '#ECFDF5',
      border: '#A7F3D0',
      text: '#047857',
    };
  }
  return {
    type: 'auction',
    label: '[경매]',
    shortLabel: '경매',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    text: '#1D4ED8',
  };
}
