import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Dimensions,
  Platform,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

// react-native-maps는 네이티브 전용이므로 웹 환경에서는 조건부 처리
let MapView: any = null;
let Marker: any = null;
if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
  } catch (e) {
    console.warn('react-native-maps not available:', e);
  }
}

const feedData = require('../../assets/mobile_feed.json');
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type FilterType = 'all' | 'clean' | 'budget_small' | 'budget_mid' | 'seoul' | 'gyeonggi';
type ViewMode = 'list' | 'card' | 'map';

const VIEW_MODE_STORAGE_KEY = 'easy_auction_view_mode';

export default function FeedScreen() {
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [selectedMapItem, setSelectedMapItem] = useState<FeedItem | null>(null);

  const cardListRef = useRef<FlatList>(null);
  const mapRef = useRef<any>(null);

  const items: FeedItem[] = feedData.items || [];

  // AsyncStorage에서 뷰 모드 취향 불러오기
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (saved === 'list' || saved === 'card' || saved === 'map') {
          setViewMode(saved);
        }
      } catch (err) {
        console.error('Failed to load viewMode:', err);
      }
    })();
  }, []);

  // 뷰 모드 변경 시 AsyncStorage 저장
  const handleViewModeChange = async (mode: ViewMode) => {
    setViewMode(mode);
    try {
      await AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch (err) {
      console.error('Failed to save viewMode:', err);
    }
  };

  // 필터링 적용된 매물 목록
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

  // 필터 변경 시 카드 인덱스 초기화 및 맵 선택 해제
  const handleFilterChange = (type: FilterType) => {
    setActiveFilter(type);
    setActiveCardIndex(0);
    setSelectedMapItem(null);
    if (cardListRef.current) {
      try {
        cardListRef.current.scrollToOffset({ offset: 0, animated: false });
      } catch (e) {}
    }
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

  // ──────────────────────────────────────────
  // 1. 리스트형 렌더러
  // ──────────────────────────────────────────
  const renderListItem = ({ item }: { item: FeedItem }) => {
    const fav = isFavorite(item.case_number);

    return (
      <TouchableOpacity
        style={styles.listCard}
        activeOpacity={0.92}
        onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
      >
        <View style={styles.listImageWrap}>
          <Image source={{ uri: item.photo_url }} style={styles.listImage} resizeMode="cover" />
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

        <View style={styles.listCardContent}>
          <Text style={styles.listHeadline} numberOfLines={2}>
            {item.headline}
          </Text>

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

          <View style={styles.bulletContainer}>
            {item.summary_bullets.map((bullet, idx) => (
              <Text key={idx} style={styles.bulletText} numberOfLines={1}>
                {bullet}
              </Text>
            ))}
          </View>

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

  // ──────────────────────────────────────────
  // 2. 카드형 (좌우 스와이프 1개씩 피드) 렌더러
  // ──────────────────────────────────────────
  const onCardScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / SCREEN_WIDTH);
    if (idx !== activeCardIndex && idx >= 0 && idx < filteredItems.length) {
      setActiveCardIndex(idx);
    }
  };

  const renderCardItem = ({ item }: { item: FeedItem }) => {
    const fav = isFavorite(item.case_number);

    return (
      <View style={styles.swipeCardPage}>
        <View style={styles.swipeCardInner}>
          {/* 큰 실물 사진 & 뱃지 */}
          <View style={styles.swipeImageWrap}>
            <Image source={{ uri: item.photo_url }} style={styles.swipeImage} resizeMode="cover" />
            <View style={styles.badgeContainer}>{renderBadge(item.safety_grade)}</View>
            <View style={styles.dDayContainer}>
              <Text style={styles.dDayText}>{item.d_day}</Text>
            </View>
            <TouchableOpacity
              style={styles.swipeFavBtn}
              onPress={() => toggleFavorite(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ fontSize: 24 }}>{fav ? '⭐' : '☆'}</Text>
            </TouchableOpacity>
          </View>

          {/* 카드 바디 */}
          <ScrollView
            style={styles.swipeCardBody}
            contentContainerStyle={styles.swipeCardBodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.swipeHeadline}>{item.headline}</Text>
            <Text style={styles.swipeLocation}>{item.location}</Text>

            {/* 가격 & 갭 배너 */}
            <View style={styles.swipePriceBox}>
              <View style={styles.priceRow}>
                <View>
                  <Text style={styles.priceLabel}>최저 입찰가</Text>
                  <Text style={styles.swipePriceValue}>{item.min_bid_str}</Text>
                </View>
                {item.discount_pct > 0 && (
                  <View style={styles.discountBadge}>
                    <Text style={styles.discountText}>-{item.discount_pct}%</Text>
                  </View>
                )}
              </View>
              <View style={styles.swipeGapPill}>
                <Text style={styles.swipeGapPillText}>
                  {item.ref_price_name} 대비 약 {item.gap_amount_str} 저렴
                </Text>
              </View>
            </View>

            {/* 3줄 안심 요약 */}
            <View style={styles.swipeBulletBox}>
              <Text style={styles.swipeBulletTitle}>🛡️ 핵심 브리핑 3줄</Text>
              {item.summary_bullets.map((b, idx) => (
                <View key={idx} style={styles.swipeBulletItem}>
                  <Text style={styles.swipeBulletNum}>{idx + 1}</Text>
                  <Text style={styles.swipeBulletTxt}>{b}</Text>
                </View>
              ))}
            </View>

            {/* 법원 및 사건번호 */}
            <Text style={styles.swipeMetaText}>
              {item.court_name || '수도권 관할 법원'} · 사건번호 {item.case_number}
            </Text>
          </ScrollView>

          {/* 하단 상세 바로가기 액션 버튼 */}
          <TouchableOpacity
            style={styles.swipeDetailActionBtn}
            activeOpacity={0.85}
            onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
          >
            <Text style={styles.swipeDetailActionText}>10초 요약 브리핑 상세 보기 ›</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ──────────────────────────────────────────
  // 3. 지도형 렌더러
  // ──────────────────────────────────────────
  const mapItems = useMemo(() => {
    return filteredItems.filter((i) => i.lat && i.lng && typeof i.lat === 'number' && typeof i.lng === 'number');
  }, [filteredItems]);

  const renderMapView = () => {
    if (Platform.OS === 'web' || !MapView) {
      return (
        <View style={styles.webMapFallback}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>🗺️</Text>
          <Text style={styles.webMapTitle}>지도 보기 모드</Text>
          <Text style={styles.webMapSubtitle}>
            모바일 기기(iOS/Android) 환경에서 네이티브 지도로 최적화 표시됩니다.
          </Text>
          <Text style={styles.webMapInfo}>
            현재 필터 기준 지도 표시 가능 매물: {mapItems.length}건
          </Text>
          <TouchableOpacity style={styles.webSwitchListBtn} onPress={() => setViewMode('list')}>
            <Text style={styles.webSwitchListText}>리스트 모드로 매물 보기</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // 수도권 기본 중앙 좌표
    const initialRegion = {
      latitude: 37.545,
      longitude: 126.985,
      latitudeDelta: 0.38,
      longitudeDelta: 0.38,
    };

    return (
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.mapView}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsCompass={true}
          toolbarEnabled={false}
        >
          {mapItems.map((item) => {
            const isSelected = selectedMapItem?.case_number === item.case_number;
            const markerColor =
              item.safety_grade === 'GREEN' ? '#10b981' : item.safety_grade === 'YELLOW' ? '#f59e0b' : '#ef4444';

            return (
              <Marker
                key={item.case_number}
                coordinate={{ latitude: item.lat!, longitude: item.lng! }}
                onPress={() => setSelectedMapItem(item)}
              >
                <View style={[styles.customMarker, isSelected && styles.customMarkerSelected]}>
                  <View style={[styles.markerDot, { backgroundColor: markerColor }]} />
                  <Text style={styles.markerText}>{item.min_bid_str.replace(' ', '')}</Text>
                </View>
              </Marker>
            );
          })}
        </MapView>

        {/* 선택된 매물 하단 요약 플로팅 카드 */}
        {selectedMapItem && (
          <View style={styles.mapFloatingCardWrap}>
            <TouchableOpacity
              style={styles.mapFloatingCard}
              activeOpacity={0.9}
              onPress={() => router.push(`/detail/${encodeURIComponent(selectedMapItem.case_number)}`)}
            >
              <Image source={{ uri: selectedMapItem.photo_url }} style={styles.mapCardThumb} resizeMode="cover" />
              <View style={styles.mapCardDetails}>
                <View style={styles.mapCardBadgeRow}>
                  {renderBadge(selectedMapItem.safety_grade)}
                  <Text style={styles.mapCardDDay}>{selectedMapItem.d_day}</Text>
                </View>
                <Text style={styles.mapCardHeadline} numberOfLines={1}>
                  {selectedMapItem.headline}
                </Text>
                <View style={styles.mapCardPriceRow}>
                  <Text style={styles.mapCardPrice}>{selectedMapItem.min_bid_str}</Text>
                  {selectedMapItem.discount_pct > 0 && (
                    <Text style={styles.mapCardDiscount}>-{selectedMapItem.discount_pct}%</Text>
                  )}
                </View>
                <Text style={styles.mapCardHint}>상세 보기 ›</Text>
              </View>
              <TouchableOpacity
                style={styles.mapCardCloseBtn}
                onPress={() => setSelectedMapItem(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.mapCardCloseText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 1. 상단 보기 모드 세그먼트 토글 ([리스트 | 카드 | 지도]) */}
      <View style={styles.modeToggleBar}>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segmentBtn, viewMode === 'list' && styles.segmentBtnActive]}
            onPress={() => handleViewModeChange('list')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, viewMode === 'list' && styles.segmentTextActive]}>
              📋 리스트
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, viewMode === 'card' && styles.segmentBtnActive]}
            onPress={() => handleViewModeChange('card')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, viewMode === 'card' && styles.segmentTextActive]}>
              🃏 카드
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, viewMode === 'map' && styles.segmentBtnActive]}
            onPress={() => handleViewModeChange('map')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, viewMode === 'map' && styles.segmentTextActive]}>
              🗺️ 지도
            </Text>
          </TouchableOpacity>
        </View>

        {/* 카드 뷰일 때 위치 인디케이터 표시 */}
        {viewMode === 'card' && filteredItems.length > 0 && (
          <View style={styles.cardCounterPill}>
            <Text style={styles.cardCounterText}>
              {activeCardIndex + 1} / {filteredItems.length}
            </Text>
          </View>
        )}
      </View>

      {/* 2. 상단 칩 필터 바 (3가지 뷰 공통 연동) */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          data={[
            { type: 'all', label: '전체 매물' },
            { type: 'clean', label: '🟢 안심만' },
            { type: 'budget_small', label: '3억 이하' },
            { type: 'budget_mid', label: '3억~6억' },
            { type: 'seoul', label: '서울' },
            { type: 'gyeonggi', label: '경기·인천' },
          ]}
          keyExtractor={(i) => i.type}
          renderItem={({ item }) => {
            const isSelected = activeFilter === item.type;
            return (
              <TouchableOpacity
                style={[styles.chip, isSelected && styles.chipActive]}
                onPress={() => handleFilterChange(item.type as FilterType)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* 3. 메인 콘텐츠 (뷰 모드별 분기) */}
      {viewMode === 'list' && (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.case_number}
          renderItem={renderListItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
              <Text style={styles.emptyText}>선택하신 조건에 맞는 매물이 없습니다.</Text>
            </View>
          }
        />
      )}

      {viewMode === 'card' && (
        <FlatList
          ref={cardListRef}
          data={filteredItems}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onCardScroll}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.case_number}
          renderItem={renderCardItem}
          style={styles.cardSwipeContainer}
          ListEmptyComponent={
            <View style={[styles.emptyContainer, { width: SCREEN_WIDTH }]}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
              <Text style={styles.emptyText}>선택하신 조건에 맞는 매물이 없습니다.</Text>
            </View>
          }
        />
      )}

      {viewMode === 'map' && renderMapView()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  // 상단 보기 모드 세그먼트 토글 스타일
  modeToggleBar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 3,
    flex: 1,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#0f172a',
    fontWeight: '800',
  },
  cardCounterPill: {
    marginLeft: 12,
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  cardCounterText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1d4ed8',
  },

  // 필터 칩 스타일
  filterBar: {
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
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
    fontWeight: '800',
  },

  // 1. 리스트형 스타일
  listContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  listCard: {
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
  listImageWrap: {
    width: '100%',
    height: 180,
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  listImage: {
    width: '100%',
    height: '100%',
  },
  listCardContent: {
    padding: 16,
    gap: 10,
  },
  listHeadline: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 24,
  },

  // 공통 뱃지 & 가격
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
    fontWeight: '800',
  },
  badgeYellow: {
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  badgeTextYellow: {
    color: '#a16207',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeRed: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  badgeTextRed: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '800',
  },
  dDayContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dDayText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  favButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  priceLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  priceLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  discountBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  discountText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '800',
  },
  bulletContainer: {
    gap: 4,
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 12,
  },
  bulletText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  footerText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  detailLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
  },

  // 2. 카드형 스타일 (화면 1개씩 카드 피드)
  cardSwipeContainer: {
    flex: 1,
  },
  swipeCardPage: {
    width: SCREEN_WIDTH,
    padding: 16,
    justifyContent: 'center',
  },
  swipeCardInner: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    maxHeight: '96%',
  },
  swipeImageWrap: {
    width: '100%',
    height: 220,
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  swipeImage: {
    width: '100%',
    height: '100%',
  },
  swipeFavBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 22,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeCardBody: {
    maxHeight: 280,
  },
  swipeCardBodyContent: {
    padding: 18,
    gap: 12,
  },
  swipeHeadline: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 26,
  },
  swipeLocation: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: -6,
  },
  swipePriceBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  swipePriceValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  swipeGapPill: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  swipeGapPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  swipeBulletBox: {
    gap: 8,
  },
  swipeBulletTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
  },
  swipeBulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  swipeBulletNum: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#eff6ff',
    color: '#2563eb',
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 11,
    fontWeight: '800',
  },
  swipeBulletTxt: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  swipeMetaText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
  },
  swipeDetailActionBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  swipeDetailActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },

  // 3. 지도형 스타일
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  mapView: {
    width: '100%',
    height: '100%',
  },
  customMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  customMarkerSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
    transform: [{ scale: 1.08 }],
  },
  markerDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  markerText: {
    fontSize: 11.5,
    fontWeight: '900',
    color: '#0f172a',
  },
  mapFloatingCardWrap: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
  },
  mapFloatingCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  mapCardThumb: {
    width: 80,
    height: 80,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  mapCardDetails: {
    flex: 1,
    gap: 3,
  },
  mapCardBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapCardDDay: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  mapCardHeadline: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  mapCardPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  mapCardPrice: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  mapCardDiscount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#dc2626',
  },
  mapCardHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  mapCardCloseBtn: {
    alignSelf: 'flex-start',
    padding: 6,
  },
  mapCardCloseText: {
    fontSize: 16,
    color: '#94a3b8',
    fontWeight: '700',
  },

  webMapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  webMapTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  webMapSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  webMapInfo: {
    fontSize: 13,
    color: '#1d4ed8',
    fontWeight: '700',
    marginBottom: 20,
  },
  webSwitchListBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
  },
  webSwitchListText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 15,
    color: '#64748b',
    fontWeight: '600',
  },
});
