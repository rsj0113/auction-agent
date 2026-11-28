import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FeedItem } from '../types/feed';
import type { WebAuctionMapProps } from './WebAuctionMap';

declare global {
  interface Window {
    L?: any;
  }
}

const LEAFLET_CSS_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
];

const LEAFLET_JS_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
];

let leafletLoadPromise: Promise<any> | null = null;

function ensureLeafletLoaded(): Promise<any> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('SSR environment'));
  }
  if (window.L) {
    return Promise.resolve(window.L);
  }
  if (leafletLoadPromise) {
    return leafletLoadPromise;
  }

  leafletLoadPromise = new Promise((resolve, reject) => {
    // 1. Leaflet CSS 주입
    if (!document.getElementById('easy-auction-leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'easy-auction-leaflet-css';
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS_URLS[0];
      link.onerror = () => {
        link.href = LEAFLET_CSS_URLS[1];
      };
      document.head.appendChild(link);
    }

    // 2. 커스텀 핀 스타일 주입
    if (!document.getElementById('easy-auction-leaflet-pin-style')) {
      const style = document.createElement('style');
      style.id = 'easy-auction-leaflet-pin-style';
      style.textContent = `
        .ea-pin-icon {
          background: transparent !important;
          border: none !important;
        }
        .ea-pin-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          background: #ffffff;
          border: 1.5px solid #cbd5e1;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
          font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", sans-serif;
          font-size: 11.5px;
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
          cursor: pointer;
          transform: translate(-50%, -50%);
          transition: transform 0.14s ease, background-color 0.14s ease, border-color 0.14s ease;
        }
        .ea-pin-pill:hover {
          transform: translate(-50%, -56%) scale(1.06);
          border-color: #1c1917;
          z-index: 900;
        }
        .ea-pin-pill.ea-pin-high-yield {
          background: #ecfdf5;
          border-color: #10b981;
          color: #065f46;
        }
        .ea-pin-pill.ea-pin-selected {
          background: #1c1917;
          border-color: #1c1917;
          color: #ffffff;
          transform: translate(-50%, -58%) scale(1.1);
          box-shadow: 0 6px 16px rgba(28, 25, 23, 0.34);
        }
        .ea-pin-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .leaflet-container {
          font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", sans-serif;
        }
      `;
      document.head.appendChild(style);
    }

    // 3. Leaflet JS 로드 (unpkg 실패 시 jsdelivr 폴백)
    const loadScript = (idx: number) => {
      if (idx >= LEAFLET_JS_URLS.length) {
        leafletLoadPromise = null;
        reject(new Error('Failed to load Leaflet library'));
        return;
      }
      const script = document.createElement('script');
      script.src = LEAFLET_JS_URLS[idx];
      script.async = true;
      script.onload = () => {
        if (window.L) {
          resolve(window.L);
        } else {
          loadScript(idx + 1);
        }
      };
      script.onerror = () => {
        script.remove();
        loadScript(idx + 1);
      };
      document.head.appendChild(script);
    };

    loadScript(0);
  });

  return leafletLoadPromise;
}

