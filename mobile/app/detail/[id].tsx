import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Linking,
  Modal,
  Pressable,
  TextInput,
  Platform,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FeedItem, TenantRecord } from '../../types/feed';
import { useFavorites } from '../../context/FavoritesContext';
import { formatDDayLabel } from '../../utils/formatDDay';
import { getSourceBadgeMeta, isOnbidItem, isOnbidLease } from '../../utils/sourceBadge';
import { isFreePreviewCase } from '../../utils/curation';

const feedData = require('../../assets/mobile_feed.json');

type LoanPreset = 'normal' | 'first_home' | 'conservative';
type TargetYieldMode = '6' | '8' | '10' | 'custom';

const INVITE_STORAGE_KEY = 'easy_auction_invite_unlocked';
const VALID_INVITE_CODE = 'EASYBID2026';
const DEFAULT_LOAN_INTEREST_RATE = 0.045; // 연 4.5% 참고 금리

function formatKrw(val: number): string {
  if (!val || val <= 0) return '0원';
  const rounded = Math.round(val / 10_000) * 10_000;
  const eok = Math.floor(rounded / 100_000_000);
  const man = Math.floor((rounded % 100_000_000) / 10_000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${eok}억원`;
  return `${man.toLocaleString()}만원`;
}

function safeParseArray(input: unknown): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (typeof input === 'object') return [input];
  return [];
}

interface NormalizedRight {
  title: string;
  date: string;
  holder: string;
  claimStr: string;
  isStandard: boolean;
  remarks: string;
}

function normalizeRightsList(input: unknown, malsoDate?: string): NormalizedRight[] {
  const arr = safeParseArray(input);
  return arr
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          title: entry,
          date: '',
          holder: '',
          claimStr: '',
          isStandard: false,
          remarks: '',
        };
      }
      if (!entry || typeof entry !== 'object') return null;
      const r = entry as Record<string, any>;
      const title = String(r.type || r.name || r.right_name || '등기 권리').trim();
      const date = String(r.date || r.registration_date || r.reg_date || '').trim();
      const holder = String(r.right_holder || r.holder || '').trim();
      let claimStr = '';
      if (typeof r.claim_amount === 'number' && r.claim_amount > 0) {
        claimStr = formatKrw(r.claim_amount);
      } else if (typeof r.claim_amount === 'string' && r.claim_amount.trim()) {
        claimStr = r.claim_amount.trim();
      }
      const normD = date.replace(/[^0-9]/g, '');
      const normM = (malsoDate || '').replace(/[^0-9]/g, '');
      const isStandard = Boolean(r.is_standard_right) || (Boolean(normD) && Boolean(normM) && normD === normM);
      const remarks = typeof r.remarks === 'string' ? r.remarks.trim() : '';
      return { title, date, holder, claimStr, isStandard, remarks };
    })
    .filter((x): x is NormalizedRight => x !== null && Boolean(x.title));
}

interface NormalizedSpecialRight {
  icon: string;
  title: string;
  desc: string;
  riskLevel: string;
}

function normalizeSpecialRights(input: unknown): NormalizedSpecialRight[] {
  const arr = safeParseArray(input);
  return arr
    .map((entry) => {
      if (typeof entry === 'string') {
        return { icon: '⚠️', title: entry.trim(), desc: '', riskLevel: 'HIGH' };
      }
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, any>;
      const title = String(obj.name || obj.short || obj.id || '특수권리 주의').trim();
      const icon = String(obj.icon || '⚠️').trim();
      const desc = String(obj.desc || obj.description || '').trim();
      const riskLevel = String(obj.risk_level || 'HIGH').toUpperCase();
      return { icon, title, desc, riskLevel };
    })
    .filter((x): x is NormalizedSpecialRight => x !== null && Boolean(x.title));
}

interface RemarkSection {
  heading: string;
  body: string;
}

function parseRemarkSections(rawRemarks?: string): RemarkSection[] {
  const text = (rawRemarks || '').trim();
  if (!text) return [];
  const regex = /\[([^\]]+)\]/g;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) {
    return [{ heading: '매각물건명세서 원문', body: text }];
  }
  const sections: RemarkSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    if (body) {
      sections.push({ heading, body });
    }
  }
  return sections.length > 0 ? sections : [{ heading: '매각물건명세서 원문', body: text }];
}

function getBangGongje(location: string, usage: string): { amount: number; regionLabel: string } {
  const isNonResidential = usage === '상가' || usage === '토지';
  if (isNonResidential) {
    return { amount: 0, regionLabel: '비주거(방공제 미적용)' };
  }
  const loc = location || '';
  if (loc.includes('서울')) {
    return { amount: 55_000_000, regionLabel: '서울 5,500만원' };
  }
  const metroOvercrowded = [
    '인천', '성남', '분당', '수원', '용인', '안양', '과천', '광명', '의왕', '군포',
    '부천', '시흥', '고양', '일산', '하남', '구리', '남양주', '의정부', '화성', '김포', '파주', '경기',
  ];
  if (metroOvercrowded.some((kw) => loc.includes(kw))) {
    return { amount: 48_000_000, regionLabel: '경기·인천 과밀억제 4,800만원' };
  }
  return { amount: 28_000_000, regionLabel: '기타 지역 2,800만원' };
}

export default function DetailScreen() {
  const router = useRouter();
  const { width: winWidth } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [loanPreset, setLoanPreset] = useState<LoanPreset>('normal');
  const [mciExempt, setMciExempt] = useState(false);
  const [isRawExpanded, setIsRawExpanded] = useState(false);
  const [showAllTenants, setShowAllTenants] = useState(false);
  const [isFullRawJsonOpen, setIsFullRawJsonOpen] = useState(false);

  // 5단계: 초대 코드 잠금 해제 상태 (AsyncStorage + localStorage 영구 저장)
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem(INVITE_STORAGE_KEY) === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [inviteError, setInviteError] = useState('');

  // 5단계: 목표 수익률별 적정 입찰 상한가 역산 계산기 상태
  const [targetYieldMode, setTargetYieldMode] = useState<TargetYieldMode>('8');
  const [customYieldInput, setCustomYieldInput] = useState('7.5');

  const photoScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const caseNumber = decodeURIComponent(id || '');
  const items: FeedItem[] = feedData.items || [];
  const item = items.find((i) => i.case_number === caseNumber);

  // 보증금/월세(만원) 입력값 — 인근 시세 매칭 시 자동 프리필, 미매칭 시 참고 입력값 제공
  const defaultDepositMan = useMemo(() => {
    if (!item) return '2000';
    if (item.rental_estimate?.est_deposit && item.rental_estimate.est_deposit > 0) {
      return String(Math.round(item.rental_estimate.est_deposit / 10_000));
    }
    return String(Math.max(1000, Math.round((item.min_bid * 0.05) / 1_000_000) * 100));
  }, [item]);

  const defaultMonthlyMan = useMemo(() => {
    if (!item) return '80';
    if (item.rental_estimate?.est_monthly_rent && item.rental_estimate.est_monthly_rent > 0) {
      return String(Math.round(item.rental_estimate.est_monthly_rent / 10_000));
    }
    return String(Math.max(40, Math.round(((item.min_bid * 0.045) / 12) / 100_000) * 10));
  }, [item]);

  const [depositManInput, setDepositManInput] = useState(defaultDepositMan);
  const [monthlyRentManInput, setMonthlyRentManInput] = useState(defaultMonthlyMan);

  useEffect(() => {
    setDepositManInput(defaultDepositMan);
    setMonthlyRentManInput(defaultMonthlyMan);
  }, [defaultDepositMan, defaultMonthlyMan]);

  // AsyncStorage / localStorage에서 초대 코드 해제 여부 로드
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          if (window.localStorage.getItem(INVITE_STORAGE_KEY) === 'true') {
            if (mounted) setIsUnlocked(true);
            return;
          }
        }
        const saved = await AsyncStorage.getItem(INVITE_STORAGE_KEY);
        if (mounted && saved === 'true') {
          setIsUnlocked(true);
        }
      } catch {
        // ignore storage errors
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const isFreePreview = useMemo(() => {
    if (!caseNumber) return false;
    return isFreePreviewCase(items, caseNumber);
  }, [items, caseNumber]);

  const handleSubmitInviteCode = async () => {
    const normalized = inviteCodeInput.trim().toUpperCase();
    if (normalized !== VALID_INVITE_CODE) {
      setInviteError('초대 코드가 올바르지 않습니다. 다시 확인해 주세요.');
      return;
    }
    setInviteError('');
    setIsUnlocked(true);
    setInviteModalVisible(false);
    setInviteCodeInput('');
    try {
      await AsyncStorage.setItem(INVITE_STORAGE_KEY, 'true');
    } catch {}
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(INVITE_STORAGE_KEY, 'true');
      } catch {}
    }
  };

  const galleryWidth = Math.min(winWidth, 640);

  // 필요 자기자본 시뮬레이션 계산 (현행 경락잔금대출/주담대 규제 + 방공제 차감/면제 반영)
  const equityCalc = useMemo(() => {
    if (!item) return null;
    const isNonResidential = item.usage === '상가' || item.usage === '토지';
    const basePrice = item.min_bid; // 최저가 낙찰 가정 시뮬레이션
    const appraisalBase = Math.min(basePrice, item.appraisal || basePrice);
    const bangInfo = getBangGongje(item.location, item.usage);

    let ltv = isNonResidential ? 0.6 : 0.7;
    let maxCap = Infinity;
    let presetDesc = isNonResidential
      ? '비주거(상가·토지) 일반 경락잔금 LTV 60% 참고 기준'
      : '일반 무주택·1주택 주담대/경락잔금 LTV 70% 참고 기준';

    if (loanPreset === 'first_home') {
      ltv = isNonResidential ? 0.6 : 0.8;
      maxCap = isNonResidential ? Infinity : 600_000_000;
      presetDesc = isNonResidential
        ? '비주거 물건은 생애최초 특례 미적용 (일반 LTV 60% 기준)'
        : '생애최초 주택구입 특례 LTV 80% (최대 6억 캡 · MCG 방공제 면제)';
    } else if (loanPreset === 'conservative') {
      ltv = 0.5;
      presetDesc = '규제지역·다주택 감안 보수적 LTV 50% 기준';
    }

    // 방공제(소액임차보증금) 실제 차감 여부: 생애최초 특례 또는 MCI 가입 시 면제
    const isBangExempt = isNonResidential || loanPreset === 'first_home' || mciExempt;
    const appliedBangGongje = isBangExempt ? 0 : bangInfo.amount;
    const bangStatusLabel = isNonResidential
      ? '비주거 미적용'
      : loanPreset === 'first_home'
      ? '생애최초 특례 면제 (0원)'
      : mciExempt
      ? 'MCI 보증보험 면제 (0원)'
      : `${bangInfo.regionLabel} 차감`;

    const rawLoan = Math.min(Math.floor(appraisalBase * ltv), maxCap);
    const estLoan = Math.max(0, rawLoan - appliedBangGongje);
    const pureEquity = Math.max(0, basePrice - estLoan);

    // 취득세·등기비·명도 예비비 추산
    const taxRate = isNonResidential ? 0.046 : basePrice <= 600_000_000 ? 0.013 : 0.025;
    const extraCost = Math.round((basePrice * taxRate + 2_000_000) / 100_000) * 100_000;
    const assumedDeposit = item.ai_analysis?.assumed_deposit || 0;
    const totalCashNeeded = pureEquity + extraCost + assumedDeposit;

    return {
      isNonResidential,
      ltv,
      maxCap,
      ltvPct: Math.round(ltv * 100),
      presetDesc,
      rawLoan,
      bangInfo,
      appliedBangGongje,
      isBangExempt,
      bangStatusLabel,
      estLoan,
      pureEquity,
      extraCost,
      assumedDeposit,
      totalCashNeeded,
    };
  }, [item, loanPreset, mciExempt]);

  // 5단계: 목표 수익률별 적정 입찰 상한가 역산 계산기
  // (인근 전월세 시세 또는 직접 입력 보증금/월세 · 취득세/부대비용 · 대출이자 4.5% · 방공제 · 선순위 인수금 반영)
  const reverseBidCalc = useMemo(() => {
    if (!item || !equityCalc) return null;

    const rawTarget =
      targetYieldMode === 'custom'
        ? parseFloat(customYieldInput.replace(/[^0-9.]/g, ''))
        : parseFloat(targetYieldMode);
    const targetYieldPct =
      Number.isFinite(rawTarget) && rawTarget >= 1 && rawTarget <= 30 ? rawTarget : 8;
    const targetYield = targetYieldPct / 100;

    const depMan = parseFloat(depositManInput.replace(/[^0-9.]/g, '')) || 0;
    const rentMan = parseFloat(monthlyRentManInput.replace(/[^0-9.]/g, '')) || 0;
    const depositWon = Math.max(0, Math.round(depMan * 10_000));
    const monthlyRentWon = Math.max(0, Math.round(rentMan * 10_000));
    const annualRent = monthlyRentWon * 12;

    const { isNonResidential, ltv, maxCap, appliedBangGongje, assumedDeposit } = equityCalc;

    const evalAtBid = (bid: number) => {
      const rawLoan = Math.min(Math.floor(bid * ltv), maxCap);
      const loan = Math.max(0, rawLoan - appliedBangGongje);
      const taxRate = isNonResidential ? 0.046 : bid <= 600_000_000 ? 0.013 : 0.025;
      const extraCost = Math.round((bid * taxRate + 2_000_000) / 100_000) * 100_000;
      const annualInterest = Math.round(loan * DEFAULT_LOAN_INTEREST_RATE);
      const netAnnualIncome = annualRent - annualInterest;
      const grossCashNeeded = Math.max(0, bid - loan) + extraCost + assumedDeposit;
      const netInvestCash = grossCashNeeded - depositWon;
      return { loan, extraCost, annualInterest, netAnnualIncome, grossCashNeeded, netInvestCash };
    };

    if (annualRent <= 0) {
      return {
        targetYieldPct,
        depositWon,
        monthlyRentWon,
        maxBid: 0,
        feasible: false,
        loan: 0,
        extraCost: 0,
        annualInterest: 0,
        netAnnualIncome: 0,
        grossCashNeeded: 0,
        netInvestCash: 0,
        diffVsMinBid: -item.min_bid,
        ratioOfAppraisal: 0,
      };
    }

    // 단조감소 함수(입찰가 ↑ => 이자 ↑, 실투자금 ↑ => 수익률 ↓)에 대한 이분탐색으로 최대 입찰 상한가 정밀 역산
    let lo = 0;
    let hi = Math.max(item.appraisal * 2.5, item.min_bid * 3, 5_000_000_000);
    for (let iter = 0; iter < 48; iter++) {
      const mid = (lo + hi) / 2;
      const r = evalAtBid(mid);
      const meets =
        r.netAnnualIncome > 0 &&
        (r.netInvestCash <= 0 || r.netAnnualIncome / r.netInvestCash >= targetYield);
      if (meets) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const maxBid = Math.max(0, Math.floor(lo / 1_000_000) * 1_000_000);
    const atMax = evalAtBid(maxBid);
    const ratioOfAppraisal =
      item.appraisal > 0 ? Math.round((maxBid / item.appraisal) * 100) : 0;

    return {
      targetYieldPct,
      depositWon,
      monthlyRentWon,
      maxBid,
      feasible: maxBid >= 10_000_000 && atMax.netAnnualIncome > 0,
      loan: atMax.loan,
      extraCost: atMax.extraCost,
      annualInterest: atMax.annualInterest,
      netAnnualIncome: atMax.netAnnualIncome,
      grossCashNeeded: atMax.grossCashNeeded,
      netInvestCash: Math.max(0, atMax.netInvestCash),
      diffVsMinBid: maxBid - item.min_bid,
      ratioOfAppraisal,
    };
  }, [item, equityCalc, targetYieldMode, customYieldInput, depositManInput, monthlyRentManInput]);

  if (!item || !equityCalc) {
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
  const sourceMeta = getSourceBadgeMeta(item);
  const isLease = isOnbidLease(item);
  const isOnbid = isOnbidItem(item);
  const isPremiumLocked = !isLease && !isFreePreview && !isUnlocked;
  const onbid = item.onbid_info;
  const photos = item.photos && item.photos.length > 0 ? item.photos : [item.photo_url];
  const rawData = item.raw_court_data;
  const ai = item.ai_analysis;
  const rental = item.rental_estimate;
  const areaStats = item.area_winning_stats;
  const bidHistory = item.bid_history || [];

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / galleryWidth);
    if (nextIdx !== activePhotoIdx && nextIdx >= 0 && nextIdx < photos.length) {
      setActivePhotoIdx(nextIdx);
    }
  };

  const jumpPhoto = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= photos.length) return;
    setActivePhotoIdx(nextIdx);
    photoScrollRef.current?.scrollTo({ x: nextIdx * galleryWidth, animated: true });
  };

  const renderDifficultyBadge = (grade: string) => {
    if (grade === 'GREEN') {
      return (
        <View style={[styles.badge, styles.badgeGreen]}>
          <Text style={styles.badgeTextGreen}>🟢 초급 · 권리 심플 (인수 0원)</Text>
        </View>
      );
    }
    if (grade === 'YELLOW') {
      return (
        <View style={[styles.badge, styles.badgeYellow]}>
          <Text style={styles.badgeTextYellow}>🟡 중급 · 권리 체크 필요</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeRed]}>
        <Text style={styles.badgeTextRed}>🔴 고수 · 복잡 권리 / 하이리턴</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageInner}>
          {/* 1. 상단 감정평가서 다중 사진 좌우 스와이프 갤러리 */}
          <View style={[styles.galleryBox, { width: galleryWidth }]}>
            <ScrollView
              ref={photoScrollRef}
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
                  style={[styles.galleryImage, { width: galleryWidth }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>

            <View style={styles.badgeWrap}>
              <View
                style={[
                  styles.sourceBadgeDetail,
                  { backgroundColor: sourceMeta.bg, borderColor: sourceMeta.border },
                ]}
              >
                <Text style={[styles.sourceBadgeDetailText, { color: sourceMeta.text }]}>
                  {sourceMeta.label}
                </Text>
              </View>
              {isLease ? (
                <View style={[styles.badge, styles.badgeGreen]}>
                  <Text style={styles.badgeTextGreen}>🔑 공공임대 · {onbid?.prpt_div || '공유재산'}</Text>
                </View>
              ) : (
                renderDifficultyBadge(item.safety_grade)
              )}
            </View>

            {/* 우상단 사진 출처 배지 (법원 감정평가서 N장 / 거리뷰 / 참고 이미지) */}
            <View style={styles.photoSourceWrap}>
              <Text style={styles.photoSourceText}>
                {item.photo_source_label ||
                  (photos.some((p) => p.includes('/photos/') && !p.includes('_sv.jpg'))
                    ? `🏛️ 법원 감정평가서 ${photos.length}장`
                    : photos.some((p) => p.includes('_sv.jpg'))
                    ? '🌐 거리뷰'
                    : '🖼️ 참고 이미지')}
              </Text>
            </View>

            <View style={styles.dDayWrap}>
              <Text style={styles.dDayText}>{formatDDayLabel(item.d_day)}</Text>
            </View>

            {photos.length > 1 && (
              <>
                {activePhotoIdx > 0 && (
                  <TouchableOpacity
                    style={[styles.photoArrowBtn, styles.photoArrowLeft]}
                    onPress={() => jumpPhoto(activePhotoIdx - 1)}
                  >
                    <Text style={styles.photoArrowText}>‹</Text>
                  </TouchableOpacity>
                )}
                {activePhotoIdx < photos.length - 1 && (
                  <TouchableOpacity
                    style={[styles.photoArrowBtn, styles.photoArrowRight]}
                    onPress={() => jumpPhoto(activePhotoIdx + 1)}
                  >
                    <Text style={styles.photoArrowText}>›</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.photoCountWrap}>
                  <Text style={styles.photoCountText}>
                    📷 {activePhotoIdx + 1} / {photos.length}
                  </Text>
                </View>
              </>
            )}
          </View>

          <View style={styles.contentWrap}>
            {/* 핵심 헤드라인 & 주소 */}
            <View style={styles.titleSection}>
              <Text style={styles.headlineText}>{item.headline}</Text>
              <Text style={styles.locationText}>
                {item.location} · {item.usage}
                {item.area_pyeong > 0 ? ` · ${item.area_pyeong}평` : ''}
              </Text>
            </View>

            {isLease ? (
              <>
                {/* 공매 임대 전용 핵심 임대 조건 카드 (감정가·최저입찰가·안전마진·매매 수익률 미적용) */}
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>🔑 공공임대(대부) 핵심 조건</Text>
                    <View style={styles.leasePill}>
                      <Text style={styles.leasePillText}>{onbid?.bid_status || '입찰진행중'}</Text>
                    </View>
                  </View>

                  <View style={styles.statGrid}>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>예정 사용료 (연/기간)</Text>
                      <Text style={styles.statValueLarge}>
                        {onbid?.annual_fee_str || item.min_bid_str}
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>월 환산 참고 사용료</Text>
                      <Text style={[styles.statValue, { color: '#047857' }]}>
                        {onbid?.est_monthly_fee_str ? `약 ${onbid.est_monthly_fee_str}/월` : '공고 확인'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.calcTable}>
                    <View style={styles.calcRow}>
                      <Text style={styles.calcKey}>보증금 / 입찰보증금</Text>
                      <Text style={styles.calcVal}>
                        {onbid?.deposit_note || '입찰보증금 5~10% (온비드 공고 확인)'}
                      </Text>
                    </View>
                    <View style={styles.calcRow}>
                      <Text style={styles.calcKey}>계약·임대(대부) 기간</Text>
                      <Text style={styles.calcVal}>
                        {onbid?.lease_period_note || '사용수익허가/대부 (통상 1~5년 · 공고문 확인)'}
                      </Text>
                    </View>
                    <View style={styles.calcRow}>
                      <Text style={styles.calcKey}>공고기관 · 재산구분</Text>
                      <Text style={styles.calcVal}>
                        {onbid?.reg_org_nm || item.court_name} · {onbid?.prpt_div || '공유재산'}
                      </Text>
                    </View>
                    <View style={styles.calcRow}>
                      <Text style={styles.calcKey}>입찰 기간</Text>
                      <Text style={styles.calcVal}>
                        {onbid?.bid_start_date && onbid?.bid_end_date
                          ? `${onbid.bid_start_date} ~ ${onbid.bid_end_date}`
                          : item.auction_date || '공고 확인'}
                      </Text>
                    </View>
                    {(onbid?.bld_area_m2 || onbid?.land_area_m2) ? (
                      <View style={[styles.calcRow, styles.calcRowLast]}>
                        <Text style={styles.calcKey}>면적 (건물 / 토지)</Text>
                        <Text style={styles.calcVal}>
                          {onbid.bld_area_m2 ? `건물 ${onbid.bld_area_m2}㎡` : ''}
                          {onbid.bld_area_m2 && onbid.land_area_m2 ? ' · ' : ''}
                          {onbid.land_area_m2 ? `토지 ${onbid.land_area_m2}㎡` : ''}
                        </Text>
                      </View>
                    ) : undefined}
                  </View>

                  <View style={styles.leaseNoticeBox}>
                    <Text style={styles.leaseNoticeText}>
                      ℹ️ 본 물건은 소유권 이전(매매)이 아닌 공공기관 임대(대부·사용수익허가) 공매입니다.
                      매매 전제 계산기(자기자본 LTV·방공제·매매 수익률)는 적용되지 않으며, 실제 계약기간·보증금·부가세·업종 제한은 온비드 원문 공고문을 확인하세요.
                    </Text>
                  </View>
                </View>

                {/* 온비드 원문 바로가기 */}
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>🏛️ 온비드 공고 원문 확인</Text>
                  <TouchableOpacity
                    style={styles.courtLinkBtn}
                    activeOpacity={0.85}
                    onPress={() => Linking.openURL(onbid?.detail_url || 'https://www.onbid.co.kr')}
                  >
                    <Text style={styles.courtLinkBtnText}>
                      🏛️ 캠코 온비드(onbid.co.kr) 공고 바로가기 ↗
                    </Text>
                    <Text style={styles.courtLinkSubText}>
                      물건관리번호 {onbid?.cltr_no || item.case_number} 직접 더블체크
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
            {/* 2. 가격 & 시세 대비 할인율 + 인근 낙찰 통계 */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>💰 가격 · 시세 할인 분석</Text>
                {item.discount_pct > 0 && (
                  <View style={styles.discountPill}>
                    <Text style={styles.discountPillText}>감정가 대비 -{item.discount_pct}%</Text>
                  </View>
                )}
              </View>

              <View style={styles.statGrid}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>최저 입찰가</Text>
                  <Text style={styles.statValueLarge}>{item.min_bid_str}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>{isOnbid ? '감정/예정가' : '감정 평가액'}</Text>
                  <Text style={styles.statValue}>{item.appraisal_str}</Text>
                </View>
                {item.market_price && item.market_price > 0 ? (
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>최근 실거래</Text>
                    <Text style={styles.statValue}>{item.market_price_str}</Text>
                  </View>
                ) : undefined}
              </View>

              {item.gap_amount > 0 && (
                <View style={styles.gapBanner}>
                  <Text style={styles.gapBannerText}>
                    {item.ref_price_name} 대비 약{' '}
                    <Text style={styles.gapBold}>{item.gap_amount_str}</Text> 저렴하게 시작합니다.
                  </Text>
                </View>
              )}

              {isOnbid && onbid && (
                <View style={styles.areaStatBanner}>
                  <Text style={styles.areaStatText}>
                    🏛️ 온비드 공고기관: <Text style={styles.areaStatBold}>{onbid.reg_org_nm} ({onbid.prpt_div})</Text>
                    {'\n'}📅 입찰기간: {onbid.bid_start_date} ~ {onbid.bid_end_date}
                  </Text>
                </View>
              )}

              {areaStats && (
                <View style={styles.areaStatBanner}>
                  <Text style={styles.areaStatText}>
                    🏆 인근 {areaStats.region_label} 최근 낙찰 {areaStats.sample_count}건 평균:{' '}
                    <Text style={styles.areaStatBold}>
                      낙찰가율 {areaStats.avg_winning_rate}% · 경쟁률 {areaStats.avg_bidder_count}명
                    </Text>
                  </Text>
                </View>
              )}
            </View>

            {/* 오늘의 추천 상위 2건 무료 맛보기 안내 배너 */}
            {isFreePreview && !isUnlocked && (
              <View style={styles.freePreviewBanner}>
                <Text style={styles.freePreviewBannerText}>
                  🎁 오늘의 추천 무료 맛보기 매물 · 초대 코드 없이 필요 현금·역산·수익률 전체 공개 중
                </Text>
              </View>
            )}

            {/* 5단계 프리미엄 잠금 래퍼 (필요 현금 계산기 · 목표 수익률별 상한가 역산 · 인근 전월세/수익률) */}
            <View style={isPremiumLocked ? styles.lockedSectionWrap : undefined}>
              <View pointerEvents={isPremiumLocked ? 'none' : 'auto'} style={{ gap: 16 }}>
            {/* 3. 필요 자기자본(현금) 계산기 (대출 규제 시뮬레이션) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🧮 필요 자기자본(현금) 계산기</Text>
              <Text style={styles.cardSubCaption}>
                최저가({item.min_bid_str}) 낙찰 가정 · 대출 조건을 눌러 비교해 보세요
              </Text>

              {/* 대출 조건 프리셋 3단 탭 */}
              <View style={styles.presetRow}>
                {(
                  [
                    { key: 'normal', label: '일반 LTV 70%' },
                    { key: 'first_home', label: '생애최초 80%' },
                    { key: 'conservative', label: '보수적 50%' },
                  ] as { key: LoanPreset; label: string }[]
                ).map((p) => {
                  const active = loanPreset === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.presetBtn, active && styles.presetBtnActive]}
                      onPress={() => setLoanPreset(p.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.presetBtnText, active && styles.presetBtnTextActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.presetDescText}>📌 {equityCalc.presetDesc}</Text>

              {/* 방공제 면제(MCI 보증보험) 토글 — 주거용 & 일반/보수적 LTV일 때 */}
              {!equityCalc.isNonResidential && loanPreset !== 'first_home' && (
                <TouchableOpacity
                  style={[styles.mciToggleRow, mciExempt && styles.mciToggleRowActive]}
                  onPress={() => setMciExempt(!mciExempt)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.mciCheckBox, mciExempt && styles.mciCheckBoxActive]}>
                    <Text style={styles.mciCheckMark}>{mciExempt ? '✓' : ''}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.mciToggleTitle}>
                      MCI·MCG 보증보험 가입 (방공제 {formatKrw(equityCalc.bangInfo.amount)} 면제)
                    </Text>
                    <Text style={styles.mciToggleSub}>
                      미가입 시 {equityCalc.bangInfo.regionLabel}이 대출 한도에서 자동 차감됩니다
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* 총 필요 현금 하이라이트 */}
              <View style={styles.totalCashHighlight}>
                <Text style={styles.totalCashLabel}>실제 필요한 총 현금 (자기자본+비용)</Text>
                <Text style={styles.totalCashValue}>{formatKrw(equityCalc.totalCashNeeded)}</Text>
              </View>

              {/* 세부 내역 행 */}
              <View style={styles.calcRows}>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>기본 LTV 한도 ({equityCalc.ltvPct}%)</Text>
                  <Text style={styles.calcVal}>{formatKrw(equityCalc.rawLoan)}</Text>
                </View>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>소액임차보증금(방공제)</Text>
                  <Text
                    style={
                      equityCalc.appliedBangGongje > 0 ? styles.calcValRed : styles.calcValGreen
                    }
                  >
                    {equityCalc.appliedBangGongje > 0
                      ? `- ${formatKrw(equityCalc.appliedBangGongje)} (${equityCalc.bangInfo.regionLabel.split(' ')[0]})`
                      : equityCalc.bangStatusLabel}
                  </Text>
                </View>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>실제 예상 경락잔금대출</Text>
                  <Text style={styles.calcValBlue}>- {formatKrw(equityCalc.estLoan)}</Text>
                </View>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>순수 자기자본 (잔금 현금)</Text>
                  <Text style={styles.calcVal}>{formatKrw(equityCalc.pureEquity)}</Text>
                </View>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>취득세·등기·명도 부대비용 (추산)</Text>
                  <Text style={styles.calcVal}>+ {formatKrw(equityCalc.extraCost)}</Text>
                </View>
                <View style={styles.calcRow}>
                  <Text style={styles.calcKey}>낙찰자 인수 보증금</Text>
                  <Text
                    style={[
                      styles.calcVal,
                      equityCalc.assumedDeposit > 0 ? styles.calcValRed : styles.calcValGreen,
                    ]}
                  >
                    {equityCalc.assumedDeposit > 0
                      ? `+ ${formatKrw(equityCalc.assumedDeposit)} (주의)`
                      : '0원 (인수 없음)'}
                  </Text>
                </View>
                <View style={[styles.calcRow, styles.calcRowLast]}>
                  <Text style={styles.calcKey}>입찰 당일 보증금 (10%, 수표)</Text>
                  <Text style={styles.calcValBold}>{item.deposit_required_str}</Text>
                </View>
              </View>

              <Text style={styles.disclaimerText}>
                ※ 현행 지역별 방공제(서울 5,500만 · 경기/인천 과밀억제 4,800만 · 기타 2,800만)를 반영한 참고 시뮬레이션이며, 실제 대출 한도는 DSR·은행별 MCI 취급 여부·개인 신용도에 따라 달라질 수 있습니다.
              </Text>
            </View>

            {/* 3.5. 목표 수익률별 적정 입찰 상한가 역산 계산기 (5단계) */}
            {reverseBidCalc && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>🎯 목표 수익률별 적정 입찰 상한가</Text>
                  <View style={styles.targetYieldPill}>
                    <Text style={styles.targetYieldPillText}>
                      목표 연 {reverseBidCalc.targetYieldPct}%
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardSubCaption}>
                  {rental
                    ? `📊 인근 전·월세 시세(${rental.source_label}) 자동 반영 · 세금·대출이자(연 4.5%)·방공제 기준 역산`
                    : '✏️ 인근 시세 미매칭 매물 · 예상 보증금/월세(만원)를 직접 수정하면 즉시 역산됩니다'}
                </Text>

                {/* 목표 수익률 4단 선택 [6% | 8% | 10% | 직접입력] */}
                <View style={styles.presetRow}>
                  {(
                    [
                      { key: '6', label: '6%' },
                      { key: '8', label: '8%' },
                      { key: '10', label: '10%' },
                      { key: 'custom', label: '직접입력' },
                    ] as { key: TargetYieldMode; label: string }[]
                  ).map((opt) => {
                    const active = targetYieldMode === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.presetBtn, active && styles.presetBtnActive]}
                        onPress={() => setTargetYieldMode(opt.key)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.presetBtnText, active && styles.presetBtnTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {targetYieldMode === 'custom' && (
                  <View style={styles.customYieldRow}>
                    <Text style={styles.customYieldLabel}>목표 연 수익률 (%)</Text>
                    <TextInput
                      style={styles.customYieldInput}
                      value={customYieldInput}
                      onChangeText={setCustomYieldInput}
                      keyboardType="decimal-pad"
                      placeholder="예: 7.5"
                      placeholderTextColor="#94a3b8"
                      maxLength={5}
                    />
                  </View>
                )}

                {/* 보증금 · 월세 입력 행 (만원 단위, 자유 수정 가능) */}
                <View style={styles.rentInputsRow}>
                  <View style={styles.rentInputBox}>
                    <Text style={styles.rentInputLabel}>임대 보증금 (만원)</Text>
                    <TextInput
                      style={styles.rentInputField}
                      value={depositManInput}
                      onChangeText={setDepositManInput}
                      keyboardType="numeric"
                      placeholder="2000"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <View style={styles.rentInputBox}>
                    <Text style={styles.rentInputLabel}>예상 월세 (만원)</Text>
                    <TextInput
                      style={styles.rentInputField}
                      value={monthlyRentManInput}
                      onChangeText={setMonthlyRentManInput}
                      keyboardType="numeric"
                      placeholder="80"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                </View>

                {/* 역산 결과 하이라이트 */}
                {reverseBidCalc.feasible ? (
                  <>
                    <View style={styles.reverseHighlightBox}>
                      <View style={styles.reverseHighlightCol}>
                        <Text style={styles.reverseHighlightLabel}>최대 입찰 상한가</Text>
                        <Text style={styles.reverseHighlightVal}>
                          {formatKrw(reverseBidCalc.maxBid)}
                        </Text>
                        {reverseBidCalc.ratioOfAppraisal > 0 && (
                          <Text style={styles.reverseHighlightSub}>
                            감정가 대비 {reverseBidCalc.ratioOfAppraisal}%
                          </Text>
                        )}
                      </View>
                      <View style={styles.reverseHighlightDivider} />
                      <View style={styles.reverseHighlightCol}>
                        <Text style={styles.reverseHighlightLabel}>필요 자기자본 (실투자금)</Text>
                        <Text style={styles.reverseHighlightCash}>
                          {formatKrw(reverseBidCalc.netInvestCash)}
                        </Text>
                        <Text style={styles.reverseHighlightSub}>임대보증금 회수 반영</Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.reverseCompareBanner,
                        reverseBidCalc.diffVsMinBid >= 0
                          ? styles.reverseCompareOk
                          : styles.reverseCompareWarn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reverseCompareText,
                          reverseBidCalc.diffVsMinBid >= 0
                            ? styles.reverseCompareTextOk
                            : styles.reverseCompareTextWarn,
                        ]}
                      >
                        {reverseBidCalc.diffVsMinBid >= 0
                          ? `✅ 현재 최저가(${item.min_bid_str}) 대비 +${formatKrw(
                              reverseBidCalc.diffVsMinBid
                            )} 입찰 여유가 있습니다.`
                          : `⚠️ 현재 최저가(${item.min_bid_str})보다 ${formatKrw(
                              Math.abs(reverseBidCalc.diffVsMinBid)
                            )} 낮습니다. 추가 유찰 대기 또는 임대 조건 재검토를 권장합니다.`}
                      </Text>
                    </View>

                    <View style={styles.calcRows}>
                      <View style={styles.calcRow}>
                        <Text style={styles.calcKey}>
                          상한가 기준 예상 대출 ({equityCalc.ltvPct}% · 방공제 반영)
                        </Text>
                        <Text style={styles.calcValBlue}>{formatKrw(reverseBidCalc.loan)}</Text>
                      </View>
                      <View style={styles.calcRow}>
                        <Text style={styles.calcKey}>취득세·등기·명도 부대비용</Text>
                        <Text style={styles.calcVal}>{formatKrw(reverseBidCalc.extraCost)}</Text>
                      </View>
                      <View style={styles.calcRow}>
                        <Text style={styles.calcKey}>연 대출이자 (연 4.5% 가정)</Text>
                        <Text style={styles.calcValRed}>
                          - {formatKrw(reverseBidCalc.annualInterest)}/년
                        </Text>
                      </View>
                      <View style={[styles.calcRow, styles.calcRowLast]}>
                        <Text style={styles.calcKey}>연 순수익 (이자 차감 후)</Text>
                        <Text style={styles.calcValGreen}>
                          {formatKrw(reverseBidCalc.netAnnualIncome)}/년 (월 약{' '}
                          {formatKrw(Math.round(reverseBidCalc.netAnnualIncome / 12))})
                        </Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={styles.noRentalBox}>
                    <Text style={styles.noRentalTitle}>
                      목표 연 {reverseBidCalc.targetYieldPct}% 달성 상한가 산출 불가
                    </Text>
                    <Text style={styles.noRentalDesc}>
                      입력된 월세 대비 대출이자·인수 보증금 부담이 커서 목표 수익률을 충족하기 어렵습니다. 예상 월세·보증금 또는 목표 수익률을 조정해 보세요.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* 4. 인근 전월세 시세 & 예상 수익률 */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>📊 인근 전·월세 시세 & 예상 수익률</Text>
                {rental && (
                  <View style={styles.yieldPill}>
                    <Text style={styles.yieldPillText}>연 {rental.annual_yield_pct}%</Text>
                  </View>
                )}
              </View>

              {rental ? (
                <>
                  <Text style={styles.rentalSourceText}>
                    데이터 근거: {rental.source_label} ({rental.sample_count}건 기준)
                  </Text>

                  <View style={styles.rentalGrid}>
                    <View style={styles.rentalBox}>
                      <Text style={styles.rentalLabel}>예상 보증금</Text>
                      <Text style={styles.rentalVal}>{rental.est_deposit_str}</Text>
                    </View>
                    <View style={styles.rentalBox}>
                      <Text style={styles.rentalLabel}>예상 월세</Text>
                      <Text style={styles.rentalValBlue}>{rental.est_monthly_rent_str}</Text>
                    </View>
                  </View>

                  {rental.est_jeonse > 0 && (
                    <View style={styles.gapInvestBox}>
                      <View style={styles.calcRow}>
                        <Text style={styles.calcKey}>추정 전세가 (전환율 5.5% 참고)</Text>
                        <Text style={styles.calcVal}>{rental.est_jeonse_str}</Text>
                      </View>
                      <View style={[styles.calcRow, styles.calcRowLast]}>
                        <Text style={styles.calcKey}>전세 갭투자 예상 필요금</Text>
                        <Text style={styles.calcValBlue}>{rental.gap_invest_cash_str}</Text>
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.noRentalBox}>
                  <Text style={styles.noRentalTitle}>인근 전·월세 시세 추정 불가</Text>
                  <Text style={styles.noRentalDesc}>
                    현재 DB(네이버 부동산·현황조사서)에 이 물건과 동일 용도·유사 평형의 검증된 임대 표본이 부족해 수익률을 억지로 추정하지 않았습니다. 입찰 전 인근 부동산 시세를 직접 확인해 주세요.
                  </Text>
                </View>
              )}
            </View>
              </View>

              {/* 5단계: 초대 코드 그라데이션 블러 잠금 오버레이 */}
              {isPremiumLocked && (
                <View
                  style={[
                    styles.blurVeilOverlay,
                    Platform.OS === 'web'
                      ? ({
                          backgroundImage:
                            'linear-gradient(to bottom, rgba(248,250,252,0.08) 0%, rgba(248,250,252,0.78) 32%, rgba(248,250,252,0.96) 62%, #f8fafc 100%)',
                          backdropFilter: 'blur(6px)',
                          WebkitBackdropFilter: 'blur(6px)',
                        } as any)
                      : styles.blurVeilNativeFallback,
                  ]}
                >
                  <View style={styles.lockCardBox}>
                    <Text style={styles.lockCardTitle}>
                      필요 현금 · 적정 입찰가 역산 · 예상 수익률
                    </Text>
                    <Text style={styles.lockCardSub}>
                      초대 코드를 한 번만 입력하면 모든 매물이 영구 해제됩니다
                    </Text>
                    <TouchableOpacity
                      style={styles.unlockCtaBtn}
                      activeOpacity={0.85}
                      onPress={() => {
                        setInviteError('');
                        setInviteModalVisible(true);
                      }}
                    >
                      <Text style={styles.unlockCtaBtnText}>🔓 초대 코드 입력하고 전체 보기</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* 5. AI 권리분석 리포트 & 말소기준권리 (기존 대시보드 알짜 기능 이식) */}
            {ai && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>🤖 AI 권리분석 리포트</Text>
                  {ai.score > 0 && (
                    <View style={styles.aiScorePill}>
                      <Text style={styles.aiScoreText}>
                        {ai.score}점 · {ai.grade || '분석완료'}등급
                      </Text>
                    </View>
                  )}
                </View>

                {ai.verdict ? (
                  <View style={styles.verdictBox}>
                    <Text style={styles.verdictText}>{ai.verdict}</Text>
                  </View>
                ) : undefined}

                {/* 말소기준권리 & 추천 입찰가 */}
                <View style={styles.malsoGrid}>
                  <View style={styles.malsoCard}>
                    <Text style={styles.malsoLabel}>말소기준권리</Text>
                    <Text style={styles.malsoVal}>
                      {ai.malso_right
                        ? `${ai.malso_right.name}\n(${ai.malso_right.date})`
                        : '등기부 원문 확인'}
                    </Text>
                  </View>
                  <View style={styles.malsoCard}>
                    <Text style={styles.malsoLabel}>AI 참고 입찰가</Text>
                    <Text style={styles.malsoValBlue}>
                      {ai.suggested_bid || item.min_bid_str}
                    </Text>
                  </View>
                </View>

                {/* 소멸 권리 vs 인수 권리 */}
                {(ai.extinguished_rights.length > 0 || ai.retained_rights.length > 0) && (
                  <View style={styles.rightsCompareBox}>
                    <View style={styles.rightsCompareRow}>
                      <Text style={styles.rightsCompareTagGreen}>소멸</Text>
                      <Text style={styles.rightsCompareText}>
                        {ai.extinguished_rights.join(', ') || '말소기준권리 이하 소멸'}
                      </Text>
                    </View>
                    <View style={styles.rightsCompareRow}>
                      <Text
                        style={
                          ai.retained_rights.length > 0 && ai.retained_rights[0] !== '없음'
                            ? styles.rightsCompareTagRed
                            : styles.rightsCompareTagGray
                        }
                      >
                        인수
                      </Text>
                      <Text style={styles.rightsCompareText}>
                        {ai.retained_rights.join(', ') || '없음'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* 핵심 포인트 & 리스크 */}
                {ai.key_points.length > 0 && (
                  <View style={styles.pointBlock}>
                    <Text style={styles.pointBlockTitle}>✅ 핵심 투자 포인트</Text>
                    {ai.key_points.map((pt, idx) => (
                      <Text key={idx} style={styles.pointText}>
                        • {pt}
                      </Text>
                    ))}
                  </View>
                )}
                {ai.risks.length > 0 && (
                  <View style={styles.pointBlock}>
                    <Text style={styles.pointBlockTitle}>⚠️ 체크해야 할 리스크</Text>
                    {ai.risks.map((rk, idx) => (
                      <Text key={idx} style={styles.riskText}>
                        • {rk}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* 6. 매각 기일(유찰) 히스토리 타임라인 */}
            {bidHistory.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>📉 매각 기일 · 유찰 히스토리</Text>
                  <Text style={styles.historySubTag}>유찰 {item.failed_count}회</Text>
                </View>

                <View style={styles.timelineList}>
                  {bidHistory.map((h, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.timelineRow,
                        h.is_current && styles.timelineRowCurrent,
                      ]}
                    >
                      <View
                        style={[
                          styles.timelineRoundBadge,
                          h.is_current && styles.timelineRoundBadgeCurrent,
                        ]}
                      >
                        <Text
                          style={[
                            styles.timelineRoundText,
                            h.is_current && styles.timelineRoundTextCurrent,
                          ]}
                        >
                          {h.round}차
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.timelinePrice,
                            h.is_current && styles.timelinePriceCurrent,
                          ]}
                        >
                          {h.price_str}
                        </Text>
                        <Text style={styles.timelineDate}>{h.date}</Text>
                      </View>
                      <View style={styles.timelineRight}>
                        <Text style={styles.timelineRatio}>{h.ratio_pct}%</Text>
                        <Text
                          style={[
                            styles.timelineStatus,
                            h.is_current && styles.timelineStatusCurrent,
                          ]}
                        >
                          {h.status}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* 7. 법원 원본 데이터 투명 공개 아코디언 */}
            {/* 7. 법원 원본 데이터 (경매) vs 온비드 원문 공고 바로가기 (공매 매각) */}
            {isOnbid ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>🏛️ 온비드 공매 원문 더블체크</Text>
                <Text style={styles.cardSubCaption}>
                  입찰 전 온비드 원문 공고문에서 배분요구 종기·명도·임차인·미납세금 조건을 꼭 확인하세요.
                </Text>
                <TouchableOpacity
                  style={[styles.courtLinkBtn, { marginTop: 10 }]}
                  activeOpacity={0.85}
                  onPress={() => Linking.openURL(onbid?.detail_url || 'https://www.onbid.co.kr')}
                >
                  <Text style={styles.courtLinkBtnText}>
                    🏛️ 캠코 온비드(onbid.co.kr) 공고 바로가기 ↗
                  </Text>
                  <Text style={styles.courtLinkSubText}>
                    물건관리번호 {onbid?.cltr_no || item.case_number} 직접 더블체크
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
            <View style={styles.accordionCard}>
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => setIsRawExpanded(!isRawExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.accordionTitleRow}>
                  <Text style={styles.accordionIcon}>📋</Text>
                  <View style={styles.accordionTitleTextWrap}>
                    <Text style={styles.accordionTitle}>법원 원본 데이터 투명 공개</Text>
                    <Text style={styles.accordionSubtitle}>
                      {isRawExpanded ? '터치하여 접기' : '등기부 · 현황조사서 · 명세서 비고 원문 보기'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.accordionArrow}>{isRawExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {isRawExpanded && (() => {
                const parsedRights = normalizeRightsList(rawData?.rights_list, ai?.malso_right?.date);
                const parsedSpecials = normalizeSpecialRights(rawData?.special_rights);
                const parsedRemarks = parseRemarkSections(rawData?.remarks);

                return (
                  <View style={styles.accordionBody}>
                    {/* 등기부 권리 내역 전체 */}
                    <View style={styles.rawSection}>
                      <Text style={styles.rawSectionTitle}>📑 등기부 권리 내역 (갑구/을구)</Text>
                      {parsedRights.length > 0 ? (
                        <View style={styles.rawRightsTable}>
                          {parsedRights.map((r, rIdx) => (
                            <View
                              key={rIdx}
                              style={[
                                styles.rawRightItem,
                                rIdx === parsedRights.length - 1 && styles.rawRightItemLast,
                              ]}
                            >
                              <View style={styles.rawRightHeader}>
                                <View style={styles.rawRightBadgeWrap}>
                                  <View style={styles.rawRightBadge}>
                                    <Text style={styles.rawRightBadgeText}>{r.title}</Text>
                                  </View>
                                  {r.isStandard && (
                                    <View style={styles.standardRightTag}>
                                      <Text style={styles.standardRightTagText}>말소기준권리</Text>
                                    </View>
                                  )}
                                </View>
                                <Text style={styles.rawRightDate}>{r.date || '일자 미상'}</Text>
                              </View>
                              {(r.holder || r.claimStr || r.remarks) && (
                                <View style={styles.rawRightDetails}>
                                  {r.holder ? (
                                    <Text style={styles.rawRightRow}>
                                      <Text style={styles.rawRightKey}>권리자: </Text>
                                      <Text style={styles.rawRightVal}>{r.holder}</Text>
                                    </Text>
                                  ) : undefined}
                                  {r.claimStr ? (
                                    <Text style={styles.rawRightRow}>
                                      <Text style={styles.rawRightKey}>채권액: </Text>
                                      <Text style={styles.rawRightVal}>{r.claimStr}</Text>
                                    </Text>
                                  ) : undefined}
                                  {r.remarks ? (
                                    <Text style={styles.rawRightRemarks}>{r.remarks}</Text>
                                  ) : undefined}
                                </View>
                              )}
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.rawEmptyText}>등록된 등기부 권리 내역이 없습니다.</Text>
                      )}
                    </View>

                    {/* 현황조사서 임차인 상세 (선순위 인수 보증금 vs 전체 조사된 임차인 현황 명확 구분) */}
                    {(() => {
                      const tenantsList: TenantRecord[] = Array.isArray(rawData?.tenants_list)
                        ? rawData.tenants_list
                        : [];
                      const seniorDep = rawData?.senior_assumed_deposit || ai?.assumed_deposit || 0;
                      const seniorUnknownCnt = rawData?.senior_unknown_count || ai?.senior_unknown_count || 0;
                      const visibleTenants = showAllTenants ? tenantsList : tenantsList.slice(0, 10);

                      return (
                        <View style={styles.rawSection}>
                          <Text style={styles.rawSectionTitle}>
                            🏠 현황조사서 임차인 현황 ({tenantsList.length}명)
                          </Text>

                          {/* A. 선순위 인수 보증금 요약 박스 */}
                          <View
                            style={[
                              styles.seniorSummaryBox,
                              (seniorDep > 0 || seniorUnknownCnt > 0) && styles.seniorSummaryBoxWarn,
                            ]}
                          >
                            <Text style={styles.seniorSummaryLabel}>선순위 인수 예상 보증금</Text>
                            <Text
                              style={[
                                styles.seniorSummaryVal,
                                (seniorDep > 0 || seniorUnknownCnt > 0) && styles.seniorSummaryValWarn,
                              ]}
                            >
                              {seniorDep > 0
                                ? `${formatKrw(seniorDep)}${
                                    seniorUnknownCnt > 0 ? ` + 미상 ${seniorUnknownCnt}명` : ''
                                  }`
                                : seniorUnknownCnt > 0
                                ? `선순위 임차인 ${seniorUnknownCnt}명 보증금 미상 (인수 위험 확인 필수)`
                                : '0원 (확인된 선순위 인수 보증금 없음)'}
                            </Text>
                          </View>

                          {/* B. 전체 조사된 임차인 목록 */}
                          {tenantsList.length > 0 ? (
                            <View style={styles.tenantsCardsList}>
                              {visibleTenants.map((t, tIdx) => (
                                <View key={tIdx} style={styles.tenantItemCard}>
                                  <View style={styles.tenantItemHeader}>
                                    <Text style={styles.tenantItemName}>
                                      {t.name}
                                      {t.room ? ` · ${t.room}` : ''}
                                    </Text>
                                    <View
                                      style={[
                                        styles.seniorityPill,
                                        t.seniority === 'SENIOR'
                                          ? styles.seniorityPillRed
                                          : t.seniority === 'JUNIOR'
                                          ? styles.seniorityPillGreen
                                          : styles.seniorityPillGray,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.seniorityPillText,
                                          t.seniority === 'SENIOR'
                                            ? styles.seniorityTextRed
                                            : t.seniority === 'JUNIOR'
                                            ? styles.seniorityTextGreen
                                            : styles.seniorityTextGray,
                                        ]}
                                      >
                                        {t.seniority === 'SENIOR'
                                          ? '선순위 주의'
                                          : t.seniority === 'JUNIOR'
                                          ? '후순위 소멸'
                                          : '대항력 미상'}
                                      </Text>
                                    </View>
                                  </View>

                                  <View style={styles.tenantMetaGrid}>
                                    <Text style={styles.tenantMetaLine}>
                                      <Text style={styles.rawRightKey}>전입일: </Text>
                                      <Text style={styles.rawRightVal}>{t.move_in_date || '미상'}</Text>
                                      {'  |  '}
                                      <Text style={styles.rawRightKey}>보증금: </Text>
                                      <Text style={styles.rawRightVal}>{t.deposit_str || '미상'}</Text>
                                    </Text>
                                    <Text style={styles.tenantMetaLine}>
                                      {t.monthly_rent ? (
                                        <>
                                          <Text style={styles.rawRightKey}>월세: </Text>
                                          <Text style={styles.rawRightVal}>{t.monthly_rent}</Text>
                                          {'  |  '}
                                        </>
                                      ) : undefined}
                                      <Text style={styles.rawRightKey}>확정일: </Text>
                                      <Text style={styles.rawRightVal}>{t.fixed_date || '미상'}</Text>
                                      {'  |  '}
                                      <Text style={styles.rawRightKey}>배당요구: </Text>
                                      <Text
                                        style={t.is_payout_requested ? styles.payoutYes : styles.payoutNo}
                                      >
                                        {t.is_payout_requested ? '신청함' : '없음'}
                                      </Text>
                                    </Text>
                                  </View>
                                </View>
                              ))}

                              {tenantsList.length > 10 && (
                                <TouchableOpacity
                                  style={styles.showMoreTenantsBtn}
                                  onPress={() => setShowAllTenants(!showAllTenants)}
                                  activeOpacity={0.8}
                                >
                                  <Text style={styles.showMoreTenantsText}>
                                    {showAllTenants
                                      ? '임차인 목록 접기 ▲'
                                      : `+ 나머지 ${tenantsList.length - 10}명 모두 보기 (총 ${tenantsList.length}명)`}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          ) : (
                            <View style={styles.rawTenantBox}>
                              <Text style={styles.rawEmptyText}>
                                현황조사서상 조사된 임차인이 없습니다 (소유자 점유 또는 공실 추정).
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })()}

                    {/* 특수권리 및 주의 조건 카드 */}
                    {parsedSpecials.length > 0 && (
                      <View style={styles.rawSection}>
                        <Text style={styles.rawSectionTitle}>⚠️ 감지된 특수권리 · 매각조건</Text>
                        <View style={styles.specialCardsList}>
                          {parsedSpecials.map((sp, spIdx) => (
                            <View key={spIdx} style={styles.specialCard}>
                              <View style={styles.specialCardHeader}>
                                <Text style={styles.specialCardTitle}>
                                  {sp.icon} {sp.title}
                                </Text>
                              </View>
                              {sp.desc ? (
                                <Text style={styles.specialCardDesc}>{sp.desc}</Text>
                              ) : undefined}
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* 매각물건명세서 비고 원문 (섹션별 카드) */}
                    <View style={styles.rawSection}>
                      <Text style={styles.rawSectionTitle}>📝 매각물건명세서 비고 원문</Text>
                      {parsedRemarks.length > 0 ? (
                        <View style={styles.remarksList}>
                          {parsedRemarks.map((sec, sIdx) => (
                            <View key={sIdx} style={styles.remarkSectionCard}>
                              <Text style={styles.remarkSectionHeading}>{sec.heading}</Text>
                              <Text style={styles.remarksText}>{sec.body}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <View style={styles.remarksBox}>
                          <Text style={styles.remarksText}>
                            법원 매각물건명세서상 특별한 비고 기재사항이 없습니다.
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* 더블체크용: 법원 원문 전체 보기 (Raw JSON/텍스트) + 대법원 바로가기 */}
                    <View style={styles.doubleCheckBox}>
                      <TouchableOpacity
                        style={styles.rawJsonToggleBtn}
                        onPress={() => setIsFullRawJsonOpen(!isFullRawJsonOpen)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.rawJsonToggleText}>
                          📄 법원 원문 전체 보기 (Raw JSON/텍스트) {isFullRawJsonOpen ? '▲' : '▼'}
                        </Text>
                      </TouchableOpacity>

                      {isFullRawJsonOpen && (
                        <ScrollView
                          style={styles.rawJsonScrollBox}
                          nestedScrollEnabled={true}
                          showsVerticalScrollIndicator={true}
                        >
                          <Text style={styles.rawJsonCodeText} selectable={true}>
                            {JSON.stringify(
                              {
                                case_number: item.case_number,
                                court_name: item.court_name,
                                auction_date: item.auction_date,
                                raw_court_data: rawData,
                              },
                              null,
                              2
                            )}
                          </Text>
                        </ScrollView>
                      )}

                      <TouchableOpacity
                        style={styles.courtLinkBtn}
                        activeOpacity={0.85}
                        onPress={() => Linking.openURL('https://www.courtauction.go.kr')}
                      >
                        <Text style={styles.courtLinkBtnText}>
                          🏛️ 대한민국 법원 경매정보(courtauction.go.kr) 바로가기 ↗
                        </Text>
                        <Text style={styles.courtLinkSubText}>
                          사건번호 {item.case_number} 직접 더블체크
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.rawDisclaimer}>
                      ※ 본 정보는 대한민국 법원경매정보(courtauction.go.kr)에서 수집된 공식 장부 원본입니다.
                    </Text>
                  </View>
                );
              })()}
            </View>
            )}
              </>
            )}

            {/* 관할 기관 및 사건/물건 메타 정보 */}
            <View style={styles.metaCard}>
              <Text style={styles.metaRow}>
                <Text style={styles.metaKey}>{isOnbid ? '공고 기관: ' : '관할 법원: '}</Text>
                <Text style={styles.metaVal}>{item.court_name || (isOnbid ? '캠코 온비드' : '수도권 관할 법원')}</Text>
              </Text>
              <Text style={styles.metaRow}>
                <Text style={styles.metaKey}>{isOnbid ? '물건 번호: ' : '사건 번호: '}</Text>
                <Text style={styles.metaVal}>{onbid?.cltr_no || item.case_number}</Text>
              </Text>
              <Text style={styles.metaRow}>
                <Text style={styles.metaKey}>{isOnbid ? '입찰 마감: ' : '입찰 기일: '}</Text>
                <Text style={styles.metaVal}>{onbid?.bid_end_date || item.auction_date || '일정 확인 필요'}</Text>
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 하단 고정 찜 액션 바 */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarInner}>
          <TouchableOpacity
            style={[styles.favActionBtn, fav && styles.favActionBtnActive]}
            onPress={() => toggleFavorite(item)}
            activeOpacity={0.85}
          >
            <Text style={styles.favActionIcon}>{fav ? '⭐' : '☆'}</Text>
            <Text style={[styles.favActionText, fav && styles.favActionTextActive]}>
              {fav ? '관심 매물 등록됨' : '관심 매물로 찜하기'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 5단계: 초대 코드 입력 모달 (EASYBID2026, 대소문자 무시 · 영구 저장) */}
      <Modal
        visible={inviteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <Pressable
          style={styles.inviteBackdrop}
          onPress={() => setInviteModalVisible(false)}
        >
          <Pressable style={styles.inviteModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.inviteHeaderRow}>
              <Text style={styles.inviteModalTitle}>🔓 초대 코드 입력</Text>
              <TouchableOpacity
                style={styles.inviteCloseBtn}
                onPress={() => setInviteModalVisible(false)}
                accessibilityLabel="닫기"
              >
                <Text style={styles.inviteCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inviteModalDesc}>
              이지경매 베타 초대 코드를 1회 입력하시면 모든 매물의 필요 현금·목표 수익률 역산·예상 수익률이 영구 해제됩니다.
            </Text>
            <TextInput
              style={styles.inviteInput}
              value={inviteCodeInput}
              onChangeText={(t) => {
                setInviteCodeInput(t);
                if (inviteError) setInviteError('');
              }}
              placeholder="초대 코드 입력"
              placeholderTextColor="#94a3b8"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSubmitInviteCode}
            />
            {inviteError ? (
              <Text style={styles.inviteErrorText}>{inviteError}</Text>
            ) : undefined}
            <TouchableOpacity
              style={styles.inviteSubmitBtn}
              activeOpacity={0.85}
              onPress={handleSubmitInviteCode}
            >
              <Text style={styles.inviteSubmitBtnText}>전체 잠금 해제하기</Text>
            </TouchableOpacity>
            <Text style={styles.inviteHintText}>
              ※ 오늘의 추천 상위 2건은 초대 코드 없이도 무료 맛보기로 전체 공개됩니다.
            </Text>
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
  scrollContent: {
    paddingBottom: 100,
    alignItems: 'center',
  },
  pageInner: {
    width: '100%',
    maxWidth: 640,
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

  // 1. 사진 갤러리
  galleryBox: {
    height: 270,
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  galleryScroll: {
    width: '100%',
    height: '100%',
  },
  galleryImage: {
    height: 270,
  },
  badgeWrap: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    maxWidth: '64%',
  },
  sourceBadgeDetail: {
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 10,
    borderWidth: 1,
  },
  sourceBadgeDetailText: {
    fontSize: 11.5,
    fontWeight: '900',
  },
  leasePill: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  leasePillText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#047857',
  },
  calcTable: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 10,
  },
  leaseNoticeBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginTop: 10,
  },
  leaseNoticeText: {
    fontSize: 12.5,
    lineHeight: 18.5,
    color: '#166534',
  },
  photoSourceWrap: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  photoSourceText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  badgeGreen: {
    backgroundColor: 'rgba(236, 253, 245, 0.96)',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgeTextGreen: {
    color: '#047857',
    fontSize: 12.5,
    fontWeight: '800',
  },
  badgeYellow: {
    backgroundColor: 'rgba(254, 252, 232, 0.96)',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  badgeTextYellow: {
    color: '#a16207',
    fontSize: 12.5,
    fontWeight: '800',
  },
  badgeRed: {
    backgroundColor: 'rgba(254, 242, 242, 0.96)',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  badgeTextRed: {
    color: '#b91c1c',
    fontSize: 12.5,
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
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  photoArrowBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoArrowLeft: {
    left: 12,
  },
  photoArrowRight: {
    right: 12,
  },
  photoArrowText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },

  contentWrap: {
    padding: 18,
    gap: 16,
  },
  titleSection: {
    gap: 6,
  },
  headlineText: {
    fontSize: 21,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 29,
    letterSpacing: -0.3,
  },
  locationText: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },

  // 공통 카드
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  cardSubCaption: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: -6,
  },

  // 2. 가격 요약
  discountPill: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  discountPillText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 20,
  },
  statItem: {
    gap: 3,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  statValueLarge: {
    fontSize: 25,
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
  areaStatBanner: {
    backgroundColor: '#eff6ff',
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  areaStatText: {
    fontSize: 12.5,
    color: '#1e40af',
    lineHeight: 18,
  },
  areaStatBold: {
    fontWeight: '900',
    color: '#1d4ed8',
  },

  // 3. 필요 자기자본 계산기
  presetRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 3,
    gap: 4,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  presetBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  presetBtnTextActive: {
    color: '#0f172a',
    fontWeight: '900',
  },
  presetDescText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  mciToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  mciToggleRowActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  mciCheckBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mciCheckBoxActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  mciCheckMark: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  mciToggleTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  mciToggleSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  totalCashHighlight: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  totalCashLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  totalCashValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  calcRows: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  calcRowLast: {
    borderBottomWidth: 0,
  },
  calcKey: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  calcVal: {
    fontSize: 13.5,
    color: '#0f172a',
    fontWeight: '800',
  },
  calcValBold: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '900',
  },
  calcValBlue: {
    fontSize: 13.5,
    color: '#2563eb',
    fontWeight: '800',
  },
  calcValGreen: {
    fontSize: 13.5,
    color: '#047857',
    fontWeight: '800',
  },
  calcValRed: {
    fontSize: 13.5,
    color: '#dc2626',
    fontWeight: '900',
  },
  disclaimerText: {
    fontSize: 11.5,
    color: '#94a3b8',
    lineHeight: 16,
  },

  // 4. 전월세 & 수익률
  yieldPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  yieldPillText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '900',
  },
  rentalSourceText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: -4,
  },
  rentalGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  rentalBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  rentalLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  rentalVal: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
  },
  rentalValBlue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  gapInvestBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  noRentalBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  noRentalTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#475569',
  },
  noRentalDesc: {
    fontSize: 12.5,
    color: '#64748b',
    lineHeight: 18,
  },

  // 5. AI 권리분석 리포트
  aiScorePill: {
    backgroundColor: '#eef2ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  aiScoreText: {
    color: '#3730a3',
    fontSize: 12.5,
    fontWeight: '900',
  },
  verdictBox: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2563eb',
  },
  verdictText: {
    fontSize: 13,
    color: '#1e293b',
    lineHeight: 19,
    fontWeight: '600',
  },
  malsoGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  malsoCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  malsoLabel: {
    fontSize: 11.5,
    color: '#64748b',
    fontWeight: '700',
  },
  malsoVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 18,
  },
  malsoValBlue: {
    fontSize: 13.5,
    fontWeight: '900',
    color: '#1d4ed8',
    lineHeight: 18,
  },
  rightsCompareBox: {
    gap: 8,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rightsCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rightsCompareTagGreen: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rightsCompareTagRed: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rightsCompareTagGray: {
    backgroundColor: '#e2e8f0',
    color: '#475569',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rightsCompareText: {
    flex: 1,
    fontSize: 12.5,
    color: '#334155',
    fontWeight: '600',
  },
  pointBlock: {
    gap: 4,
  },
  pointBlockTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
  },
  pointText: {
    fontSize: 12.5,
    color: '#334155',
    lineHeight: 18,
  },
  riskText: {
    fontSize: 12.5,
    color: '#b45309',
    lineHeight: 18,
  },

  // 6. 유찰 히스토리 타임라인
  historySubTag: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#2563eb',
  },
  timelineList: {
    gap: 8,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timelineRowCurrent: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  timelineRoundBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineRoundBadgeCurrent: {
    backgroundColor: '#2563eb',
  },
  timelineRoundText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#475569',
  },
  timelineRoundTextCurrent: {
    color: '#ffffff',
  },
  timelinePrice: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#334155',
  },
  timelinePriceCurrent: {
    color: '#1d4ed8',
    fontSize: 15.5,
    fontWeight: '900',
  },
  timelineDate: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  timelineRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  timelineRatio: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  timelineStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  timelineStatusCurrent: {
    color: '#2563eb',
    fontWeight: '800',
  },

  // 7. 법원 원문 아코디언
  accordionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
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
    gap: 12,
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  accordionTitleTextWrap: {
    flex: 1,
    minWidth: 0,
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
    flexShrink: 1,
  },
  accordionArrow: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '800',
  },
  accordionBody: {
    padding: 16,
    gap: 18,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  rawSection: {
    gap: 8,
    minWidth: 0,
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
    paddingBottom: 10,
    gap: 6,
  },
  rawRightItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  rawRightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  rawRightBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  rawRightBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rawRightBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#3730a3',
  },
  standardRightTag: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  standardRightTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991b1b',
  },
  rawRightDate: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  rawRightDetails: {
    gap: 3,
    paddingLeft: 2,
    minWidth: 0,
  },
  rawRightRow: {
    fontSize: 12.5,
    lineHeight: 18,
    flexShrink: 1,
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
    fontSize: 11.5,
    color: '#475569',
    backgroundColor: '#f1f5f9',
    padding: 6,
    borderRadius: 6,
    marginTop: 2,
    lineHeight: 17,
    flexShrink: 1,
  },
  rawEmptyText: {
    fontSize: 12.5,
    color: '#94a3b8',
    padding: 10,
  },
  rawTenantBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rawTenantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  rawTenantRowLast: {
    borderBottomWidth: 0,
  },
  rawTenantKey: {
    fontSize: 12.5,
    color: '#64748b',
    fontWeight: '600',
    flexShrink: 0,
  },
  rawTenantVal: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    flexShrink: 1,
  },
  payoutYes: {
    color: '#16a34a',
  },
  payoutNo: {
    color: '#64748b',
  },
  specialCardsList: {
    gap: 8,
  },
  specialCard: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 4,
  },
  specialCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  specialCardTitle: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '800',
    flexShrink: 1,
  },
  specialCardDesc: {
    color: '#7f1d1d',
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 1,
  },
  remarksList: {
    gap: 8,
  },
  remarkSectionCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 5,
  },
  remarkSectionHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  remarksBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  remarksText: {
    fontSize: 12.5,
    color: '#334155',
    lineHeight: 19,
    flexShrink: 1,
  },
  rawDisclaimer: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
  },
  seniorSummaryBox: {
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    gap: 4,
  },
  seniorSummaryBoxWarn: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  seniorSummaryLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  seniorSummaryVal: {
    fontSize: 14,
    fontWeight: '900',
    color: '#047857',
  },
  seniorSummaryValWarn: {
    color: '#b91c1c',
  },
  tenantsCardsList: {
    gap: 8,
  },
  tenantItemCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  tenantItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  tenantItemName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    flexShrink: 1,
  },
  seniorityPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  seniorityPillRed: {
    backgroundColor: '#fee2e2',
  },
  seniorityPillGreen: {
    backgroundColor: '#dcfce7',
  },
  seniorityPillGray: {
    backgroundColor: '#e2e8f0',
  },
  seniorityPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  seniorityTextRed: {
    color: '#991b1b',
  },
  seniorityTextGreen: {
    color: '#166534',
  },
  seniorityTextGray: {
    color: '#475569',
  },
  tenantMetaGrid: {
    gap: 3,
  },
  tenantMetaLine: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
    flexShrink: 1,
  },
  showMoreTenantsBtn: {
    backgroundColor: '#eff6ff',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  showMoreTenantsText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  doubleCheckBox: {
    gap: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  rawJsonToggleBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  rawJsonToggleText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#334155',
  },
  rawJsonScrollBox: {
    maxHeight: 240,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
  },
  rawJsonCodeText: {
    fontSize: 11,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  courtLinkBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    gap: 3,
  },
  courtLinkBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  courtLinkSubText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '600',
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

  // 하단 고정 바
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    alignItems: 'center',
  },
  bottomBarInner: {
    width: '100%',
    maxWidth: 640,
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

  // ── 5단계: 무료 맛보기 배너 · 그라데이션 블러 잠금 · 초대 코드 모달 ──
  freePreviewBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  freePreviewBannerText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#047857',
    textAlign: 'center',
  },
  lockedSectionWrap: {
    position: 'relative',
    maxHeight: 280,
    overflow: 'hidden',
    borderRadius: 20,
  },
  blurVeilOverlay: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 18,
    zIndex: 20,
  },
  blurVeilNativeFallback: {
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
  },
  lockCardBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
  },
  lockCardTitle: {
    fontSize: 14.5,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  lockCardSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  unlockCtaBtn: {
    marginTop: 4,
    backgroundColor: '#1C1917',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    width: '100%',
    alignItems: 'center',
  },
  unlockCtaBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  inviteBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  inviteModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
  },
  inviteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inviteModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  inviteCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  inviteModalDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  inviteInput: {
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    letterSpacing: 1,
  },
  inviteErrorText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#dc2626',
  },
  inviteSubmitBtn: {
    backgroundColor: '#1C1917',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  inviteSubmitBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  inviteHintText: {
    fontSize: 11.5,
    color: '#64748b',
    textAlign: 'center',
  },

  // ── 5단계: 목표 수익률별 적정 입찰 상한가 역산 계산기 ──
  targetYieldPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  targetYieldPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  customYieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 8,
  },
  customYieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  customYieldInput: {
    width: 90,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rentInputsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  rentInputBox: {
    flex: 1,
    gap: 4,
  },
  rentInputLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748b',
  },
  rentInputField: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  reverseHighlightBox: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    alignItems: 'center',
  },
  reverseHighlightCol: {
    flex: 1,
    gap: 3,
  },
  reverseHighlightDivider: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 12,
  },
  reverseHighlightLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  reverseHighlightVal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
  },
  reverseHighlightCash: {
    fontSize: 18,
    fontWeight: '900',
    color: '#38bdf8',
  },
  reverseHighlightSub: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  reverseCompareBanner: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 10,
    borderWidth: 1,
  },
  reverseCompareOk: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  reverseCompareWarn: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  reverseCompareText: {
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  reverseCompareTextOk: {
    color: '#065F46',
  },
  reverseCompareTextWarn: {
    color: '#92400E',
  },
});
