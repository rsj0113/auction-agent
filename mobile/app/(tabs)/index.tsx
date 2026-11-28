import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Modal,
  Pressable,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';
import WebAuctionMap from '../../components/WebAuctionMap';
import { formatDDayLabel } from '../../utils/formatDDay';
import { getSourceBadgeMeta, getSourceType, isOnbidLease } from '../../utils/sourceBadge';
import { buildCuratedTopItems } from '../../utils/curation';

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

type FilterType =
  | 'all'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'budget_small'
  | 'budget_mid'
  | 'seoul'
  | 'gyeonggi';
type SourceFilterType = 'sale_all' | 'auction' | 'onbid_sale' | 'onbid_lease';
type UsageFilterType = 'all' | '아파트' | '빌라' | '오피스텔' | '상가' | '토지';
type ViewMode = 'list' | 'card' | 'map';
type InfoModalType = 'notice' | 'guide' | null;

interface WeatherState {
  temp: number;
  icon: string;
}

const OPEN_METEO_SEOUL_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,weather_code&timezone=Asia/Seoul';

function mapWeatherCodeToIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️';
  if (code >= 95 && code <= 99) return '⛈️';
  return '🌤️';
}

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
    icon: '✨',
    title: '오늘의 추천',
    desc: '실사진·초급·할인율 우수 매물 TOP 12만 룩북으로 떠먹기',
    badge: '추천',
  },
  {
    mode: 'list',
    icon: '📋',
    title: '전체 탐색',
    desc: '전체 매물을 난이도·금액·지역 필터로 한눈에 비교하기',
  },
  {
    mode: 'map',
    icon: '🗺️',
    title: '동네 지도',
    desc: '지도 위 가격 핀으로 관심 동네 경매 물건 찾기',
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
  const [infoModal, setInfoModal] = useState<InfoModalType>(null);
  const [weather, setWeather] = useState<WeatherState | null>(null);

  const [activeSourceFilter, setActiveSourceFilter] = useState<SourceFilterType>('sale_all');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [activeUsageFilter, setActiveUsageFilter] = useState<UsageFilterType>('all');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [selectedMapItem, setSelectedMapItem] = useState<FeedItem | null>(null);

  const cardListRef = useRef<FlatList<FeedItem>>(null);
  const mapRef = useRef<any>(null);

  const items: FeedItem[] = feedData.items || [];

  // '오늘의 추천' 엄선 TOP 12 큐레이션
  const curatedItems = useMemo(() => buildCuratedTopItems(items, 12), [items]);

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

  // 서울 현재 날씨 로드 (Open-Meteo 무료 API, 실패/로딩 시 조용히 숨김)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window === 'undefined') return;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {}
    }, 6000);

    fetch(OPEN_METEO_SEOUL_URL, controller ? { signal: controller.signal } : undefined)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.current) return;
        const tempVal = data.current.temperature_2m;
        const codeVal = data.current.weather_code;
        if (typeof tempVal === 'number' && Number.isFinite(tempVal)) {
          setWeather({
            temp: Math.round(tempVal),
            icon: mapWeatherCodeToIcon(typeof codeVal === 'number' ? codeVal : 0),
          });
        }
      })
      .catch(() => {
        // 네트워크 실패 시 조용히 숨김 (레이아웃 흔들림 방지)
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        controller?.abort();
      } catch {}
    };
  }, []);

  const openInfoModal = (type: Exclude<InfoModalType, null>) => {
    setMenuVisible(false);
    setTimeout(() => {
      setInfoModal(type);
    }, 80);
  };

  const handleSelectViewMode = async (mode: ViewMode) => {
    setViewMode(mode);
    setShowOnboarding(false);
    setMenuVisible(false);
    setActiveCardIndex(0);
    setSelectedMapItem(null);
    if (cardListRef.current) {
      try {
        cardListRef.current.scrollToOffset({ offset: 0, animated: false });
      } catch (e) {}
    }
    try {
      await AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch (err) {
      console.error('Failed to save viewMode:', err);
    }
  };

  // 거래유형(구분)별 건수 집계
  const sourceCounts = useMemo(() => {
    let auction = 0;
    let onbidSale = 0;
    let onbidLease = 0;
    for (const it of items) {
      const st = getSourceType(it);
      if (st === 'onbid_sale') onbidSale += 1;
      else if (st === 'onbid_lease') onbidLease += 1;
      else auction += 1;
    }
    return {
      sale_all: auction + onbidSale,
      auction,
      onbid_sale: onbidSale,
      onbid_lease: onbidLease,
    };
  }, [items]);

  // 선택된 구분(매각 전체 / 경매 / 공매 매각 / 공매 임대) 기준 1차 목록
  const sourceScopedItems = useMemo(() => {
    return items.filter((item) => {
      const st = getSourceType(item);
      if (activeSourceFilter === 'sale_all') return st !== 'onbid_lease';
      if (activeSourceFilter === 'auction') return st === 'auction';
      if (activeSourceFilter === 'onbid_sale') return st === 'onbid_sale';
      if (activeSourceFilter === 'onbid_lease') return st === 'onbid_lease';
      return true;
    });
  }, [items, activeSourceFilter]);

  // 용도별 매물 건수 집계 (현재 선택된 거래유형 기준)
  const usageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sourceScopedItems.length };
    for (const it of sourceScopedItems) {
      counts[it.usage] = (counts[it.usage] || 0) + 1;
    }
    return counts;
  }, [sourceScopedItems]);

  // '전체 탐색' & '동네 지도'용 필터링 적용 목록 (구분 + 용도 + 난이도/가격대/지역 교차 필터)
  // 주의: 매매 가격대 필터('3억 이하', '3억~6억')는 법원경매 + 공매 매각에만 적용하고 공매 임대는 자동 제외!
  const filteredItems = useMemo(() => {
    const isPriceFilter = activeFilter === 'budget_small' || activeFilter === 'budget_mid';
    return sourceScopedItems.filter((item) => {
      if (isPriceFilter && isOnbidLease(item)) return false;
      if (activeUsageFilter !== 'all' && item.usage !== activeUsageFilter) return false;
      if (activeFilter === 'beginner' && (isOnbidLease(item) || item.safety_grade !== 'GREEN')) return false;
      if (activeFilter === 'intermediate' && (isOnbidLease(item) || item.safety_grade !== 'YELLOW')) return false;
      if (activeFilter === 'advanced' && (isOnbidLease(item) || item.safety_grade !== 'RED')) return false;
      if (activeFilter === 'budget_small' && item.min_bid > 300_000_000) return false;
      if (activeFilter === 'budget_mid' && (item.min_bid <= 300_000_000 || item.min_bid > 600_000_000)) return false;
      if (activeFilter === 'seoul' && !item.location.includes('서울')) return false;
      if (activeFilter === 'gyeonggi' && !item.location.includes('경기') && !item.location.includes('인천')) return false;
      return true;
    });
  }, [sourceScopedItems, activeFilter, activeUsageFilter]);

  const handleSourceFilterChange = (src: SourceFilterType) => {
    setActiveSourceFilter(src);
    setActiveUsageFilter('all');
    // 공매(임대) 선택 시 매매 전용 가격대/난이도 필터는 자동 초기화
    if (
      src === 'onbid_lease' &&
      (activeFilter === 'budget_small' ||
        activeFilter === 'budget_mid' ||
        activeFilter === 'beginner' ||
        activeFilter === 'intermediate' ||
        activeFilter === 'advanced')
    ) {
      setActiveFilter('all');
    }
    setSelectedMapItem(null);
  };

  const handleFilterChange = (type: FilterType) => {
    setActiveFilter(type);
    setSelectedMapItem(null);
  };

  const handleUsageFilterChange = (usage: UsageFilterType) => {
    setActiveUsageFilter(usage);
    setSelectedMapItem(null);
  };

  const renderBadge = (grade: string, compact = false) => {
    if (grade === 'GREEN') {
      return (
        <View style={[styles.badge, styles.badgeGreen]}>
          <Text style={styles.badgeTextGreen}>{compact ? '🟢 초급' : '🟢 초급 · 권리 심플'}</Text>
        </View>
      );
    }
    if (grade === 'YELLOW') {
      return (
        <View style={[styles.badge, styles.badgeYellow]}>
          <Text style={styles.badgeTextYellow}>{compact ? '🟡 중급' : '🟡 중급 · 권리 체크'}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeRed]}>
        <Text style={styles.badgeTextRed}>{compact ? '🔴 고수' : '🔴 고수 · 하이리턴'}</Text>
      </View>
    );
  };

  const renderSourceBadge = (item: FeedItem) => {
    const meta = getSourceBadgeMeta(item);
    return (
      <View
        style={[
          styles.sourcePill,
          { backgroundColor: meta.bg, borderColor: meta.border },
        ]}
      >
        <Text style={[styles.sourcePillText, { color: meta.text }]}>{meta.label}</Text>
      </View>
    );
  };

  // ──────────────────────────────────────────
  // 1. '전체 탐색' (리스트형 — 법원경매 + 공매 매각 / 공매 임대)
  // ──────────────────────────────────────────
  const renderListItem = ({ item }: { item: FeedItem }) => {
    const fav = isFavorite(item.case_number);
    const lease = isOnbidLease(item);
    const leaseMonthly = item.onbid_info?.est_monthly_fee_str;

    return (
      <TouchableOpacity
        style={styles.listCard}
        activeOpacity={0.92}
        onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
      >
        <View style={styles.listImageWrap}>
          <Image source={{ uri: item.photo_url }} style={styles.listImage} resizeMode="cover" />
          <View style={styles.badgeContainer}>
            {renderSourceBadge(item)}
            {lease ? (
              <View style={[styles.badge, styles.badgeLease]}>
                <Text style={styles.badgeTextLease}>🔑 공공임대</Text>
              </View>
            ) : (
              renderBadge(item.safety_grade, true)
            )}
          </View>
          <View style={styles.dDayContainer}>
            <Text style={styles.dDayText}>{formatDDayLabel(item.d_day)}</Text>
          </View>
          <TouchableOpacity
            style={styles.favButton}
            onPress={() => toggleFavorite(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.heartIcon, fav && styles.heartIconActive]}>
              {fav ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listCardContent}>
          <Text style={styles.listHeadline} numberOfLines={2}>
            {item.headline}
          </Text>

          {lease ? (
            <View style={styles.priceRow}>
              <View style={styles.priceLeft}>
                <Text style={styles.priceLabel}>예정 사용료(연/기간)</Text>
                <Text style={styles.priceValue}>{item.onbid_info?.annual_fee_str || item.min_bid_str}</Text>
              </View>
              {leaseMonthly ? (
                <View style={styles.leaseMonthlyBadge}>
                  <Text style={styles.leaseMonthlyText}>월 환산 약 {leaseMonthly}</Text>
                </View>
              ) : undefined}
            </View>
          ) : (
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
          )}

          <View style={styles.bulletContainer}>
            {item.summary_bullets.map((bullet, idx) => (
              <Text key={idx} style={styles.bulletText} numberOfLines={1}>
                {bullet}
              </Text>
            ))}
          </View>

          <View style={styles.footerRow}>
            <Text style={styles.footerText} numberOfLines={1}>
              {item.short_location} · {item.usage}
            </Text>
            <Text style={styles.detailLink}>자세히 보기 →</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ──────────────────────────────────────────
  // 2. '오늘의 추천' — 에디토리얼 룩북형 (TOP 12, 피크 레이아웃)
  // ──────────────────────────────────────────
  const CARD_GAP = 14;
  const LOOKBOOK_LEFT_INSET = winWidth > 500 ? Math.max(24, Math.floor((winWidth - 380) / 2) - 24) : 20;
  // 오른쪽 가장자리에 다음 카드가 살짝(약 24~32px) 삐죽 보이도록 폭 계산
  const lookbookCardWidth = winWidth > 500 ? 360 : Math.max(280, winWidth - 58);
  const snapInterval = lookbookCardWidth + CARD_GAP;

  // 상하 헤더·탭바·네비바에 절대 안 씹히도록 사진 높이 반응형 계산
  const lookbookAvailHeight = Math.max(420, winHeight - 195);
  const lookbookPhotoHeight = Math.max(175, Math.min(lookbookAvailHeight * 0.45, 255));

  const onLookbookScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / snapInterval);
    if (idx !== activeCardIndex && idx >= 0 && idx < curatedItems.length) {
      setActiveCardIndex(idx);
    }
  };

  const goToLookbookIndex = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= curatedItems.length) return;
    setActiveCardIndex(nextIdx);
    if (cardListRef.current) {
      try {
        cardListRef.current.scrollToOffset({ offset: nextIdx * snapInterval, animated: true });
      } catch (e) {}
    }
  };

  const renderLookbookItem = ({ item, index }: { item: FeedItem; index: number }) => {
    const fav = isFavorite(item.case_number);
    const gapShort = item.gap_short_str || item.gap_amount_str;
    const diffShort =
      item.safety_grade === 'GREEN'
        ? '🟢 초급'
        : item.safety_grade === 'YELLOW'
        ? '🟡 중급'
        : '🔴 고수';
    const shortSgg = (item.short_location || '').split(' ').slice(0, 2).join(' ');

    const pastelTags: { label: string; tone: 'sage' | 'sand' | 'rose' }[] = [
      {
        label:
          item.safety_grade === 'GREEN'
            ? '추가 인수금 0원'
            : item.safety_grade === 'YELLOW'
            ? '세입자·관리비 체크'
            : '고수용 하이리턴',
        tone: item.safety_grade === 'GREEN' ? 'sage' : item.safety_grade === 'RED' ? 'rose' : 'sand',
      },
      { label: `보증금 ${item.deposit_required_str}`, tone: 'sand' },
      { label: formatDDayLabel(item.d_day), tone: 'sand' },
    ];

    return (
      <View
        style={[
          styles.lookbookItemWrap,
          {
            width: lookbookCardWidth,
            marginRight: index === curatedItems.length - 1 ? 0 : CARD_GAP,
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.lookbookCardScrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* 카드 전체 터치 없음 — 오직 하단 '자세히 보기 →' 버튼만 상세 이동 (스와이프 오작동 방지) */}
          <View style={styles.lookbookCard}>
            {/* 상단 절반: 둥근 모서리 실물 사진 + 좌상단 알약 + 우상단 ♡ 찜 */}
            <View style={styles.lookbookPhotoOuter}>
              <View style={[styles.lookbookPhotoWrap, { height: lookbookPhotoHeight }]}>
                <Image
                  source={{ uri: item.photo_url }}
                  style={styles.lookbookPhoto}
                  resizeMode="cover"
                />

                {/* 좌상단 난이도/지역 알약 */}
                <View style={styles.lookbookTopPill}>
                  <Text style={styles.lookbookTopPillText}>
                    {diffShort} · {shortSgg}
                  </Text>
                </View>

                {/* 우상단 ♡ 찜 버튼 */}
                <TouchableOpacity
                  style={styles.lookbookHeartBtn}
                  onPress={() => toggleFavorite(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.lookbookHeartText, fav && styles.lookbookHeartActive]}>
                    {fav ? '♥' : '♡'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 하단 절반: 넉넉한 여백의 에디토리얼 타이포 & 정보 */}
            <View style={styles.lookbookBody}>
              {/* 구분 배지([경매]/[공매 · 매각]/[공매 · 임대]) + 카테고리 | 지역 구분선 */}
              <View style={styles.lookbookKickerRow}>
                {renderSourceBadge(item)}
                <Text style={styles.lookbookKickerCat}>{item.usage}</Text>
                <Text style={styles.lookbookKickerDivider}>|</Text>
                <Text style={styles.lookbookKickerLoc} numberOfLines={1}>
                  {item.short_location}
                </Text>
              </View>

              {/* 감성적이고 굵은 다크 차콜 타이틀 */}
              <Text style={styles.lookbookTitle} numberOfLines={2}>
                {item.headline}
              </Text>

              {/* 큼직한 최저가 숫자 + 감정가 대비 할인 */}
              <View style={styles.lookbookPriceBlock}>
                <Text style={styles.lookbookBigPrice}>{item.min_bid_str}</Text>
                <View style={styles.lookbookDiscountRow}>
                  {item.discount_pct > 0 ? (
                    <Text style={styles.lookbookDiscountAccent}>
                      감정가 대비 -{item.discount_pct}%
                    </Text>
                  ) : (
                    <Text style={styles.lookbookDiscountMuted}>감정가 신건</Text>
                  )}
                  {item.gap_amount > 0 && (
                    <Text style={styles.lookbookGapMuted}>· {gapShort} 저렴</Text>
                  )}
                </View>
              </View>

              {/* 은은한 파스텔 태그 2~3개 */}
              <View style={styles.lookbookTagsRow}>
                {pastelTags.map((t, tIdx) => (
                  <View
                    key={tIdx}
                    style={[
                      styles.pastelTag,
                      t.tone === 'sage' && styles.pastelTagSage,
                      t.tone === 'rose' && styles.pastelTagRose,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pastelTagText,
                        t.tone === 'sage' && styles.pastelTagTextSage,
                        t.tone === 'rose' && styles.pastelTagTextRose,
                      ]}
                    >
                      {t.label}
                    </Text>
                  </View>
                ))}
              </View>

              {/* 검은 알약형 '자세히 보기 →' 버튼 (오직 이 버튼만 상세 화면 이동) */}
              <TouchableOpacity
                style={styles.lookbookCtaBtn}
                activeOpacity={0.85}
                onPress={() => router.push(`/detail/${encodeURIComponent(item.case_number)}`)}
              >
                <Text style={styles.lookbookCtaText}>자세히 보기 →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  // ──────────────────────────────────────────
  // 3. '동네 지도' (지도형)
  // ──────────────────────────────────────────
  const mapItems = useMemo(() => {
    return filteredItems.filter(
      (i) => i.lat && i.lng && typeof i.lat === 'number' && typeof i.lng === 'number'
    );
  }, [filteredItems]);

  const renderMapView = () => {
    const isWeb = Platform.OS === 'web';

    if (!isWeb && !MapView) {
      return (
        <View style={styles.webMapFallback}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🗺️</Text>
          <Text style={styles.webMapTitle}>지도를 불러오는 중 문제가 발생했어요</Text>
          <Text style={styles.webMapSubtitle}>
            오늘의 추천이나 전체 탐색으로 바로 확인해 보세요!{'\n'}
            (현재 조건 지도 매물: {mapItems.length}건)
          </Text>
          <View style={styles.webMapActionRow}>
            <TouchableOpacity
              style={styles.webSwitchPrimaryBtn}
              onPress={() => handleSelectViewMode('card')}
            >
              <Text style={styles.webSwitchPrimaryText}>✨ 오늘의 추천</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.webSwitchSecondaryBtn}
              onPress={() => handleSelectViewMode('list')}
            >
              <Text style={styles.webSwitchSecondaryText}>📋 전체 탐색</Text>
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
        {isWeb ? (
          <WebAuctionMap
            items={mapItems}
            selectedCaseNumber={selectedMapItem?.case_number ?? null}
            onSelectItem={setSelectedMapItem}
          />
        ) : (
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
        )}

        {selectedMapItem && (
          <View style={styles.mapFloatingCardWrap}>
            <TouchableOpacity
              style={styles.mapFloatingCard}
              activeOpacity={0.92}
              onPress={() => router.push(`/detail/${encodeURIComponent(selectedMapItem.case_number)}`)}
            >
              <Image
                source={{ uri: selectedMapItem.photo_url }}
                style={styles.mapCardThumb}
                resizeMode="cover"
              />
              <View style={styles.mapCardDetails}>
                <View style={styles.mapCardBadgeRow}>
                  {renderSourceBadge(selectedMapItem)}
                  {!isOnbidLease(selectedMapItem) && renderBadge(selectedMapItem.safety_grade, true)}
                  <Text style={styles.mapCardDDay} numberOfLines={1}>
                    {selectedMapItem.usage} · {formatDDayLabel(selectedMapItem.d_day)}
                  </Text>
                </View>
                <Text style={styles.mapCardHeadline} numberOfLines={1}>
                  {selectedMapItem.headline}
                </Text>
                <View style={styles.mapCardPriceRow}>
                  {isOnbidLease(selectedMapItem) ? (
                    <>
                      <Text style={styles.mapCardPrice}>
                        연 {selectedMapItem.onbid_info?.annual_fee_str || selectedMapItem.min_bid_str}
                      </Text>
                      {selectedMapItem.onbid_info?.est_monthly_fee_str ? (
                        <Text style={styles.mapCardLeaseTag}>
                          월 약 {selectedMapItem.onbid_info.est_monthly_fee_str}
                        </Text>
                      ) : undefined}
                    </>
                  ) : (
                    <>
                      <Text style={styles.mapCardPrice}>{selectedMapItem.min_bid_str}</Text>
                      {selectedMapItem.discount_pct > 0 && (
                        <Text style={styles.mapCardDiscount}>-{selectedMapItem.discount_pct}%</Text>
                      )}
                    </>
                  )}
                </View>
                <Text style={styles.mapCardHint}>자세히 보기 →</Text>
              </View>
              <TouchableOpacity
                style={styles.mapCardCloseBtn}
                onPress={(e: any) => {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  setSelectedMapItem(null);
                }}
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
  // 4. 첫 진입 보기 선택 화면 (오늘의 추천 / 전체 탐색 / 동네 지도)
  // ──────────────────────────────────────────
  if (isModeLoaded && showOnboarding) {
    return (
      <SafeAreaView style={styles.onboardingContainer} edges={['top', 'bottom']}>
        <View style={styles.onboardingInner}>
          <View style={styles.onboardingBrandBox}>
            <Text style={styles.onboardingBrandTitle}>이지경매</Text>
            <Text style={styles.onboardingBrandSub}>경매 물건 떠먹기</Text>
          </View>

          <View style={styles.onboardingTitleBox}>
            <Text style={styles.onboardingHeadline}>어떻게 둘러볼까요?</Text>
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
                  <Text style={{ fontSize: 26 }}>{opt.icon}</Text>
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

  const isLookbook = viewMode === 'card';

  return (
    <SafeAreaView
      style={[styles.container, isLookbook && styles.containerEditorial]}
      edges={['top']}
    >
      {/* 1. 미니멀 브랜드 헤더 (이지경매 / 경매 물건 떠먹기 + 날씨 뱃지 + 우측 ☰) */}
      <View style={[styles.brandHeader, isLookbook && styles.brandHeaderEditorial]}>
        <View style={styles.brandLeftGroup}>
          <View style={styles.brandTitleWrap}>
            <Text style={styles.brandTitle}>이지경매</Text>
            <Text style={styles.brandSubtitle} numberOfLines={1}>
              경매 물건 떠먹기
            </Text>
          </View>
          {isLookbook && weather && (
            <View style={styles.weatherBadge} accessibilityLabel={`서울 현재 날씨 ${weather.temp}도`}>
              <Text style={styles.weatherBadgeText} numberOfLines={1}>
                {weather.icon} {weather.temp}° 서울
              </Text>
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {isLookbook && curatedItems.length > 0 && (
            <View style={styles.lookbookCounterPill}>
              <Text style={styles.lookbookCounterText}>
                {activeCardIndex + 1} / {curatedItems.length}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.menuButton, isLookbook && styles.menuButtonEditorial]}
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.75}
            accessibilityLabel="메뉴 열기"
          >
            <Text style={styles.menuButtonIcon}>☰</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 상단 필터 바 ('전체 탐색' & '동네 지도': 구분 + 용도 + 조건 교차 필터링) */}
      {!isLookbook && (
        <View style={styles.filterBar}>
          {/* 1행: 거래유형 구분 탭 (기본: 경매+공매 매각 / 법원경매 / 공매(매각) / 공매(임대)) */}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterList}
            data={[
              { type: 'sale_all', label: `매각 전체 ${sourceCounts.sale_all}` },
              { type: 'auction', label: `법원경매 ${sourceCounts.auction}` },
              { type: 'onbid_sale', label: `공매(매각) ${sourceCounts.onbid_sale}` },
              { type: 'onbid_lease', label: `공매(임대) ${sourceCounts.onbid_lease}` },
            ]}
            keyExtractor={(i) => i.type}
            renderItem={({ item }) => {
              const isSelected = activeSourceFilter === item.type;
              const isLeaseChip = item.type === 'onbid_lease';
              return (
                <TouchableOpacity
                  style={[
                    styles.sourceTabChip,
                    isSelected && (isLeaseChip ? styles.sourceTabChipLeaseActive : styles.sourceTabChipActive),
                  ]}
                  onPress={() => handleSourceFilterChange(item.type as SourceFilterType)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.sourceTabChipText,
                      isSelected && styles.sourceTabChipTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {/* 2행: 용도 필터 칩 (전체 | 아파트 | 빌라 | 오피스텔 | 상가 | 토지) */}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterList}
            data={[
              { type: 'all', label: `전체 ${usageCounts.all || 0}` },
              { type: '아파트', label: `아파트 ${usageCounts['아파트'] || 0}` },
              { type: '빌라', label: `빌라 ${usageCounts['빌라'] || 0}` },
              { type: '오피스텔', label: `오피스텔 ${usageCounts['오피스텔'] || 0}` },
              { type: '상가', label: `상가 ${usageCounts['상가'] || 0}` },
              { type: '토지', label: `토지 ${usageCounts['토지'] || 0}` },
            ]}
            keyExtractor={(i) => i.type}
            renderItem={({ item }) => {
              const isSelected = activeUsageFilter === item.type;
              return (
                <TouchableOpacity
                  style={[styles.usageChip, isSelected && styles.usageChipActive]}
                  onPress={() => handleUsageFilterChange(item.type as UsageFilterType)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.usageChipText, isSelected && styles.usageChipTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {/* 3행: 난이도 · 매매 가격대(임대 모드 제외) · 지역 필터 칩 */}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterList, styles.filterListSecondary]}
            data={
              activeSourceFilter === 'onbid_lease'
                ? [
                    { type: 'all', label: `임대 전체 (${filteredItems.length}건)` },
                    { type: 'seoul', label: '서울' },
                    { type: 'gyeonggi', label: '경기·인천' },
                  ]
                : [
                    { type: 'all', label: `전체 조건 (${filteredItems.length}건)` },
                    { type: 'beginner', label: '🟢 초급' },
                    { type: 'intermediate', label: '🟡 중급' },
                    { type: 'advanced', label: '🔴 고수' },
                    { type: 'budget_small', label: '3억 이하' },
                    { type: 'budget_mid', label: '3억~6억' },
                    { type: 'seoul', label: '서울' },
                    { type: 'gyeonggi', label: '경기·인천' },
                  ]
            }
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
      )}

      {/* 3. 메인 뷰 */}
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
        <View style={styles.lookbookWrap}>
          {/* 에디토리얼 큐레이션 서브 헤더 */}
          <View style={styles.lookbookSubHeader}>
            <Text style={styles.lookbookSubTitle}>TODAY&apos;S CURATION · 오늘의 추천</Text>
            <TouchableOpacity onPress={() => handleSelectViewMode('list')} activeOpacity={0.7}>
              <Text style={styles.lookbookViewAllLink}>전체 {items.length}건 ›</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={cardListRef}
            data={curatedItems}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={snapInterval}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={true}
            onScroll={onLookbookScroll}
            scrollEventThrottle={16}
            keyExtractor={(item) => item.case_number}
            renderItem={renderLookbookItem}
            contentContainerStyle={{
              paddingLeft: LOOKBOOK_LEFT_INSET,
              paddingRight: Math.max(20, winWidth - lookbookCardWidth - LOOKBOOK_LEFT_INSET),
            }}
            style={styles.lookbookList}
          />

          {/* 하단 컴팩트 룩북 컨트롤 */}
          {curatedItems.length > 1 && (
            <View style={styles.lookbookNavBar}>
              <TouchableOpacity
                style={[styles.lookbookNavBtn, activeCardIndex === 0 && styles.lookbookNavBtnDisabled]}
                onPress={() => goToLookbookIndex(activeCardIndex - 1)}
                disabled={activeCardIndex === 0}
              >
                <Text
                  style={[
                    styles.lookbookNavBtnText,
                    activeCardIndex === 0 && styles.lookbookNavBtnTextDisabled,
                  ]}
                >
                  ‹ 이전
                </Text>
              </TouchableOpacity>

              <View style={styles.dotsRow}>
                {curatedItems.map((_, idx) => (
                  <View
                    key={idx}
                    style={[styles.dot, idx === activeCardIndex && styles.dotActive]}
                  />
                ))}
              </View>

              <TouchableOpacity
                style={[
                  styles.lookbookNavBtn,
                  activeCardIndex >= curatedItems.length - 1 && styles.lookbookNavBtnDisabled,
                ]}
                onPress={() => goToLookbookIndex(activeCardIndex + 1)}
                disabled={activeCardIndex >= curatedItems.length - 1}
              >
                <Text
                  style={[
                    styles.lookbookNavBtnText,
                    activeCardIndex >= curatedItems.length - 1 && styles.lookbookNavBtnTextDisabled,
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

      {/* 4. 우측 상단 ☰ 메뉴 → 바텀시트 (오늘의 추천 / 전체 탐색 / 동네 지도) */}
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
                <Text style={styles.sheetTitle}>메뉴 전환</Text>
                <Text style={styles.sheetSub}>원하는 탐색 방식을 골라 보세요</Text>
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
                          style={[styles.sheetOptTitle, active && styles.sheetOptTitleActive]}
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

            {/* 바텀시트 하단: 공지사항 & 사용설명서 */}
            <View style={styles.sheetInfoDivider} />
            <View style={styles.sheetInfoRow}>
              <TouchableOpacity
                style={styles.sheetInfoBtn}
                activeOpacity={0.8}
                onPress={() => openInfoModal('notice')}
              >
                <Text style={styles.sheetInfoBtnIcon}>📢</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetInfoBtnTitle}>공지사항</Text>
                  <Text style={styles.sheetInfoBtnSub}>베타 · 업데이트 안내</Text>
                </View>
                <Text style={styles.sheetInfoChevron}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetInfoBtn}
                activeOpacity={0.8}
                onPress={() => openInfoModal('guide')}
              >
                <Text style={styles.sheetInfoBtnIcon}>📖</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetInfoBtnTitle}>사용설명서</Text>
                  <Text style={styles.sheetInfoBtnSub}>난이도 · 계산기 가이드</Text>
                </View>
                <Text style={styles.sheetInfoChevron}>›</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 5. 공지사항 & 사용설명서 모달 */}
      <Modal
        visible={infoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModal(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setInfoModal(null)}>
          <Pressable style={styles.infoSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>
                  {infoModal === 'notice' ? '📢 공지사항' : '📖 이지경매 사용설명서'}
                </Text>
                <Text style={styles.sheetSub}>
                  {infoModal === 'notice'
                    ? '이지경매 최신 소식과 예정 기능을 안내드려요'
                    : '경매 초보도 실수 없이 떠먹는 핵심 체크 가이드'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setInfoModal(null)}
                accessibilityLabel="닫기"
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.infoScroll}
              contentContainerStyle={styles.infoScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {infoModal === 'notice' ? (
                <>
                  <View style={styles.infoCard}>
                    <View style={styles.infoCardHeader}>
                      <View style={styles.infoTagBeta}>
                        <Text style={styles.infoTagBetaText}>BETA OPEN</Text>
                      </View>
                      <Text style={styles.infoCardTitle}>이지경매 모바일 앱·웹 베타 오픈</Text>
                    </View>
                    <Text style={styles.infoCardBody}>
                      어려운 등기부등본과 현황조사서를 10초 요약 브리핑과 에디토리얼 카드로 쉽게
                      떠먹을 수 있는 이지경매 베타 서비스를 오픈했습니다. 오늘의 추천, 전체 탐색,
                      동네 지도까지 앱과 웹에서 동일하게 이용하실 수 있습니다.
                    </Text>
                  </View>

                  <View style={styles.infoCard}>
                    <View style={styles.infoCardHeader}>
                      <View style={styles.infoTagUpdate}>
                        <Text style={styles.infoTagUpdateText}>DAILY SYNC</Text>
                      </View>
                      <Text style={styles.infoCardTitle}>매일 경매 데이터 자동 업데이트</Text>
                    </View>
                    <Text style={styles.infoCardBody}>
                      수도권 16개 법원(서울·경기·인천)의 진행 매물, 유찰에 따른 최저가 변동, 법원
                      감정평가서 실물 사진 및 전체 임차인 현황이 매일 주기적으로 수집·갱신됩니다.
                    </Text>
                  </View>

                  <View style={styles.infoCard}>
                    <View style={styles.infoCardHeader}>
                      <View style={styles.infoTagRoadmap}>
                        <Text style={styles.infoTagRoadmapText}>COMING SOON</Text>
                      </View>
                      <Text style={styles.infoCardTitle}>온비드 공매 · 맞춤 알림 추가 예정</Text>
                    </View>
                    <Text style={styles.infoCardBody}>
                      앞으로 캠코 온비드(Onbid) 공매 매물 통합, 관심 동네·예산·용도별 신건/유찰
                      맞춤 알림, 실거래가 기반 입찰가 시뮬레이터 고도화가 순차 추가될 예정입니다.
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.infoCard}>
                    <Text style={styles.infoStepTitle}>① 난이도 3단계 분류 기준</Text>
                    <View style={styles.guideList}>
                      <Text style={styles.guideItem}>
                        <Text style={styles.guideStrong}>🟢 초급</Text> : 임차인이 없거나 말소기준권리
                        이후 권리가 전부 소멸해 추가 인수 부담이 적은 입문용 매물입니다.
                      </Text>
                      <Text style={styles.guideItem}>
                        <Text style={styles.guideStrong}>🟡 중급</Text> : 대항력 임차인·배당요구
                        여부·미납 관리비 등 기본적인 권리 체크가 필요한 매물입니다.
                      </Text>
                      <Text style={styles.guideItem}>
                        <Text style={styles.guideStrong}>🔴 고수</Text> : 선순위 임차인·유치권·지분매각·법정지상권
                        등 특수 권리가 있으나 큰 할인율과 수익을 노리는 전문가용 매물입니다.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.infoCard}>
                    <Text style={styles.infoStepTitle}>
                      ② 선순위 인수 보증금 · 방공제 계산기 활용법
                    </Text>
                    <Text style={styles.infoCardBody}>
                      상세 화면의 <Text style={styles.guideStrong}>필요 자기자본 계산기</Text>에서
                      일반 LTV · 생애최초 · 보수적(경매) 조건을 눌러 실제 필요한 현금을 바로 비교해
                      보세요. 주거용 일반 대출 시 지역별 소액임차보증금(방공제: 서울 5,500만 ·
                      경기/인천 과밀억제 4,800만 · 기타 2,800만)이 자동 차감되며,{' '}
                      <Text style={styles.guideStrong}>MCI·MCG 보증보험 토글</Text>이나 생애최초
                      선택 시 면제 효과까지 계산됩니다.{'\n\n'}
                      또한 <Text style={styles.guideStrong}>법원 원본 데이터</Text> 아코디언에서
                      ‘선순위 인수 예상 보증금’과 ‘전체 조사된 임차인 현황’을 반드시 구분해 확인하세요.
                    </Text>
                  </View>

                  <View style={[styles.infoCard, styles.infoCardWarn]}>
                    <Text style={styles.infoStepTitle}>
                      ③ 입찰 전 대법원 원문 최종 확인 권장 (면책 안내)
                    </Text>
                    <Text style={styles.infoCardBody}>
                      이지경매의 AI 브리핑, 시세 추정, 대출 시뮬레이션은 빠른 탐색을 돕기 위한{' '}
                      <Text style={styles.guideStrong}>참고용 정보</Text>입니다. 실제 입찰 전에는
                      반드시 상세 화면 하단의{' '}
                      <Text style={styles.guideStrong}>
                        [대한민국 법원 경매정보(courtauction.go.kr) 바로가기]
                      </Text>
                      에서 매각물건명세서·현황조사서·등기부등본 원문과 현장 임장을 직접 확인하시기
                      바라며, 최종 입찰 결정 및 책임은 입찰자 본인에게 있습니다.
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.infoConfirmBtn}
              activeOpacity={0.85}
              onPress={() => setInfoModal(null)}
            >
              <Text style={styles.infoConfirmBtnText}>확인했어요</Text>
            </TouchableOpacity>
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
  containerEditorial: {
    backgroundColor: '#FAF8F5',
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
  brandHeaderEditorial: {
    backgroundColor: '#FAF8F5',
    paddingHorizontal: 16,
  },
  brandLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 8,
    marginRight: 8,
  },
  brandTitleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1C1917',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#78716C',
    flexShrink: 1,
  },
  weatherBadge: {
    backgroundColor: '#F3EFE8',
    borderWidth: 1,
    borderColor: '#E7E2D8',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 999,
    flexShrink: 0,
  },
  weatherBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#57534E',
    letterSpacing: -0.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  lookbookCounterPill: {
    backgroundColor: '#EFECE6',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  lookbookCounterText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#44403C',
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonEditorial: {
    backgroundColor: '#EFECE6',
  },
  menuButtonIcon: {
    fontSize: 19,
    fontWeight: '700',
    color: '#1C1917',
    lineHeight: 22,
  },

  // ── 첫 진입 온보딩 화면 ──
  onboardingContainer: {
    flex: 1,
    backgroundColor: '#FAF8F5',
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
    color: '#1C1917',
    letterSpacing: -0.6,
  },
  onboardingBrandSub: {
    fontSize: 14,
    fontWeight: '600',
    color: '#78716C',
  },
  onboardingTitleBox: {
    gap: 6,
  },
  onboardingHeadline: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1C1917',
    letterSpacing: -0.5,
  },
  onboardingHint: {
    fontSize: 14,
    color: '#78716C',
  },
  onboardingOptions: {
    gap: 14,
  },
  onboardingCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    shadowColor: '#292524',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  onboardingCardBtnFeatured: {
    borderColor: '#1C1917',
    borderWidth: 1.5,
  },
  onboardingIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FAF8F5',
    alignItems: 'center',
    justifyContent: 'center',
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
    color: '#1C1917',
  },
  onboardingOptDesc: {
    fontSize: 13,
    color: '#57534E',
    lineHeight: 18,
  },
  recommendPill: {
    backgroundColor: '#1C1917',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  recommendPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  onboardingArrow: {
    fontSize: 22,
    color: '#A8A29E',
    fontWeight: '600',
  },

  // ── 우측 상단 ☰ 메뉴 바텀시트 ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bottomSheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#D6D3D1',
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
    color: '#1C1917',
  },
  sheetSub: {
    fontSize: 13,
    color: '#78716C',
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F5F5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: {
    fontSize: 15,
    color: '#57534E',
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
    backgroundColor: '#FAF8F5',
    borderWidth: 1.5,
    borderColor: '#E7E5E4',
  },
  sheetOptionCardActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1C1917',
  },
  sheetOptTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1C1917',
  },
  sheetOptTitleActive: {
    color: '#1C1917',
  },
  sheetOptDesc: {
    fontSize: 12.5,
    color: '#78716C',
    marginTop: 2,
  },
  activeCheckPill: {
    backgroundColor: '#1C1917',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  activeCheckText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  sheetInfoDivider: {
    height: 1,
    backgroundColor: '#F0ECE4',
    marginTop: 2,
  },
  sheetInfoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sheetInfoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  sheetInfoBtnIcon: {
    fontSize: 18,
  },
  sheetInfoBtnTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#1C1917',
  },
  sheetInfoBtnSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#78716C',
    marginTop: 1,
  },
  sheetInfoChevron: {
    fontSize: 18,
    color: '#A8A29E',
    fontWeight: '600',
  },

  // ── 공지사항 & 사용설명서 모달 ──
  infoSheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '84%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  infoScroll: {
    flexGrow: 0,
  },
  infoScrollContent: {
    gap: 12,
    paddingBottom: 6,
  },
  infoCard: {
    backgroundColor: '#FAF8F5',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ECE7DF',
    gap: 8,
  },
  infoCardWarn: {
    backgroundColor: '#FEF9F0',
    borderColor: '#F3DFC1',
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  infoTagBeta: {
    backgroundColor: '#1C1917',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  infoTagBetaText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  infoTagUpdate: {
    backgroundColor: '#E7F3EC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  infoTagUpdateText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.4,
  },
  infoTagRoadmap: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  infoTagRoadmapText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
    letterSpacing: 0.4,
  },
  infoCardTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#1C1917',
    flexShrink: 1,
  },
  infoStepTitle: {
    fontSize: 14.5,
    fontWeight: '900',
    color: '#1C1917',
  },
  infoCardBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#44403C',
  },
  guideList: {
    gap: 7,
  },
  guideItem: {
    fontSize: 13,
    lineHeight: 19.5,
    color: '#44403C',
  },
  guideStrong: {
    fontWeight: '800',
    color: '#1C1917',
  },
  infoConfirmBtn: {
    backgroundColor: '#1C1917',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoConfirmBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // ── 상단 칩 필터 (전체 탐색 & 동네 지도) ──
  filterBar: {
    backgroundColor: '#ffffff',
    paddingTop: 6,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 6,
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 7,
  },
  filterListSecondary: {
    paddingTop: 1,
  },
  sourceTabChip: {
    paddingHorizontal: 12,
    paddingVertical: 5.5,
    borderRadius: 10,
    backgroundColor: '#F5F5F4',
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  sourceTabChipActive: {
    backgroundColor: '#1C1917',
    borderColor: '#1C1917',
  },
  sourceTabChipLeaseActive: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  sourceTabChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#57534E',
  },
  sourceTabChipTextActive: {
    color: '#FFFFFF',
  },
  sourcePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    flexShrink: 0,
  },
  sourcePillText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  badgeLease: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  badgeTextLease: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
  },
  leaseMonthlyBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  leaseMonthlyText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#047857',
  },
  mapCardLeaseTag: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#047857',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  usageChip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  usageChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  usageChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#44403C',
  },
  usageChipTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipActive: {
    backgroundColor: '#1C1917',
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

  // ── 1. 전체 탐색 (리스트형) ──
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
    color: '#1C1917',
    lineHeight: 24,
  },

  // ── 공통 배지/가격 ──
  badgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    backgroundColor: 'rgba(28, 25, 23, 0.78)',
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
  heartIcon: {
    fontSize: 19,
    color: '#57534E',
  },
  heartIconActive: {
    color: '#E11D48',
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
    color: '#78716C',
    fontWeight: '600',
  },
  priceValue: {
    fontSize: 21,
    fontWeight: '900',
    color: '#1C1917',
  },
  discountBadge: {
    backgroundColor: '#F5F0E8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  discountText: {
    color: '#B45309',
    fontSize: 13,
    fontWeight: '800',
  },
  bulletContainer: {
    gap: 5,
    backgroundColor: '#FAF8F5',
    padding: 12,
    borderRadius: 14,
  },
  bulletText: {
    fontSize: 13,
    color: '#44403C',
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
    color: '#78716C',
    fontWeight: '600',
  },
  detailLink: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1C1917',
  },

  // ── 2. '오늘의 추천' — 에디토리얼 룩북형 ──
  lookbookWrap: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  lookbookSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 6,
  },
  lookbookSubTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#78716C',
    letterSpacing: 0.8,
  },
  lookbookViewAllLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#44403C',
  },
  lookbookList: {
    flex: 1,
  },
  lookbookItemWrap: {
    flex: 1,
  },
  lookbookCardScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 12,
  },
  lookbookCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    shadowColor: '#292524',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#F0ECE4',
  },
  lookbookPhotoOuter: {
    padding: 10,
    paddingBottom: 0,
  },
  lookbookPhotoWrap: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E7E5E4',
  },
  lookbookPhoto: {
    width: '100%',
    height: '100%',
  },
  lookbookTopPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  lookbookTopPillText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1C1917',
  },
  lookbookHeartBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  lookbookHeartText: {
    fontSize: 20,
    color: '#44403C',
    lineHeight: 22,
  },
  lookbookHeartActive: {
    color: '#E11D48',
  },
  lookbookBody: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 12,
  },
  lookbookKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  lookbookKickerCat: {
    fontSize: 12,
    fontWeight: '800',
    color: '#44403C',
  },
  lookbookKickerDivider: {
    fontSize: 11,
    color: '#D6D3D1',
  },
  lookbookKickerLoc: {
    fontSize: 12,
    fontWeight: '600',
    color: '#78716C',
    flex: 1,
    minWidth: 0,
  },
  lookbookTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#1C1917',
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  lookbookPriceBlock: {
    gap: 4,
    paddingTop: 2,
  },
  lookbookBigPrice: {
    fontSize: 27,
    fontWeight: '900',
    color: '#1C1917',
    letterSpacing: -0.8,
  },
  lookbookDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  lookbookDiscountAccent: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
  },
  lookbookDiscountMuted: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78716C',
  },
  lookbookGapMuted: {
    fontSize: 13,
    fontWeight: '700',
    color: '#57534E',
  },
  lookbookTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingTop: 2,
  },
  pastelTag: {
    backgroundColor: '#F5F0E8',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pastelTagSage: {
    backgroundColor: '#EAF4EE',
  },
  pastelTagRose: {
    backgroundColor: '#FCEEEB',
  },
  pastelTagText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#57534E',
  },
  pastelTagTextSage: {
    color: '#166534',
  },
  pastelTagTextRose: {
    color: '#9F1239',
  },
  lookbookCtaBtn: {
    backgroundColor: '#1C1917',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  lookbookCtaText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  lookbookNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 10,
    paddingTop: 2,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  lookbookNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  lookbookNavBtnDisabled: {
    opacity: 0.35,
  },
  lookbookNavBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1C1917',
  },
  lookbookNavBtnTextDisabled: {
    color: '#A8A29E',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D6D3D1',
  },
  dotActive: {
    width: 16,
    backgroundColor: '#1C1917',
  },

  // ── 3. 동네 지도 (지도형) ──
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
    borderColor: '#1C1917',
    backgroundColor: '#FAF8F5',
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
    color: '#1C1917',
  },
  mapFloatingCardWrap: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 10,
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
    color: '#78716C',
    fontWeight: '700',
  },
  mapCardHeadline: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1C1917',
  },
  mapCardPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  mapCardPrice: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1C1917',
  },
  mapCardDiscount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F766E',
  },
  mapCardHint: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1C1917',
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
    backgroundColor: '#FAF8F5',
  },
  webMapTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1C1917',
    marginBottom: 8,
    textAlign: 'center',
  },
  webMapSubtitle: {
    fontSize: 13.5,
    color: '#78716C',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  webMapActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  webSwitchPrimaryBtn: {
    backgroundColor: '#1C1917',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D6D3D1',
  },
  webSwitchSecondaryText: {
    color: '#1C1917',
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
    color: '#78716C',
    fontWeight: '600',
  },
});