function formatShortPricePin(minBid: number, fallbackStr: string, isLease?: boolean, monthlyFee?: number): string {
  if (isLease) {
    const val = monthlyFee && monthlyFee > 0 ? monthlyFee : Math.round(minBid / 12);
    if (val >= 100_000_000) {
      return `월 ${(val / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`;
    }
    return `월 ${Math.max(1, Math.round(val / 10_000)).toLocaleString()}만`;
  }
  if (!minBid || minBid <= 0) {
    return fallbackStr.replace(/\s+/g, '');
  }
  if (minBid >= 100_000_000) {
    const eok = (minBid / 100_000_000).toFixed(1).replace(/\.0$/, '');
    return `${eok}억`;
  }
  const man = Math.round(minBid / 10_000);
  return `${man.toLocaleString()}만`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function WebAuctionMap({
  items,
  selectedCaseNumber,
  onSelectItem,
}: WebAuctionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const markerByCaseRef = useRef<Map<string, any>>(new Map());
  const onSelectRef = useRef(onSelectItem);
  onSelectRef.current = onSelectItem;

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1. Leaflet 지도 초기화 (최초 1회)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    ensureLeafletLoaded()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        if (mapInstanceRef.current) return;

        const map = L.map(containerRef.current, {
          center: [37.545, 126.985],
          zoom: 11,
          zoomControl: false,
          preferCanvas: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(map);

        L.control.zoom({ position: 'topright' }).addTo(map);

        const layerGroup = L.layerGroup().addTo(map);
        mapInstanceRef.current = map;
        markersLayerRef.current = layerGroup;

        // 빈 지도 클릭 시 선택 카드 닫기
        map.on('click', () => {
          onSelectRef.current(null);
        });

        setIsReady(true);

        // 컨테이너 리사이즈 대응
        setTimeout(() => {
          try {
            map.invalidateSize();
          } catch {}
        }, 150);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message || '지도를 불러오지 못했습니다.');
        }
      });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {}
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        markerByCaseRef.current.clear();
      }
    };
  }, []);

  // 2. items 변경 시 마커 일괄 렌더링 (167건 등 전체 lat/lng)
  useEffect(() => {
    if (!isReady || !window.L || !mapInstanceRef.current || !markersLayerRef.current) return;

    const L = window.L;
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;

    layer.clearLayers();
    markerByCaseRef.current.clear();

    const boundsCoords: [number, number][] = [];

    items.forEach((item) => {
      if (typeof item.lat !== 'number' || typeof item.lng !== 'number') return;
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return;

      const isLease = item.source_type === 'onbid_lease';
      const yieldPct = !isLease ? item.rental_estimate?.annual_yield_pct : undefined;
      const isHighYield = typeof yieldPct === 'number' && yieldPct >= 8;
      const dotColor = isLease
        ? '#059669'
        : isHighYield
        ? '#059669'
        : item.safety_grade === 'GREEN'
        ? '#10b981'
        : item.safety_grade === 'YELLOW'
        ? '#f59e0b'
        : '#ef4444';
      const rawPriceLabel = formatShortPricePin(
        item.min_bid,
        item.min_bid_str,
        isLease,
        item.onbid_info?.est_monthly_fee
      );
      const priceLabel = escapeHtml(isHighYield ? `🔥${rawPriceLabel}` : rawPriceLabel);
      const isSelected = item.case_number === selectedCaseNumber;

      const icon = L.divIcon({
        className: 'ea-pin-icon',
        html: `<div class="ea-pin-pill${isHighYield ? ' ea-pin-high-yield' : ''}${
          isSelected ? ' ea-pin-selected' : ''
        }" data-case="${escapeHtml(
          item.case_number
        )}"><span class="ea-pin-dot" style="background:${dotColor}"></span><span>${priceLabel}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([item.lat, item.lng], {
        icon,
        zIndexOffset: isSelected ? 1000 : isHighYield ? 300 : 0,
      });

      marker.on('click', (e: any) => {
        if (e && e.originalEvent && typeof e.originalEvent.stopPropagation === 'function') {
          e.originalEvent.stopPropagation();
        }
        onSelectRef.current(item);
        try {
          map.panTo([item.lat, item.lng], { animate: true, duration: 0.35 });
        } catch {}
      });

      marker.addTo(layer);
      markerByCaseRef.current.set(item.case_number, { marker, item, dotColor, priceLabel, isHighYield });
      boundsCoords.push([item.lat, item.lng]);
    });

    if (boundsCoords.length > 0 && !selectedCaseNumber) {
      try {
        const bounds = L.latLngBounds(boundsCoords);
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
      } catch {}
    }
  }, [items, isReady]);

  // 3. 선택된 매물 변경 시 마커 하이라이트만 가볍게 갱신
  useEffect(() => {
    if (!isReady || !window.L) return;
    const L = window.L;

    markerByCaseRef.current.forEach(({ marker, dotColor, priceLabel, isHighYield }, caseNo) => {
      const isSelected = caseNo === selectedCaseNumber;
      const icon = L.divIcon({
        className: 'ea-pin-icon',
        html: `<div class="ea-pin-pill${isHighYield ? ' ea-pin-high-yield' : ''}${
          isSelected ? ' ea-pin-selected' : ''
        }" data-case="${escapeHtml(
          caseNo
        )}"><span class="ea-pin-dot" style="background:${dotColor}"></span><span>${priceLabel}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      marker.setIcon(icon);
      marker.setZIndexOffset(isSelected ? 1000 : isHighYield ? 300 : 0);
    });
  }, [selectedCaseNumber, isReady]);

  const handleFitAll = () => {
    if (!window.L || !mapInstanceRef.current || items.length === 0) return;
    const coords = items
      .filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number')
      .map((i) => [i.lat as number, i.lng as number]);
    if (coords.length > 0) {
      try {
        mapInstanceRef.current.fitBounds(window.L.latLngBounds(coords), {
          padding: [36, 36],
          maxZoom: 13,
        });
      } catch {}
    }
  };

  return (
    <View style={styles.root}>
      {/* Leaflet 실제 지도 DOM 컨테이너 */}
      <div
        ref={containerRef}
        data-testid="web-auction-leaflet-map"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 380,
          position: 'relative',
          zIndex: 1,
          isolation: 'isolate',
        }}
      />

      {/* 좌상단 매물 수 · 난이도 범례 배지 */}
      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>📍 지도 매물 {items.length}건</Text>
          <Text style={styles.legendText}>🟢 초급 · 🟡 중급 · 🔴 고수</Text>
        </View>

        {isReady && items.length > 0 && (
          <TouchableOpacity
            style={styles.fitBtn}
            onPress={handleFitAll}
            activeOpacity={0.8}
          >
            <Text style={styles.fitBtnText}>⌖ 전체 보기</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 초기 로딩 오버레이 */}
      {!isReady && !loadError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#1C1917" />
          <Text style={styles.loadingText}>동네 지도 불러오는 중...</Text>
        </View>
      )}

      {/* 네트워크 오류 폴백 */}
      {loadError && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.errorText}>지도를 불러오지 못했습니다. 새로고침해 주세요.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 500,
    gap: 8,
    alignItems: 'flex-start',
  },
  countPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    gap: 2,
  },
  countPillText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  fitBtn: {
    backgroundColor: '#1C1917',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
  },
  fitBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#ffffff',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(248, 250, 252, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    zIndex: 600,
  },
  loadingText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#475569',
  },
  errorText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#dc2626',
  },
});
