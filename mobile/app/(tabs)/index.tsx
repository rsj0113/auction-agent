import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Platform,
  Modal,
  Pressable,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

// react-native-maps는 네이티브 전용이므로 웹 환경에서는 조건부 로드
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

type FilterType = 'all' | 'clean' | 'budget_small' | 'budget_mid' | 'seoul' | 'gyeonggi';
type ViewMode = 'list' | 'card' | 'map';

const VIEW_MODE_STORAGE_KEY = 'easy_auction_view_mode';

const VIEW_MODE_OPTIONS: {
  mode: ViewMode;
  icon: string;
  title: string;
  desc: string;
  badge?: string;
}[] = [
  {
    mode: 'card',
    icon: '🃏',
    title: '카드형으로 떠먹기',
    desc: '큰 사진과 핵심 숫자만 한 장씩 슥슥 넘겨보기',
    badge: '추천',
  },
  {
    mode: 'list',
    icon: '📋',
    title: '리스트로 한눈에',
    desc: '여러 경매 물건을 세로 목록으로 빠르게 비교하기',
  },
  {
    mode: 'map',
    icon: '🗺️',
    title: '지도로 동네 찾기',
    desc: '지도 위 가격 핀으로 관심 동네 물건 탐색하기',
  },
];

export default function FeedScreen() {
  const router = useRouter();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [isModeLoaded, setIsModeLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [selectedMapItem, setSelectedMapItem] = useState<FeedItem | null>(null);

  const cardListRef = useRef<FlatList<FeedItem>>(null);
  const mapRef = useRef<any>(null);

  const items: FeedItem[] = feedData.items || [];

  // AsyncStorage에서 저장된 보기 모드 확인 (없으면 첫 진입 온보딩 표시)
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (saved === 'list' || saved === 'card' || saved === 'map') {
          setViewMode(saved);
          setShowOnboarding(false);
        } else {
          setShowOnboarding(true);
        }
      } catch (err) {
        console.error('Failed to load viewMode:', err);
        setShowOnboarding(true);
      } finally {
        setIsModeLoaded(true);
      }
    })();
  }, []);

  // 보기 모드 선택 및 영구 저장
  const handleSelectViewMode = async (mode: ViewMode) => {
    setViewMode(mode);
    setShowOnboarding(false);
    setMenuVisible(false);
    setActiveCardIndex(0);
    setSelectedMapItem(null);
    try {
      await AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch (err) {
      console.error('Failed to save viewMode:', err);
    }
  };

  // 필터링 적용된 매물 목록 (3가지 뷰 모두 공통 연동)
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

  const renderBadge = (grade: string, compact = false) => {
    if (grade === 'GREEN') {
      return (
        <View style={[styles.badge, styles.badgeGreen]}>
          <Text style={styles.badgeTextGreen}>{compact ? '🟢 안심' : '🟢 안심 · 인수금 0원'}</Text>
        </View>
      );
    }
    if (grade === 'YELLOW') {
      return (
        <View style={[styles.badge, styles.badgeYellow]}>
          <Text style={styles.badgeTextYellow}>{compact ? '🟡 확인' : '🟡 세입자 확인'}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeRed]}>
        <Text style={styles.badgeTextRed}>{compact ? '🔴 주의' : '🔴 특수조건 주의'}</Text>
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
            <Text style={{ fontSize: 20 }}>{fav ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listCardContent}>
          <Text style={styles.listHeadline} numberOfLines={2}>
            {item.headline}
          </Text>

          <View style={styles.priceRow}>
            <View style={styles.priceLeft}>
              <Text style={styles.priceLabel}>최저가</Text>
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
            <Text style={styles.footerText}>{item.short_location} · {item.usage}</Text>
            <Text style={styles.detailLink}>자세히 떠먹기 ›</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ──────────────────────────────────────────
  // 2. 카드형 (토스·인스타 카드뉴스 심플 UI)
  // ──────────────────────────────────────────
  const onCardScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / winWidth);
    if (idx !== activeCardIndex && idx >= 0 && idx < filteredItems.length) {
      setActiveCardIndex(idx);
    }
  };

  const goToCardIndex = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= filteredItems.length) return;
    setActiveCardIndex(nextIdx);
    if (cardListRef.current) {
      try {
        cardListRef.current.scrollToOffset({ offset: nextIdx * winWidth, animated: true });
      } catch (e) {}
    }
  };

  const cardMaxWidth = Math.min(winWidth - 32, 430);
  const cardPhotoHeight = Math.max(210, Math.min(winHeight * 0.36, 310));

  const renderCardItem = ({ item }: { item: FeedItem }) => {
    const fav = isFavorite(item.case_number);
    const gapShort = item.gap_short_str || item.gap_amount_str;
    const tags =
      item.card_tags && item.card_tags.length > 0
        ? item.card_tags.slice(0, 3)
        : [
            item.safety_grade === 'GREEN'
              ? '추가 인수금 0원'
              : item.safety_grade === 'YELLOW'
              ? '세입자·관리비 확인'
              : '특수조건 확인 필수',
            `📍 ${item.short_location}`,
            `보증금 ${item.deposit_required_str}`,
          ];

    return (
      <View style={[styles.storyPage, { width: winWidth }]}>
        <TouchableOpacity
          style={[styles.storyCard, { width: cardMaxWidth }]}
          activeOpacity={0.96}
          onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
        >
          {/* 상단 큰 실물 사진 */}
          <View style={[styles.storyPhotoWrap, { height: cardPhotoHeight }]}>
            <Image source={{ uri: item.photo_url }} style={styles.storyPhoto} resizeMode="cover" />

            {/* 좌상단 신호등 배지 */}
            <View style={styles.storyTopLeft}>{renderBadge(item.safety_grade, true)}</View>

            {/* 우상단 찜 버튼 */}
            <TouchableOpacity
              style={styles.storyFavBtn}
              onPress={() => toggleFavorite(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ fontSize: 22 }}>{fav ? '⭐' : '☆'}</Text>
            </TouchableOpacity>

            {/* 좌하단 D-Day */}
            <View style={styles.storyBottomLeft}>
              <Text style={styles.storyDDayText}>{item.d_day}</Text>
            </View>
          </View>

          {/* 하단 여백 넉넉한 심플 핵심 영역 */}
          <View style={styles.storyBody}>
            {/* 굵은 한 줄 훅 */}
            <Text style={styles.storyHook} numberOfLines={2}>
              {item.headline}
            </Text>

            {/* 시선 꽂히는 큰 숫자 (최저가 + 시세차익) */}
            <View style={styles.storyPriceBlock}>
              <Text style={styles.storyBigPrice}>{item.min_bid_str}</Text>
              <View style={styles.storyGapRow}>
                {item.discount_pct > 0 && (
                  <View style={styles.storyPctPill}>
                    <Text style={styles.storyPctText}>-{item.discount_pct}%</Text>
                  </View>
                )}
                {item.gap_amount > 0 && (
                  <View style={styles.storyGapPill}>
                    <Text style={styles.storyGapText}>
                      {item.ref_price_name === '최근 실거래가' ? '시세' : '감정가'}보다 {gapShort} 저렴
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* 핵심 배지 2~3개만 깔끔하게 */}
            <View style={styles.storyTagsRow}>
              {tags.map((tag, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.storyTagPill,
                    idx === 0 && item.safety_grade === 'GREEN' && styles.storyTagPillGreen,
                    idx === 0 && item.safety_grade === 'RED' && styles.storyTagPillRed,
                  ]}
                >
                  <Text
                    style={[
                      styles.storyTagText,
                      idx === 0 && item.safety_grade === 'GREEN' && styles.storyTagTextGreen,
                      idx === 0 && item.safety_grade === 'RED' && styles.storyTagTextRed,
                    ]}
                  >
                    {tag}
                  </Text>
                </View>
              ))}
            </View>

            {/* 토스 스타일 CTA 버튼 */}
            <TouchableOpacity
              style={styles.storyCtaBtn}
              activeOpacity={0.85}
              onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
            >
              <Text style={styles.storyCtaText}>자세히 떠먹기 →</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // ──────────────────────────────────────────
  // 3. 지도형 렌더러
  // ──────────────────────────────────────────
  const mapItems = useMemo(() => {
    return filteredItems.filter(
      (i) => i.lat && i.lng && typeof i.lat === 'number' && typeof i.lng === 'number'
    );
  }, [filteredItems]);

  const renderMapView = () => {
    if (Platform.OS === 'web' || !MapView) {
      return (
        <View style={styles.webMapFallback}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🗺️</Text>
          <Text style={styles.webMapTitle}>지도 보기는 모바일 앱에서 최적화돼요</Text>
          <Text style={styles.webMapSubtitle}>
            웹 브라우저에서는 카드형이나 리스트형으로 바로 떠먹어 보세요!{'\n'}
            (현재 조건 지도 매물: {mapItems.length}건)
          </Text>
          <View style={styles.webMapActionRow}>
            <TouchableOpacity
              style={styles.webSwitchPrimaryBtn}
              onPress={() => handleSelectViewMode('card')}
            >
              <Text style={styles.webSwitchPrimaryText}>🃏 카드로 떠먹기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.webSwitchSecondaryBtn}
              onPress={() => handleSelectViewMode('list')}
            >
              <Text style={styles.webSwitchSecondaryText}>📋 리스트로 보기</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

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
              item.safety_grade === 'GREEN'
                ? '#10b981'
                : item.safety_grade === 'YELLOW'
                ? '#f59e0b'
                : '#ef4444';

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

        {selectedMapItem && (
          <View style={styles.mapFloatingCardWrap}>
            <TouchableOpacity
              style={styles.mapFloatingCard}
              activeOpacity={0.9}
              onPress={() => router.push(`/detail/${encodeURIComponent(selectedMapItem.case_number)}`)}
            >
              <Image
                source={{ uri: selectedMapItem.photo_url }}
                style={styles.mapCardThumb}
                resizeMode="cover"
              />
              <View style={styles.mapCardDetails}>
                <View style={styles.mapCardBadgeRow}>
                  {renderBadge(selectedMapItem.safety_grade, true)}
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
                <Text style={styles.mapCardHint}>자세히 떠먹기 ›</Text>
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

  // ──────────────────────────────────────────
  // 4. 첫 진입 보기 모드 선택 화면 (저장값 없을 때)
  // ──────────────────────────────────────────
  if (isModeLoaded && showOnboarding) {
    return (
      <SafeAreaView style={styles.onboardingContainer}>
        <View style={styles.onboardingInner}>
          <View style={styles.onboardingBrandBox}>
            <Text style={styles.onboardingBrandTitle}>이지경매</Text>
            <Text style={styles.onboardingBrandSub}>경매 물건 떠먹기</Text>
          </View>

          <View style={styles.onboardingTitleBox}>
            <Text style={styles.onboardingHeadline}>어떤 방식으로 볼까요?</Text>
            <Text style={styles.onboardingHint}>
              언제든 우측 상단 ☰ 메뉴에서 바꿀 수 있어요
            </Text>
          </View>

          <View style={styles.onboardingOptions}>
            {VIEW_MODE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.mode}
                style={[
                  styles.onboardingCardBtn,
                  opt.mode === 'card' && styles.onboardingCardBtnFeatured,
                ]}
                activeOpacity={0.85}
                onPress={() => handleSelectViewMode(opt.mode)}
              >
                <View style={styles.onboardingIconWrap}>
                  <Text style={{ fontSize: 28 }}>{opt.icon}</Text>
                </View>
                <View style={styles.onboardingTextWrap}>
                  <View style={styles.onboardingRowTitle}>
                    <Text style={styles.onboardingOptTitle}>{opt.title}</Text>
                    {opt.badge && (
                      <View style={styles.recommendPill}>
                        <Text style={styles.recommendPillText}>{opt.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.onboardingOptDesc}>{opt.desc}</Text>
                </View>
                <Text style={styles.onboardingArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 1. 브랜드 헤더 ("이지경매" / 부제 "경매 물건 떠먹기") + 우측 ☰ 메뉴 */}
      <View style={styles.brandHeader}>
        <View style={styles.brandTitleWrap}>
          <Text style={styles.brandTitle}>이지경매</Text>
          <Text style={styles.brandSubtitle}>경매 물건 떠먹기</Text>
        </View>

        <View style={styles.headerRight}>
          {viewMode === 'card' && filteredItems.length > 0 && (
            <View style={styles.cardCounterPill}>
              <Text style={styles.cardCounterText}>
                {activeCardIndex + 1} / {filteredItems.length}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.75}
            accessibilityLabel="보기 모드 메뉴 열기"
          >
            <Text style={styles.menuButtonIcon}>☰</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 상단 칩 필터 바 (리스트 · 카드 · 지도 3개 뷰 모두 연동) */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          data={[
            { type: 'all', label: '전체' },
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

      {/* 3. 메인 콘텐츠 (선택된 보기 모드에 따라 렌더링) */}
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
              <Text style={styles.emptyText}>조건에 맞는 경매 물건이 아직 없어요.</Text>
            </View>
          }
        />
      )}

      {viewMode === 'card' && (
        <View style={styles.cardModeWrap}>
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
              <View style={[styles.emptyContainer, { width: winWidth }]}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
                <Text style={styles.emptyText}>조건에 맞는 경매 물건이 아직 없어요.</Text>
              </View>
            }
          />

          {/* 하단 스와이프 보조 네비게이션 (모바일 스와이프 + 웹 클릭 호환) */}
          {filteredItems.length > 1 && (
            <View style={styles.cardNavBar}>
              <TouchableOpacity
                style={[styles.cardNavBtn, activeCardIndex === 0 && styles.cardNavBtnDisabled]}
                onPress={() => goToCardIndex(activeCardIndex - 1)}
                disabled={activeCardIndex === 0}
              >
                <Text
                  style={[
                    styles.cardNavBtnText,
                    activeCardIndex === 0 && styles.cardNavBtnTextDisabled,
                  ]}
                >
                  ‹ 이전
                </Text>
              </TouchableOpacity>

              <Text style={styles.cardNavHint}>좌우로 넘겨서 떠먹기</Text>

              <TouchableOpacity
                style={[
                  styles.cardNavBtn,
                  activeCardIndex >= filteredItems.length - 1 && styles.cardNavBtnDisabled,
                ]}
                onPress={() => goToCardIndex(activeCardIndex + 1)}
                disabled={activeCardIndex >= filteredItems.length - 1}
              >
                <Text
                  style={[
                    styles.cardNavBtnText,
                    activeCardIndex >= filteredItems.length - 1 && styles.cardNavBtnTextDisabled,
                  ]}
                >
                  다음 ›
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {viewMode === 'map' && renderMapView()}

      {/* 4. 우측 상단 ☰ 삼선 메뉴 → 보기 방식 전환 바텀시트 모달 */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.bottomSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>보기 방식 바꾸기</Text>
                <Text style={styles.sheetSub}>선택한 방식은 다음에도 기억해 둬요</Text>
              </View>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setMenuVisible(false)}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sheetOptions}>
              {VIEW_MODE_OPTIONS.map((opt) => {
                const active = viewMode === opt.mode;
                return (
                  <TouchableOpacity
                    key={opt.mode}
                    style={[styles.sheetOptionCard, active && styles.sheetOptionCardActive]}
                    activeOpacity={0.8}
                    onPress={() => handleSelectViewMode(opt.mode)}
                  >
                    <Text style={{ fontSize: 24 }}>{opt.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.onboardingRowTitle}>
                        <Text
                          style={[
                            styles.sheetOptTitle,
                            active && styles.sheetOptTitleActive,
                          ]}
                        >
                          {opt.title}
                        </Text>
                      </View>
                      <Text style={styles.sheetOptDesc}>{opt.desc}</Text>
                    </View>
                    {active && (
                      <View style={styles.activeCheckPill}>
                        <Text style={styles.activeCheckText}>선택됨 ✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  // ── 브랜드 헤더 ──
  brandHeader: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 14 : 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandTitleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardCounterPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  cardCounterText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 22,
  },

  // ── 첫 진입 온보딩 화면 ──
  onboardingContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onboardingInner: {
    width: '100%',
    maxWidth: 440,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 28,
  },
  onboardingBrandBox: {
    gap: 4,
  },
  onboardingBrandTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#2563eb',
    letterSpacing: -0.6,
  },
  onboardingBrandSub: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  onboardingTitleBox: {
    gap: 6,
  },
  onboardingHeadline: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  onboardingHint: {
    fontSize: 14,
    color: '#64748b',
  },
  onboardingOptions: {
    gap: 14,
  },
  onboardingCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  onboardingCardBtnFeatured: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  onboardingIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  onboardingTextWrap: {
    flex: 1,
    gap: 4,
  },
  onboardingRowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onboardingOptTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  onboardingOptDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  recommendPill: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  recommendPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  onboardingArrow: {
    fontSize: 22,
    color: '#94a3b8',
    fontWeight: '600',
  },

  // ── 우측 상단 ☰ 메뉴 바텀시트 ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bottomSheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 34,
    gap: 18,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0f172a',
  },
  sheetSub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: {
    fontSize: 15,
    color: '#475569',
    fontWeight: '700',
  },
  sheetOptions: {
    gap: 10,
  },
  sheetOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  sheetOptionCardActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  sheetOptTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  sheetOptTitleActive: {
    color: '#1d4ed8',
  },
  sheetOptDesc: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 2,
  },
  activeCheckPill: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  activeCheckText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },

  // ── 상단 칩 필터 ──
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
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipActive: {
    backgroundColor: '#0f172a',
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

  // ── 1. 리스트형 스타일 ──
  listContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  listCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  listImageWrap: {
    width: '100%',
    height: 185,
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

  // ── 공통 배지/가격 ──
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
    backgroundColor: 'rgba(236, 253, 245, 0.96)',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgeTextGreen: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeYellow: {
    backgroundColor: 'rgba(254, 252, 232, 0.96)',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  badgeTextYellow: {
    color: '#a16207',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeRed: {
    backgroundColor: 'rgba(254, 242, 242, 0.96)',
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
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 9,
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
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 18,
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
    fontSize: 21,
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
    gap: 5,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 14,
  },
  bulletText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  footerText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  detailLink: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563eb',
  },

  // ── 2. 카드형 (토스·인스타 카드뉴스 심플 리디자인) ──
  cardModeWrap: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  cardSwipeContainer: {
    flex: 1,
  },
  storyPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  storyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 6,
  },
  storyPhotoWrap: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#cbd5e1',
  },
  storyPhoto: {
    width: '100%',
    height: '100%',
  },
  storyTopLeft: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  storyFavBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  storyBottomLeft: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  storyDDayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  storyBody: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    gap: 16,
  },
  storyHook: {
    fontSize: 21,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  storyPriceBlock: {
    gap: 8,
  },
  storyBigPrice: {
    fontSize: 30,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.8,
  },
  storyGapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  storyPctPill: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  storyPctText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  storyGapPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  storyGapText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '800',
  },
  storyTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  storyTagPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
  },
  storyTagPillGreen: {
    backgroundColor: '#ecfdf5',
  },
  storyTagPillRed: {
    backgroundColor: '#fef2f2',
  },
  storyTagText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  storyTagTextGreen: {
    color: '#047857',
  },
  storyTagTextRed: {
    color: '#b91c1c',
  },
  storyCtaBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  storyCtaText: {
    color: '#ffffff',
    fontSize: 15.5,
    fontWeight: '800',
  },
  cardNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 12,
    paddingTop: 2,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  cardNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardNavBtnDisabled: {
    opacity: 0.4,
  },
  cardNavBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardNavBtnTextDisabled: {
    color: '#94a3b8',
  },
  cardNavHint: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },

  // ── 3. 지도형 스타일 ──
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
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  webMapSubtitle: {
    fontSize: 13.5,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  webMapActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  webSwitchPrimaryBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
  },
  webSwitchPrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  webSwitchSecondaryBtn: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  webSwitchSecondaryText: {
    color: '#334155',
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
