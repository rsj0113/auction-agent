"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoneyShort } from "@/app/auctions/page";

interface MapItem {
  case_number: string;
  location: string;
  usage?: string;
  appraisal: number;
  min_bid: number;
  failed_count: number;
  ai_grade: string;
  safety_margin?: number;
  market_discount_pct?: number;
  floor?: number | null;
  lat?: number;
  lng?: number;
  is_favorite?: number;
  recommend_tag?: string;
}

export interface NaverShopItem {
  article_id: string;
  region_name: string;
  addr_sgg: string;
  addr_emd: string;
  trade_type: string;
  trade_type_cd: string;
  realty_type_cd: string;
  area_m2: number;
  area_pyeong: number;
  price_sale_10k: number;
  deposit_10k: number;
  monthly_rent_10k: number;
  floor?: number | null;
  total_floor?: number | null;
  detail_url: string;
  confirm_date?: string;
  realtor?: string;
  lat?: number;
  lng?: number;
  article_name?: string;
  is_favorite?: number;
  recommend_tag?: string;
}

interface AuctionMapProps {
  items: MapItem[];
  onSelectItem: (item: any) => void;
  focusRegion?: string;
  priceRange?: string; // "", "under1", "1to3", "3to5", "over5"
}

const PRESET_REGIONS = [
  { label: "🌐 수도권 전체", regionKey: "", lat: 37.43, lng: 127.08, zoom: 11 },
  { label: "🎯 성남·분당·판교", regionKey: "성남·분당", lat: 37.395, lng: 127.125, zoom: 13 },
  { label: "💎 강남·서초·송파·마포", regionKey: "강남·서초·송파·마포", lat: 37.505, lng: 127.045, zoom: 12 },
  { label: "🌳 수원·안양", regionKey: "수원·안양", lat: 37.315, lng: 127.005, zoom: 12 },
];

const PRICE_OPTIONS = [
  { id: "", label: "가격 전체", min: undefined, max: undefined },
  { id: "under1", label: "1억 이하", min: undefined, max: 100000000 },
  { id: "1to3", label: "1억 ~ 3억", min: 100000000, max: 300000000 },
  { id: "3to5", label: "3억 ~ 5억", min: 300000000, max: 500000000 },
  { id: "over5", label: "5억 이상", min: 500000000, max: undefined },
];

export function formatNaverPrice10k(val10k: number): string {
  if (!val10k || val10k <= 0) return "-";
  if (val10k >= 10000) {
    const eok = Math.floor(val10k / 10000);
    const rem = val10k % 10000;
    return rem > 0 ? `${eok}억 ${rem.toLocaleString()}만` : `${eok}억`;
  }
  return `${val10k.toLocaleString()}만`;
}

export function formatNaverPinPrice(n: NaverShopItem): string {
  if (n.trade_type === "매매") {
    if (n.price_sale_10k >= 10000) {
      return `매매 ${(n.price_sale_10k / 10000).toFixed(1).replace(/\.0$/, "")}억`;
    }
    return `매매 ${n.price_sale_10k.toLocaleString()}만`;
  }
  const dep =
    n.deposit_10k >= 10000
      ? `${(n.deposit_10k / 10000).toFixed(1).replace(/\.0$/, "")}억`
      : `${n.deposit_10k}`;
  return `월세 ${dep}/${n.monthly_rent_10k}`;
}

