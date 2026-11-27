import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

// 정적 피드 데이터 로드 (24시간 무단절 작동)
const feedData = require('../../assets/mobile_feed.json');

const { width } = Dimensions.get('window');

type FilterType = 'all' | 'clean' | 'budget_small' | 'budget_mid' | 'seoul' | 'gyeonggi';

export default function FeedScreen() {
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [activeFilter, setActiveFilter] = useState<FilterType>('clean');

  const items: FeedItem[] = feedData.items || [];

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeFilter === 'clean' && item.safety_grade !== 'GREEN') return false;
      if (activeFilter === 'budget_small' && item.min_bid > 300_000_000) return false;
      if (activeFilter === 'budget_mid' && (item.min_bid <= 300_000_000 || item.min_bid > 600_000_000)) return false;
      if (activeFilter === 'seoul' && !item.location.includes('서울')) return false;
      if (activeFilter === 'gyeonggi' && !item.location.includes('경기') && !item.location.includes('인천')) return false;
      return true;
    });
  }, [items, activeFilter]);

  const renderFilterChip = (type: FilterType, label: string) => {
    const isSelected = activeFilter === type;
    return (
      <TouchableOpacity
        key={type}
        style={[styles.chip, isSelected && styles.chipActive]}
        onPress={() => setActiveFilter(type)}
        activeOpacity={0.7}
      >
        <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderBadge = (grade: string) => {
    if (grade === 'GREEN') {
      return (
        <View style={[styles.badge, styles.badgeGreen]}>
          <Text style={styles.badgeTextGreen}>🟢 안심 (인수 0원)</Text>
        </View>
      );
    }
    if (grade === 'YELLOW') {
      return (
        <View style={[styles.badge, styles.badgeYellow]}>
          <Text style={styles.badgeTextYellow}>🟡 임차인 확인</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeRed]}>
        <Text style={styles.badgeTextRed}>🔴 권리 주의</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: FeedItem }) => {
    const fav = isFavorite(item.case_number);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.92}
        onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
      >
        {/* 상단 썸네일 & 뱃지 영역 */}
        <View style={styles.imageContainer}>
          <Image source={{ uri: item.photo_url }} style={styles.image} resizeMode="cover" />
          <View style={styles.badgeContainer}>{renderBadge(item.safety_grade)}</View>
          <View style={styles.dDayContainer}>
            <Text style={styles.dDayText}>{item.d_day}</Text>
          </View>
          <TouchableOpacity
            style={styles.favButton}
            onPress={() => toggleFavorite(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={{ fontSize: 22 }}>{fav ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
        </View>

        {/* 본문 카드 콘텐츠 */}
        <View style={styles.cardContent}>
          {/* 한 줄 후킹 문장 */}
          <Text style={styles.headline} numberOfLines={2}>
            {item.headline}
          </Text>

          {/* 최저가 & 할인율 큰 숫자 강조 */}
          <View style={styles.priceRow}>
            <View style={styles.priceLeft}>
              <Text style={styles.priceLabel}>최저 입찰가</Text>
              <Text style={styles.priceValue}>{item.min_bid_str}</Text>
            </View>
            {item.discount_pct > 0 && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>-{item.discount_pct}%</Text>
              </View>
            )}
          </View>

          {/* 초보자용 3줄 브리핑 불릿 */}
          <View style={styles.bulletContainer}>
            {item.summary_bullets.map((bullet, idx) => (
              <Text key={idx} style={styles.bulletText} numberOfLines={1}>
                {bullet}
              </Text>
            ))}
          </View>

          {/* 사건번호 & 법원 하단 메타 */}
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              {item.court_name || '수도권 법원'} · 사건번호 {item.case_number}
            </Text>
            <Text style={styles.detailLink}>10초 요약 보기 ›</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 칩 필터 바 */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          data={[
            { type: 'clean', label: '🟢 안심 매물만' },
            { type: 'all', label: '전체 매물' },
            { type: 'budget_small', label: '3억 이하' },
            { type: 'budget_mid', label: '3억~6억' },
            { type: 'seoul', label: '서울' },
            { type: 'gyeonggi', label: '경기·인천' },
          ]}
          keyExtractor={(i) => i.type}
          renderItem={({ item }) => renderFilterChip(item.type as FilterType, item.label)}
        />
      </View>

      {/* 카드 피드 리스트 */}
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.case_number}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={styles.emptyText}>선택하신 조건에 맞는 매물이 없습니다.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  filterBar: {
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipActive: {
    backgroundColor: '#2563eb',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  imageContainer: {
    width: '100%',
    height: 180,
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  badgeGreen: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgeTextGreen: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },
  badgeYellow: {
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  badgeTextYellow: {
    color: '#a16207',
    fontSize: 12,
    fontWeight: '700',
  },
  badgeRed: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  badgeTextRed: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
  },
  dDayContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dDayText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  favButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    padding: 18,
  },
  headline: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 24,
    marginBottom: 12,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 12,
  },
  priceLeft: {
    gap: 2,
  },
  priceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  priceValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  discountBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  discountText: {
    color: '#1d4ed8',
    fontSize: 15,
    fontWeight: '800',
  },
  bulletContainer: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    gap: 6,
    marginBottom: 12,
  },
  bulletText: {
    fontSize: 12.5,
    color: '#334155',
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  detailLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
  },
});
