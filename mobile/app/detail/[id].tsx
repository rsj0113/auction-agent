import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FeedItem } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';

const feedData = require('../../assets/mobile_feed.json');
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function DetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isFavorite, toggleFavorite } = useFavorites();
  
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [isRawExpanded, setIsRawExpanded] = useState(false);

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
  const photos = (item.photos && item.photos.length > 0) ? item.photos : [item.photo_url];
  const rawData = item.raw_court_data;

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / SCREEN_WIDTH);
    if (nextIdx !== activePhotoIdx && nextIdx >= 0 && nextIdx < photos.length) {
      setActivePhotoIdx(nextIdx);
    }
  };

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
        {/* 상단 다중 사진 좌우 스와이프 갤러리 */}
        <View style={styles.galleryBox}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onPhotoScroll}
            scrollEventThrottle={16}
            style={styles.galleryScroll}
          >
            {photos.map((pUrl, idx) => (
              <Image
                key={idx}
                source={{ uri: pUrl }}
                style={styles.galleryImage}
                resizeMode="cover"
              />
            ))}
          </ScrollView>

          {/* 좌측 상단 안전등급 뱃지 */}
          <View style={styles.badgeWrap}>{renderBadge(item.safety_grade)}</View>

          {/* 좌측 하단 D-Day */}
          <View style={styles.dDayWrap}>
            <Text style={styles.dDayText}>{item.d_day}</Text>
          </View>

          {/* 우측 하단 사진 카운터 */}
          {photos.length > 1 && (
            <View style={styles.photoCountWrap}>
              <Text style={styles.photoCountText}>
                📷 {activePhotoIdx + 1} / {photos.length}
              </Text>
            </View>
          )}
        </View>

        {/* 핵심 브리핑 본문 */}
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

          {/* 4. 법원 원문 데이터 접이식(아코디언) 섹션 */}
          <View style={styles.accordionCard}>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setIsRawExpanded(!isRawExpanded)}
              activeOpacity={0.7}
            >
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>📋</Text>
                <View>
                  <Text style={styles.accordionTitle}>법원 원본 데이터 투명 공개</Text>
                  <Text style={styles.accordionSubtitle}>
                    {isRawExpanded ? '터치하여 접기' : '대법원 공적장부 원문 근거 확인'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionArrow}>{isRawExpanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {isRawExpanded && (
              <View style={styles.accordionBody}>
                {/* 등기부 권리 내역 전체 */}
                <View style={styles.rawSection}>
                  <Text style={styles.rawSectionTitle}>📑 등기부 권리 내역 (갑구/을구)</Text>
                  {rawData?.rights_list && rawData.rights_list.length > 0 ? (
                    <View style={styles.rawRightsTable}>
                      {rawData.rights_list.map((r, rIdx) => (
                        <View key={rIdx} style={styles.rawRightItem}>
                          <View style={styles.rawRightHeader}>
                            <View style={styles.rawRightBadge}>
                              <Text style={styles.rawRightBadgeText}>
                                {r.type || r.name || '권리'}
                              </Text>
                            </View>
                            {r.is_standard_right && (
                              <View style={styles.standardRightTag}>
                                <Text style={styles.standardRightTagText}>말소기준권리</Text>
                              </View>
                            )}
                            <Text style={styles.rawRightDate}>{r.registration_date || '-'}</Text>
                          </View>
                          <View style={styles.rawRightDetails}>
                            <Text style={styles.rawRightRow}>
                              <Text style={styles.rawRightKey}>권리자: </Text>
                              <Text style={styles.rawRightVal}>{r.right_holder || '미상'}</Text>
                            </Text>
                            {r.claim_amount && (
                              <Text style={styles.rawRightRow}>
                                <Text style={styles.rawRightKey}>채권액: </Text>
                                <Text style={styles.rawRightVal}>
                                  {typeof r.claim_amount === 'number'
                                    ? `${(r.claim_amount / 10000).toLocaleString()}만원`
                                    : r.claim_amount}
                                </Text>
                              </Text>
                            )}
                            {r.remarks && (
                              <Text style={styles.rawRightRemarks}>{r.remarks}</Text>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.rawEmptyText}>등록된 등기부 권리 내역이 없습니다.</Text>
                  )}
                </View>

                {/* 현황조사서 임차인 상세 */}
                <View style={styles.rawSection}>
                  <Text style={styles.rawSectionTitle}>🏠 현황조사서 임차인 현황</Text>
                  <View style={styles.rawTenantBox}>
                    <View style={styles.rawTenantRow}>
                      <Text style={styles.rawTenantKey}>전입일자</Text>
                      <Text style={styles.rawTenantVal}>
                        {rawData?.tenant_registration_date || '전입 세대 미상/없음'}
                      </Text>
                    </View>
                    <View style={styles.rawTenantRow}>
                      <Text style={styles.rawTenantKey}>보증금</Text>
                      <Text style={styles.rawTenantVal}>
                        {rawData?.tenant_deposit && rawData.tenant_deposit > 0
                          ? rawData.tenant_deposit_str
                          : '0원 (확인된 보증금 없음)'}
                      </Text>
                    </View>
                    <View style={styles.rawTenantRow}>
                      <Text style={styles.rawTenantKey}>배당요구 신청</Text>
                      <Text
                        style={[
                          styles.rawTenantVal,
                          rawData?.is_payout_requested ? styles.payoutYes : styles.payoutNo,
                        ]}
                      >
                        {rawData?.is_payout_requested ? '신청 완료 (배당요구함)' : '신청 내역 없음'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 매각물건명세서 비고 & 특수조건 */}
                <View style={styles.rawSection}>
                  <Text style={styles.rawSectionTitle}>📝 매각물건명세서 비고 및 특수조건</Text>
                  {rawData?.special_rights && rawData.special_rights.length > 0 && (
                    <View style={styles.specialTagsRow}>
                      {rawData.special_rights.map((tag, tIdx) => (
                        <View key={tIdx} style={styles.specialTagPill}>
                          <Text style={styles.specialTagText}>⚠️ {tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.remarksBox}>
                    <Text style={styles.remarksText}>
                      {rawData?.remarks?.trim() || '법원 매각물건명세서상 특별한 비고 기재사항이 없습니다.'}
                    </Text>
                  </View>
                </View>

                {/* 데이터 출처 고지 */}
                <Text style={styles.rawDisclaimer}>
                  ※ 본 정보는 대한민국 법원경매정보(courtauction.go.kr)에서 수집된 공식 장부 원본입니다.
                </Text>
              </View>
            )}
          </View>

          {/* 5. 법원 및 입찰 안내 메타 정보 */}
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
  galleryBox: {
    width: '100%',
    height: 250,
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  galleryScroll: {
    width: '100%',
    height: '100%',
  },
  galleryImage: {
    width: SCREEN_WIDTH,
    height: 250,
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
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  dDayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  photoCountWrap: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
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
  /* 접이식 법원 원문 데이터 스타일 */
  accordionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    backgroundColor: '#f8fafc',
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accordionIcon: {
    fontSize: 20,
  },
  accordionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  accordionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  accordionArrow: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '800',
  },
  accordionBody: {
    padding: 18,
    gap: 18,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  rawSection: {
    gap: 8,
  },
  rawSectionTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#1e293b',
  },
  rawRightsTable: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rawRightItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
    gap: 4,
  },
  rawRightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rawRightBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rawRightBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3730a3',
  },
  standardRightTag: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  standardRightTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991b1b',
  },
  rawRightDate: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginLeft: 'auto',
  },
  rawRightDetails: {
    gap: 2,
    paddingLeft: 4,
  },
  rawRightRow: {
    fontSize: 12,
  },
  rawRightKey: {
    color: '#64748b',
    fontWeight: '600',
  },
  rawRightVal: {
    color: '#1e293b',
    fontWeight: '700',
  },
  rawRightRemarks: {
    fontSize: 11,
    color: '#475569',
    backgroundColor: '#f1f5f9',
    padding: 4,
    borderRadius: 4,
    marginTop: 2,
  },
  rawEmptyText: {
    fontSize: 12,
    color: '#94a3b8',
    padding: 10,
  },
  rawTenantBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  rawTenantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rawTenantKey: {
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: '600',
  },
  rawTenantVal: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '700',
  },
  payoutYes: {
    color: '#16a34a',
  },
  payoutNo: {
    color: '#64748b',
  },
  specialTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  specialTagPill: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  specialTagText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '800',
  },
  remarksBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  remarksText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  rawDisclaimer: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 15,
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
