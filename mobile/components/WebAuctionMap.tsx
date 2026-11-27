import React from 'react';
import { FeedItem } from '../types/feed';

export interface WebAuctionMapProps {
  items: FeedItem[];
  selectedCaseNumber: string | null;
  onSelectItem: (item: FeedItem | null) => void;
}

// 네이티브(iOS/Android)에서는 index.tsx의 react-native-maps를 사용하므로 스텁 반환
export default function WebAuctionMap(_props: WebAuctionMapProps) {
  return null;
}
