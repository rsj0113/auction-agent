import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

const feedData = require('../../assets/mobile_feed.json');

export default function DetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isFavorite, toggleFavorite } = useFavorites();

  const caseNumber = decodeURIComponent(id || '');
  const items: FeedItem[] = feedData.items || [];
  const item = items.find((i) => i.case_number === caseNumber);

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>매물 정보를 찾을 수 없습니다.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>목록으로 돌아가기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const fav = isFavorite(item.case_number);

  const renderBadge = (grade: string) => {
    if (grade === 'GREEN') {
      return (
        <View style={[styles.badge, styles.badgeGreen]}>
          <Text style={styles.badgeTextGreen}>🟢 안심 (인수 권리 0원)</Text>
        </View>
      );
    }
    if (grade === 'YELLOW') {
      return (
        <View style={[styles.badge, styles.badgeYellow]}>
          <Text style={styles.badgeTextYellow}>🟡 임차인 권리 확인 필요</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeRed]}>
        <Text style={styles.badgeTextRed}>🔴 권리 위험 주의 매물</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 상단 메인 사진 & 뱃지 */}
        <View style={styles.imageBox}>
          <Image source={{ uri: item.photo_url }} style={styles.image} resizeMode="cover" />
          <View style={styles.badgeWrap}>{renderBadge(item.safety_grade)}</View>
          <View style={styles.dDayWrap}>
            <Text style={styles.dDayText}>{item.d_day}</Text>
          </View>
        </View>

        {/* 핵심 브리핑 헤드라인 */}
        <View style={styles.contentWrap}>
          <Text style={styles.headlineText}>{item.headline}</Text>
          <Text style={styles.locationText}>{item.location}</Text>

          {/* 1. 가격 & 시세 갭 하이라이트 박스 */}
          <View style={styles.highlightCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>💰 가격 분석 (10초 요약)</Text>
              <View style={styles.discountPill}>
                <Text style={styles.discountPillText}>-{item.discount_pct}%</Text>
              </View>
            </View>

            <View style={styles.statGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>최저 입찰가</Text>
                <Text style={styles.statValueLarge}>{item.min_bid_str}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>감정 평가액</Text>
                <Text style={styles.statValue}>{item.appraisal_str}</Text>
              </View>
            </View>

            <View style={styles.gapBanner}>
              <Text style={styles.gapBannerText}>
                {item.ref_price_name} 대비 약{' '}
                <Text style={styles.gapBold}>{item.gap_amount_str}</Text> 저렴하게 시작합니다.
              </Text>
            </View>
          </View>

          {/* 2. 최소 필요 자금 계산기 */}
          <View style={styles.highlightCard}>
            <Text style={styles.cardTitle}>💵 최소 준비 자금</Text>
            <View style={styles.cashRow}>
              <Text style={styles.cashLabel}>입찰 당일 보증금 (10%)</Text>
              <Text style={styles.cashValue}>{item.deposit_required_str}</Text>
            </View>
            <Text style={styles.cashTip}>
              * 당일 수표 1장으로 은행에서 발급받아 법원에 제출하면 됩니다.
            </Text>
          </View>

          {/* 3. 초보자를 위한 3줄 안심 권리 요약 */}
          <View style={styles.highlightCard}>
            <Text style={styles.cardTitle}>🛡️ 쉬운 권리 브리핑 3줄</Text>
            <View style={styles.bulletList}>
              {item.summary_bullets.map((b, idx) => (
                <View key={idx} style={styles.bulletItem}>
                  <Text style={styles.bulletNumber}>{idx + 1}</Text>
                  <Text style={styles.bulletContent}>{b}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 4. 법원 및 입찰 안내 메타 정보 */}
          <View style={styles.metaCard}>
            <Text style={styles.metaRow}>
              <Text style={styles.metaKey}>관할 법원: </Text>
              <Text style={styles.metaVal}>{item.court_name || '수도권 관할 법원'}</Text>
            </Text>
            <Text style={styles.metaRow}>
              <Text style={styles.metaKey}>사건 번호: </Text>
              <Text style={styles.metaVal}>{item.case_number}</Text>
            </Text>
            <Text style={styles.metaRow}>
              <Text style={styles.metaKey}>입찰 기일: </Text>
              <Text style={styles.metaVal}>{item.auction_date || '일정 확인 필요'}</Text>
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 하단 고정 찜 액션 바 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.favActionBtn, fav && styles.favActionBtnActive]}
          onPress={() => toggleFavorite(item)}
          activeOpacity={0.8}
        >
          <Text style={styles.favActionIcon}>{fav ? '⭐' : '☆'}</Text>
          <Text style={[styles.favActionText, fav && styles.favActionTextActive]}>
            {fav ? '관심 매물 등록됨' : '관심 매물로 찜하기'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  backButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  imageBox: {
    width: '100%',
    height: 240,
    position: 'relative',
    backgroundColor: '#cbd5e1',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badgeWrap: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  badgeGreen: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgeTextGreen: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '800',
  },
  badgeYellow: {
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  badgeTextYellow: {
    color: '#a16207',
    fontSize: 13,
    fontWeight: '800',
  },
  badgeRed: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  badgeTextRed: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '800',
  },
  dDayWrap: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  dDayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  contentWrap: {
    padding: 20,
    gap: 16,
  },
  headlineText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 28,
  },
  locationText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: -8,
  },
  highlightCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
  },
  discountPill: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  discountPillText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '800',
  },
  statGrid: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 24,
  },
  statItem: {
    gap: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  statValueLarge: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  gapBanner: {
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  gapBannerText: {
    fontSize: 13,
    color: '#166534',
    lineHeight: 18,
  },
  gapBold: {
    fontWeight: '900',
    color: '#15803d',
  },
  cashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  cashLabel: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '600',
  },
  cashValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  cashTip: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 16,
  },
  bulletList: {
    gap: 10,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#eff6ff',
    color: '#2563eb',
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '800',
  },
  bulletContent: {
    flex: 1,
    fontSize: 13.5,
    color: '#334155',
    lineHeight: 20,
    fontWeight: '500',
  },
  metaCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metaRow: {
    fontSize: 12,
  },
  metaKey: {
    color: '#64748b',
    fontWeight: '600',
  },
  metaVal: {
    color: '#0f172a',
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  favActionBtn: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
  },
  favActionBtnActive: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  favActionIcon: {
    fontSize: 18,
  },
  favActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  favActionTextActive: {
    color: '#334155',
  },
});