export default function AuctionMap({
  items,
  onSelectItem,
  focusRegion = "",
  priceRange = "",
}: AuctionMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // 네이버 상가 실매물 오버레이 & 필터 상태
  const [showNaver, setShowNaver] = useState(true);
  const [naverFirstFloorOnly, setNaverFirstFloorOnly] = useState(false);
  const [naverTradeType, setNaverTradeType] = useState<"" | "매매" | "월세">("");
  const [naverRegion, setNaverRegion] = useState<string>(focusRegion || "");
  const [naverRegionInput, setNaverRegionInput] = useState<string>(focusRegion || "");
  const [naverPriceRange, setNaverPriceRange] = useState<string>(priceRange || "");
  const [naverSort, setNaverSort] = useState<string>("default");
  const [naverFavoriteOnly, setNaverFavoriteOnly] = useState(false);
  const [naverItems, setNaverItems] = useState<NaverShopItem[]>([]);
  const [naverTotalMatching, setNaverTotalMatching] = useState<number>(0);
  const [selectedNaver, setSelectedNaver] = useState<NaverShopItem | null>(null);

  // 상위 페이지의 지역/가격 필터가 바뀌면 네이버 상가 필터도 자동 동기화
  useEffect(() => {
    const QUICK_FILTER_IDS = new Set([
      "safe", "half_price", "owner", "apartment", "first_floor_shop",
      "small_budget", "top_grade", "special", "clean", "margin_100m", "market_matched",
    ]);
    const clean =
      focusRegion && !QUICK_FILTER_IDS.has(focusRegion.trim())
        ? focusRegion.trim()
        : "";
    setNaverRegion(clean);
    setNaverRegionInput(clean);
  }, [focusRegion]);

  useEffect(() => {
    setNaverPriceRange(priceRange || "");
  }, [priceRange]);

  // Load Leaflet CSS & JS dynamically via CDN
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    if ((window as any).L) {
      setMapReady(true);
      return;
    }

    const existingScript = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => setMapReady(true));
      return;
    }

    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setMapReady(true);
    document.body.appendChild(script);
  }, []);

  // Fetch Naver commercial listings with region, price, floor, trade_type, and sort
  useEffect(() => {
    if (!showNaver) {
      setNaverItems([]);
      setNaverTotalMatching(0);
      return;
    }

    const params = new URLSearchParams();
    params.set("limit", "400");
    if (naverRegion && naverRegion.trim()) {
      params.set("region", naverRegion.trim());
    }
    if (naverTradeType) {
      params.set("trade_type", naverTradeType);
    }
    if (naverFirstFloorOnly) {
      params.set("first_floor_only", "true");
    }
    if (naverFavoriteOnly) {
      params.set("favorite_only", "true");
    }
    if (naverSort && naverSort !== "default") {
      params.set("sort", naverSort);
    }

    const priceOpt = PRICE_OPTIONS.find((p) => p.id === naverPriceRange);
    if (priceOpt) {
      if (priceOpt.min !== undefined) params.set("min_price", String(priceOpt.min));
      if (priceOpt.max !== undefined) params.set("max_price", String(priceOpt.max));
    }

    fetch(`/api/naver-listings?${params.toString()}`, {
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then((res) => (res.ok ? res.json() : { data: [], total_matching: 0 }))
      .then((json) => {
        if (json && Array.isArray(json.data)) {
          setNaverItems(json.data);
          setNaverTotalMatching(
            typeof json.total_matching === "number" ? json.total_matching : json.data.length
          );
        }
      })
      .catch(() => {});
  }, [showNaver, naverRegion, naverFirstFloorOnly, naverTradeType, naverPriceRange, naverSort, naverFavoriteOnly]);

  // Initialize map
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [37.395, 127.125],
        zoom: 12,
        zoomControl: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapReady]);

  // Render both Court Auction pins and Naver Commercial Shop pins
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !markersLayerRef.current) return;
    const L = (window as any).L;
    const layerGroup = markersLayerRef.current;
    layerGroup.clearLayers();

    // 1. 네이버 부동산 상가 핀 렌더링
    const validNaver = showNaver
      ? naverItems.filter(
          (n) => typeof n.lat === "number" && typeof n.lng === "number" && n.lat > 33 && n.lng > 124
        )
      : [];

    validNaver.forEach((n) => {
      const isFirstFloor = n.floor === 1;
      const floorText = isFirstFloor
        ? "1층 "
        : n.floor && n.floor < 0
        ? `B${Math.abs(n.floor)} `
        : n.floor
        ? `${n.floor}층 `
        : "";
      const pinLabel = formatNaverPinPrice(n);

      const naverHtml = `
        <div style="
          display:inline-flex;
          align-items:center;
          gap:3px;
          background:${isFirstFloor ? "#059669" : "#ffffff"};
          color:${isFirstFloor ? "#ffffff" : "#047857"};
          padding:2px 7px;
          border-radius:8px;
          font-size:10.5px;
          font-weight:800;
          white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.22);
          border:2px solid #03c75a;
          transform:translate(-50%, -50%);
          cursor:pointer;
        ">
          <span style="background:#03c75a;color:#fff;padding:0 3.5px;border-radius:4px;font-size:9.5px;font-weight:900;">N</span>
          ${floorText ? `<span style="color:${isFirstFloor ? "#fde047" : "#d97706"};font-weight:900;">${floorText}</span>` : ""}
          <span>${pinLabel}</span>
        </div>
      `;

      const naverIcon = L.divIcon({
        html: naverHtml,
        className: "naver-shop-pin",
        iconSize: [0, 0],
      });

      const marker = L.marker([n.lat, n.lng], {
        icon: naverIcon,
        zIndexOffset: isFirstFloor ? 450 : 150,
      });

      const priceDetail =
        n.trade_type === "매매"
          ? `매매 ${formatNaverPrice10k(n.price_sale_10k)}`
          : `보증금 ${formatNaverPrice10k(n.deposit_10k)} / 월세 ${formatNaverPrice10k(n.monthly_rent_10k)}`;

      marker.bindTooltip(
        `<div style="font-size:12px;font-weight:800;color:#047857;">🟢 [네이버 상가] ${n.article_name || "일반상가"}</div>
         <div style="font-size:11px;color:#374151;">${n.addr_sgg} ${n.addr_emd} · 전용 ${n.area_pyeong}평 (${n.floor ? `${n.floor}층/${n.total_floor || "-"}층` : "층수미상"})</div>
         <div style="font-size:11.5px;color:#059669;font-weight:800;margin-top:2px;">${priceDetail}</div>`,
        { direction: "top", offset: [0, -10] }
      );

      marker.on("click", () => {
        setSelectedNaver(n);
      });
      marker.addTo(layerGroup);
    });

    // 2. 법원 경매 핀 렌더링
    const validItems = items.filter(
      (it) => typeof it.lat === "number" && typeof it.lng === "number" && it.lat > 33 && it.lng > 124
    );

    validItems.forEach((item) => {
      const grade = (item.ai_grade || "B").toUpperCase();
      const bg =
        grade === "S"
          ? "#7c3aed"
          : grade === "A"
          ? "#2563eb"
          : grade === "B"
          ? "#1d4ed8"
          : grade === "C"
          ? "#d97706"
          : "#dc2626";

      const priceLabel = formatMoneyShort(item.min_bid);
      const is1FShop = item.usage === "상가/근린시설" && item.floor === 1;

      const iconHtml = `
        <div style="
          display:inline-flex;
          align-items:center;
          gap:4px;
          background:${bg};
          color:#fff;
          padding:3px 8px;
          border-radius:9999px;
          font-size:11px;
          font-weight:800;
          white-space:nowrap;
          box-shadow:0 3px 8px rgba(0,0,0,0.32);
          border:2px solid ${is1FShop ? "#fde047" : "#ffffff"};
          transform:translate(-50%, -50%);
          cursor:pointer;
        ">
          <span>⚖️${grade}</span>
          ${is1FShop ? `<span style="color:#fde047;">1층</span>` : ""}
          <span>${priceLabel}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: "auction-price-pin",
        iconSize: [0, 0],
      });

      const zBoost =
        grade === "S" ? 1200 : grade === "A" ? 1000 : grade === "B" ? 700 : grade === "C" ? 300 : 100;

      const marker = L.marker([item.lat, item.lng], { icon: customIcon, zIndexOffset: zBoost });
      marker.bindTooltip(
        `<div style="font-size:12px;font-weight:700;">⚖️ [법원경매] ${item.case_number} (${item.usage || "매물"})</div>
         <div style="font-size:11px;color:#374151;max-width:220px;white-space:normal;">${item.location}</div>
         <div style="font-size:11px;color:#2563eb;font-weight:700;margin-top:2px;">최저가: ${priceLabel} (유찰 ${item.failed_count}회)</div>`,
        { direction: "top", offset: [0, -12] }
      );
      marker.on("click", () => {
        setSelectedNaver(null);
        onSelectItem(item);
      });
      marker.addTo(layerGroup);
    });
  }, [items, naverItems, showNaver, mapReady]);

  // 지역 검색 시 해당 핀들이 있는 곳으로 지도 자동 이동
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !naverRegion) return;
    const L = (window as any).L;
    const validNaver = naverItems.filter(
      (n) => typeof n.lat === "number" && typeof n.lng === "number" && n.lat > 33 && n.lng > 124
    );
    const validAuctions = items.filter(
      (it) => typeof it.lat === "number" && typeof it.lng === "number" && it.lat > 33 && it.lng > 124
    );
    const points =
      validNaver.length > 0
        ? validNaver.map((n) => [n.lat, n.lng])
        : validAuctions.map((i) => [i.lat, i.lng]);

    if (points.length > 0 && points.length <= 350) {
      const bounds = L.latLngBounds(points);
      mapInstanceRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    }
  }, [naverRegion, naverItems.length, mapReady]);

  const handleFlyTo = (lat: number, lng: number, zoom: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], zoom, { duration: 0.8 });
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {/* 1단: 지역 점프 & 네이버 상가 전용 위치·가격·거래유형 필터 바 */}
        <div className="p-3.5 bg-gray-50 border-b border-gray-200 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-gray-700 mr-1">📍 권역 선택 (지도 이동 + 상가 필터):</span>
              {PRESET_REGIONS.map((reg) => {
                const isActive = naverRegion === reg.regionKey;
                return (
                  <button
                    key={reg.label}
                    onClick={() => {
                      setNaverRegion(reg.regionKey);
                      setNaverRegionInput(reg.regionKey);
                      handleFlyTo(reg.lat, reg.lng, reg.zoom);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      isActive
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 border-gray-200"
                    }`}
                  >
                    {reg.label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowNaver(!showNaver)}
              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                showNaver
                  ? "bg-[#03c75a] text-white border-[#03c75a] shadow-xs"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <span>🟢 네이버 상가 표시</span>
              <span className="px-1.5 py-0.2 rounded bg-black/15 text-[10px]">
                {showNaver ? `${naverTotalMatching.toLocaleString()}건` : "OFF"}
              </span>
            </button>
          </div>

          {/* 2단: 네이버 상가 세부 필터 (동네 검색, 가격대, 1층 상가, 매매/월세, 정렬) */}
          {showNaver && (
            <div className="pt-2 border-t border-gray-200/80 flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-emerald-800 flex items-center gap-1">
                <span className="px-1.5 py-0.2 rounded bg-[#03c75a] text-white text-[10px] font-black">N</span>
                상가 상세필터:
              </span>

              {/* 동네 직접 검색 */}
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
                <input
                  type="text"
                  placeholder="동네/역 검색 (예: 서현, 야탑, 판교, 역삼)"
                  value={naverRegionInput}
                  onChange={(e) => setNaverRegionInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setNaverRegion(naverRegionInput)}
                  className="px-2.5 py-1 text-xs text-gray-800 outline-none w-44 sm:w-52"
                />
                {naverRegionInput && (
                  <button
                    onClick={() => {
                      setNaverRegionInput("");
                      setNaverRegion("");
                    }}
                    className="px-1.5 text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
                <button
                  onClick={() => setNaverRegion(naverRegionInput)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  적용
                </button>
              </div>

              {/* 가격대 필터 */}
              <select
                value={naverPriceRange}
                onChange={(e) => setNaverPriceRange(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-700 outline-none focus:border-emerald-500 cursor-pointer"
              >
                {PRICE_OPTIONS.map((p) => (
                  <option key={p.id || "all"} value={p.id}>
                    💰 {p.label}
                  </option>
                ))}
              </select>

              {/* 1층 상가만 토글 */}
              <button
                onClick={() => setNaverFirstFloorOnly(!naverFirstFloorOnly)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  naverFirstFloorOnly
                    ? "bg-orange-500 text-white border-orange-500 shadow-xs"
                    : "bg-white text-orange-700 border-orange-200 hover:bg-orange-50"
                }`}
              >
                🏪 1층 상가만
              </button>

              {/* 관심 매물만 토글 */}
              <button
                onClick={() => setNaverFavoriteOnly(!naverFavoriteOnly)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  naverFavoriteOnly
                    ? "bg-amber-500 text-white border-amber-500 shadow-xs"
                    : "bg-white text-amber-800 border-amber-300 hover:bg-amber-50"
                }`}
              >
                ⭐ 관심 상가만
              </button>

              {/* 매매/월세 토글 */}
              <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
                {(["", "매매", "월세"] as const).map((t) => (
                  <button
                    key={t || "all"}
                    onClick={() => setNaverTradeType(t)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                      naverTradeType === t
                        ? "bg-emerald-600 text-white"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t || "전체"}
                  </button>
                ))}
              </div>

              {/* 정렬 */}
              <select
                value={naverSort}
                onChange={(e) => setNaverSort(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-700 outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="default">정렬: 1층·일반상가 우선</option>
                <option value="price_asc">낮은 가격순</option>
                <option value="price_desc">높은 가격순</option>
                <option value="area_desc">넓은 면적순</option>
              </select>

              {(naverRegion || naverPriceRange || naverFirstFloorOnly || naverTradeType || naverFavoriteOnly) && (
                <button
                  onClick={() => {
                    setNaverRegion("");
                    setNaverRegionInput("");
                    setNaverPriceRange("");
                    setNaverFirstFloorOnly(false);
                    setNaverTradeType("");
                    setNaverFavoriteOnly(false);
                  }}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 cursor-pointer"
                >
                  필터 초기화
                </button>
              )}
            </div>
          )}
        </div>

        {/* 범례 바 */}
        <div className="px-3.5 py-1.5 bg-white border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-gray-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 font-bold text-gray-800">
              ⚖️ 법원경매 ({items.length}건):
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"></span>S등급
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>A·B등급
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
              <span className="px-1 py-0.2 bg-[#03c75a] text-white rounded text-[9px] font-black">N</span>
              네이버 상가 검색결과: {naverTotalMatching.toLocaleString()}건 (지도 표시 {naverItems.length}건)
            </span>
          </div>
        </div>

        {/* 지도 캔버스 */}
        <div className="relative w-full h-[500px] sm:h-[580px] bg-gray-100">
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 z-10">
              지도를 불러오는 중입니다...
            </div>
          )}
          <div ref={mapContainerRef} className="w-full h-full z-0" />

          {/* 선택한 네이버 상가 매물 플로팅 상세 카드 */}
          {selectedNaver && (
            <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 bg-white rounded-2xl shadow-xl border-2 border-emerald-500 p-4 z-[500]">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-md bg-[#03c75a] text-white text-[11px] font-extrabold">
                    N 네이버 상가 ({selectedNaver.trade_type})
                  </span>
                  {selectedNaver.floor === 1 ? (
                    <span className="px-2 py-0.5 rounded-md bg-orange-500 text-white text-[11px] font-extrabold">
                      ✨ 1층 상가
                    </span>
                  ) : selectedNaver.floor ? (
                    <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-[11px] font-bold">
                      {selectedNaver.floor < 0 ? `지하${Math.abs(selectedNaver.floor)}층` : `${selectedNaver.floor}층`} / {selectedNaver.total_floor || "-"}층
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const nextFav = selectedNaver.is_favorite ? 0 : 1;
                      setSelectedNaver({ ...selectedNaver, is_favorite: nextFav });
                      setNaverItems((prev) =>
                        prev.map((n) =>
                          n.article_id === selectedNaver.article_id ? { ...n, is_favorite: nextFav } : n
                        )
                      );
                      try {
                        await fetch("/api/favorites/toggle", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
                          body: JSON.stringify({ item_type: "naver", item_id: selectedNaver.article_id }),
                        });
                      } catch (err) {
                        console.error("관심등록 실패:", err);
                      }
                    }}
                    className={`p-1 text-base transition-transform hover:scale-125 cursor-pointer ${
                      selectedNaver.is_favorite ? "text-amber-500 font-bold" : "text-gray-300 hover:text-amber-400"
                    }`}
                    title={selectedNaver.is_favorite ? "관심매물 해제" : "관심매물 등록"}
                  >
                    {selectedNaver.is_favorite ? "⭐" : "☆"}
                  </button>
                  <button
                    onClick={() => setSelectedNaver(null)}
                    className="text-gray-400 hover:text-gray-700 text-sm font-bold px-1.5 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {selectedNaver.recommend_tag && (
                <div className="mb-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 text-purple-900 font-extrabold text-xs shadow-xs">
                  <span>{selectedNaver.recommend_tag}</span>
                </div>
              )}

              <h4 className="text-sm font-extrabold text-gray-900 mb-1 line-clamp-2">
                {selectedNaver.article_name || "일반상가"}
              </h4>
              <p className="text-xs text-gray-500 mb-3">
                📍 {selectedNaver.addr_sgg} {selectedNaver.addr_emd} · 전용{" "}
                <strong className="text-gray-800">{selectedNaver.area_pyeong}평</strong> ({selectedNaver.area_m2}㎡)
              </p>

              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mb-3">
                {selectedNaver.trade_type === "매매" ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800">네이버 매매 호가</span>
                    <div className="text-right">
                      <span className="text-base font-black text-emerald-700">
                        {formatNaverPrice10k(selectedNaver.price_sale_10k)}원
                      </span>
                      {selectedNaver.area_pyeong > 0 && (
                        <span className="block text-[10px] text-emerald-600 font-semibold">
                          평당 {Math.round(selectedNaver.price_sale_10k / selectedNaver.area_pyeong).toLocaleString()}만원
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800">네이버 보증금 / 월세</span>
                    <div className="text-right">
                      <span className="text-base font-black text-emerald-700">
                        {formatNaverPrice10k(selectedNaver.deposit_10k)} / 월 {formatNaverPrice10k(selectedNaver.monthly_rent_10k)}
                      </span>
                      {selectedNaver.area_pyeong > 0 && (
                        <span className="block text-[10px] text-emerald-600 font-semibold">
                          평당 월세 {(selectedNaver.monthly_rent_10k / selectedNaver.area_pyeong).toFixed(1)}만원
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400 truncate">
                  {selectedNaver.realtor || "공인중개사"} {selectedNaver.confirm_date ? `· 확인 ${selectedNaver.confirm_date}` : ""}
                </span>
                <a
                  href={selectedNaver.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-[#03c75a] hover:bg-emerald-600 text-white text-xs font-extrabold transition-colors shrink-0"
                >
                  네이버 부동산 원문 ↗
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 네이버 상가 실매물 카드 리스트 */}
      {showNaver && (
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#03c75a] text-white text-xs font-black">N</span>
              <h3 className="text-sm sm:text-base font-extrabold text-gray-900">
                네이버 부동산 상가 실매물 ({naverTotalMatching.toLocaleString()}건)
              </h3>
              {naverRegion && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  📍 {naverRegion}
                </span>
              )}
              {naverPriceRange && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                  💰 {PRICE_OPTIONS.find((p) => p.id === naverPriceRange)?.label}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              카드를 클릭하면 지도에서 해당 상가 위치로 즉시 이동합니다
            </span>
          </div>

          {naverItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
              해당 조건에 맞는 네이버 상가 매물이 없습니다. 필터 조건을 완화해 보세요.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto pr-1">
              {naverItems.slice(0, 90).map((n) => {
                const is1F = n.floor === 1;
                return (
                  <div
                    key={n.article_id}
                    onClick={() => {
                      setSelectedNaver(n);
                      if (n.lat && n.lng) handleFlyTo(n.lat, n.lng, 16);
                    }}
                    className="border border-gray-200 hover:border-emerald-500 rounded-xl p-3 transition-all cursor-pointer bg-gray-50/50 hover:bg-emerald-50/30 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                              n.trade_type === "매매"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {n.trade_type}
                          </span>
                          {is1F ? (
                            <span className="px-1.5 py-0.5 rounded bg-orange-500 text-white text-[10px] font-extrabold">
                              ✨ 1층 상가
                            </span>
                          ) : n.floor ? (
                            <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 text-[10px] font-bold">
                              {n.floor < 0 ? `B${Math.abs(n.floor)}층` : `${n.floor}층`}/{n.total_floor || "-"}층
                            </span>
                          ) : null}
                          <span className="text-[11px] font-bold text-gray-600">
                            {n.addr_sgg} {n.addr_emd}
                          </span>
                        </div>
                        <span className="text-[11px] font-extrabold text-gray-700 shrink-0">
                          전용 {n.area_pyeong}평
                        </span>
                      </div>
                      <p className="text-xs font-bold text-gray-900 line-clamp-1">
                        {n.article_name || "일반상가"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-200/70">
                      <div>
                        {n.trade_type === "매매" ? (
                          <span className="text-xs font-black text-emerald-700">
                            매매 {formatNaverPrice10k(n.price_sale_10k)}원
                            {n.area_pyeong > 0 && (
                              <span className="text-[10px] font-semibold text-gray-500 ml-1">
                                (평당 {Math.round(n.price_sale_10k / n.area_pyeong).toLocaleString()}만)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs font-black text-blue-700">
                            보증금 {formatNaverPrice10k(n.deposit_10k)} / 월 {formatNaverPrice10k(n.monthly_rent_10k)}
                          </span>
                        )}
                      </div>
                      <a
                        href={n.detail_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-bold text-emerald-700 hover:underline shrink-0"
                      >
                        네이버 원문 ↗
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
