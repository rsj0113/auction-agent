"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoneyShort } from "@/app/auctions/page";

interface MapItem {
  id?: number | string;
  case_number: string;
  cltr_no?: string;
  location: string;
  cltr_nm?: string;
  usage?: string;
  appraisal: number;
  min_bid: number;
  failed_count?: number;
  ai_grade?: string;
  safety_margin?: number;
  market_discount_pct?: number;
  floor?: number | null;
  lat?: number;
  lng?: number;
  is_favorite?: number;
  recommend_tag?: string;
  winning_bid?: number;
  winning_rate?: number;
  bidder_count?: number;
  source?: string;
  disposal_method?: string;
  reg_org_nm?: string;
  remain_time?: string;
  area_pyeong?: number;
  bld_area_pyeong?: number;
  [key: string]: any;
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
  onAddToPlanner?: (item: any, source: string) => void;
  focusRegion?: string;
  priceRange?: string; // "", "under1", "1to3", "3to5", "over5"
  assetSource?: "auction" | "onbid" | "naver" | "results";
  selectedSources?: { auction: boolean; onbid: boolean; naver: boolean; results: boolean };
  onToggleSource?: (src: "auction" | "onbid" | "naver" | "results") => void;
  sourceCounts?: {
    auction: number;
    onbid: number;
    naver: number;
    results: number;
  };
  fullScreenMode?: boolean;
}

const PRESET_REGIONS = [
  { label: "🇰🇷 전국 전체", regionKey: "", lat: 36.3, lng: 127.8, zoom: 7 },
  { label: "🌐 수도권 전체", regionKey: "", lat: 37.43, lng: 127.08, zoom: 11 },
  { label: "🎯 성남·분당·판교", regionKey: "성남·분당", lat: 37.395, lng: 127.125, zoom: 13 },
  { label: "💎 강남·서초·송파", regionKey: "강남·서초·송파·마포", lat: 37.505, lng: 127.045, zoom: 12 },
  { label: "🌳 수원·안양", regionKey: "수원·안양", lat: 37.315, lng: 127.005, zoom: 12 },
  { label: "⛵ 부산·울산", regionKey: "부산", lat: 35.18, lng: 129.07, zoom: 11 },
  { label: "🚄 대구·경북", regionKey: "대구", lat: 35.87, lng: 128.60, zoom: 11 },
  { label: "🏛️ 대전·세종", regionKey: "대전", lat: 36.35, lng: 127.38, zoom: 11 },
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
  onAddToPlanner,
  focusRegion = "",
  priceRange = "",
  assetSource = "auction",
  selectedSources,
  onToggleSource,
  sourceCounts,
  fullScreenMode = false,
}: AuctionMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // 하단 바텀시트(Drawer) 상태 & 탭 ('pinned' | 'list')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"pinned" | "list">("pinned");

  // 선택된 경매/공매/낙찰 매물 플로팅 상세 카드 상태
  const [selectedPinnedItem, setSelectedPinnedItem] = useState<MapItem | null>(null);

  // 네이버 상가 실매물 오버레이 & 필터 상태
  const [showNaver, setShowNaver] = useState(
    selectedSources ? selectedSources.naver : assetSource !== "results"
  );
  const [naverFirstFloorOnly, setNaverFirstFloorOnly] = useState(false);
  const [naverFloorType, setNaverFloorType] = useState<string>("");
  const [naverPyeongRange, setNaverPyeongRange] = useState<string>("");
  const [naverTradeType, setNaverTradeType] = useState<"" | "매매" | "월세">("");
  const [naverRegion, setNaverRegion] = useState<string>(focusRegion || "");
  const [naverRegionInput, setNaverRegionInput] = useState<string>(focusRegion || "");
  const [naverPriceRange, setNaverPriceRange] = useState<string>(priceRange || "");
  const [naverSort, setNaverSort] = useState<string>("default");
  const [naverFavoriteOnly, setNaverFavoriteOnly] = useState(false);
  const [naverItems, setNaverItems] = useState<NaverShopItem[]>([]);
  const [naverTotalMatching, setNaverTotalMatching] = useState<number>(0);
  const [selectedNaver, setSelectedNaver] = useState<NaverShopItem | null>(null);

  // selectedSources.naver 동기화
  useEffect(() => {
    if (selectedSources) {
      setShowNaver(selectedSources.naver);
    }
  }, [selectedSources?.naver]);

  // 상위 페이지의 지역/가격 필터가 바뀌면 네이버 상가 필터도 자동 동기화
  useEffect(() => {
    const QUICK_FILTER_IDS = new Set([
      "safe", "half_price", "owner", "apartment", "first_floor_shop",
      "small_budget", "top_grade", "special", "clean", "margin_100m", "market_matched", "golf_b1", "underground",
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
    if (naverFloorType) {
      params.set("floor_type", naverFloorType);
    } else if (naverFirstFloorOnly) {
      params.set("floor_type", "1f");
    }
    if (naverPyeongRange) {
      if (naverPyeongRange === "under10") params.set("max_pyeong", "10");
      else if (naverPyeongRange === "10to30") { params.set("min_pyeong", "10"); params.set("max_pyeong", "30"); }
      else if (naverPyeongRange === "30to60") { params.set("min_pyeong", "30"); params.set("max_pyeong", "60"); }
      else if (naverPyeongRange === "over60") params.set("min_pyeong", "60");
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
  }, [showNaver, naverRegion, naverFirstFloorOnly, naverFloorType, naverPyeongRange, naverTradeType, naverPriceRange, naverSort, naverFavoriteOnly]);

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
      const isResult = item.source === "results" || (item.winning_bid && item.winning_bid > 0);
      const isOnbid = item.source === "onbid" || !!item.disposal_method;
      const grade = (item.ai_grade || "B").toUpperCase();
      
      const priceLabel = isResult ? formatMoneyShort(item.winning_bid!) : formatMoneyShort(item.min_bid);
      const is1FShop = (item.usage === "상가/근린시설" || (item.usage || "").includes("근린")) && item.floor === 1;

      let iconHtml = "";
      let zBoost = 500;

      if (isResult) {
        zBoost = 1600;
        iconHtml = `
          <div style="
            display:inline-flex;
            align-items:center;
            gap:4px;
            background:linear-gradient(135deg, #b45309, #d97706);
            color:#fff;
            padding:3px 9px;
            border-radius:9999px;
            font-size:11px;
            font-weight:900;
            white-space:nowrap;
            box-shadow:0 3px 10px rgba(180,83,9,0.45);
            border:2px solid #fef3c7;
            transform:translate(-50%, -50%);
            cursor:pointer;
          ">
            <span>🏆낙찰</span>
            <span>${priceLabel}</span>
            ${item.winning_rate ? `<span style="color:#fef08a;font-size:9.5px;">(${item.winning_rate}%)</span>` : ""}
          </div>
        `;
      } else if (isOnbid) {
        zBoost = 1200;
        iconHtml = `
          <div style="
            display:inline-flex;
            align-items:center;
            gap:4px;
            background:linear-gradient(135deg, #6b21a8, #9333ea);
            color:#fff;
            padding:3px 8px;
            border-radius:9999px;
            font-size:11px;
            font-weight:900;
            white-space:nowrap;
            box-shadow:0 3px 8px rgba(107,33,168,0.4);
            border:2px solid #f3e8ff;
            transform:translate(-50%, -50%);
            cursor:pointer;
          ">
            <span>🏛️공매</span>
            ${is1FShop ? `<span style="color:#fde047;">1층</span>` : ""}
            <span>${priceLabel}</span>
          </div>
        `;
      } else {
        const bg = grade === "S" ? "#7c3aed" : grade === "A" ? "#2563eb" : grade === "B" ? "#1d4ed8" : grade === "C" ? "#d97706" : "#dc2626";
        zBoost = grade === "S" ? 1400 : grade === "A" ? 1000 : grade === "B" ? 700 : grade === "C" ? 300 : 100;
        iconHtml = `
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
      }

      const customIcon = L.divIcon({
        html: iconHtml,
        className: "auction-price-pin",
        iconSize: [0, 0],
      });

      const marker = L.marker([item.lat, item.lng], { icon: customIcon, zIndexOffset: zBoost });
      
      const tooltipContent = isResult ? `
        <div style="font-size:12px;font-weight:800;color:#92400e;">🏆 [실거래 낙찰] ${item.case_number} (${item.usage || "부동산"})</div>
        <div style="font-size:11px;color:#374151;max-width:240px;white-space:normal;">${item.location}</div>
        <div style="font-size:11.5px;color:#b45309;font-weight:800;margin-top:2px;">최종 낙찰: ${priceLabel} (낙찰가율 ${item.winning_rate || 0}%)</div>
      ` : isOnbid ? `
        <div style="font-size:12px;font-weight:800;color:#6b21a8;">🏛️ [온비드 공매] ${item.case_number || item.cltr_no}</div>
        <div style="font-size:11px;color:#374151;max-width:240px;white-space:normal;">${item.location || item.cltr_nm}</div>
        <div style="font-size:11px;color:#7e22ce;font-weight:800;margin-top:2px;">최저가: ${priceLabel} · ${item.reg_org_nm || "공매"}</div>
      ` : `
        <div style="font-size:12px;font-weight:700;">⚖️ [법원경매] ${item.case_number} (${item.usage || "매물"})</div>
        <div style="font-size:11px;color:#374151;max-width:220px;white-space:normal;">${item.location}</div>
        <div style="font-size:11px;color:#2563eb;font-weight:700;margin-top:2px;">최저가: ${priceLabel} (유찰 ${item.failed_count || 0}회)</div>
      `;

      marker.bindTooltip(tooltipContent, { direction: "top", offset: [0, -12] });
      marker.on("click", () => {
        setSelectedNaver(null);
        setSelectedPinnedItem(item);
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
    <div className={fullScreenMode ? "w-full" : "space-y-4"}>
      {/* 🏆 낙찰 결과 전용 지도 안내 바 (일반 모드 전용) */}
      {!fullScreenMode && assetSource === "results" && (
        <div className="flex items-center justify-between p-3 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 rounded-2xl border border-amber-300 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-base">🏆</span>
            <div>
              <div className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <span>실거래 낙찰 지도 모드</span>
                <span className="px-2 py-0.2 bg-amber-600 text-white rounded-full text-[10px] font-bold">실낙찰 핀 활성화</span>
              </div>
              <p className="text-[11px] text-amber-800">
                지도 위에 황금색 핀으로 실제 낙찰가 및 낙찰가율(%)이 표시됩니다. 핀을 클릭하면 상세 낙찰 정보를 확인하실 수 있습니다.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0 hidden sm:block">
            <span className="text-xs font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg border border-amber-200">
              총 {items.filter(it => it.lat && it.lng).length.toLocaleString()}건 위치 확인
            </span>
          </div>
        </div>
      )}

      <div className={`bg-white border border-gray-200 overflow-hidden shadow-sm ${fullScreenMode ? "rounded-2xl" : "rounded-2xl"}`}>
        {/* 1단: 지역 점프 & 네이버 상가 전용 위치·가격·거래유형 필터 바 (일반 모드 전용) */}
        {!fullScreenMode && (
          <div className="p-3.5 bg-gray-50 border-b border-gray-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-gray-700 mr-1">📍 권역 점프:</span>
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

            {/* 2단: 네이버 상가 세부 필터 */}
            {showNaver && (
              <div className="pt-2 border-t border-gray-200/80 flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-emerald-800 flex items-center gap-1">
                  <span className="px-1.5 py-0.2 rounded bg-[#03c75a] text-white text-[10px] font-black">N</span>
                  상가 상세필터:
                </span>

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

                <button
                  onClick={() => {
                    setNaverFloorType(naverFloorType === "1f" ? "" : "1f");
                    setNaverFirstFloorOnly(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    naverFloorType === "1f" || (naverFirstFloorOnly && !naverFloorType)
                      ? "bg-orange-500 text-white border-orange-500 shadow-xs"
                      : "bg-white text-orange-700 border-orange-200 hover:bg-orange-50"
                  }`}
                >
                  🏪 1층
                </button>

                <button
                  onClick={() => {
                    setNaverFloorType(naverFloorType === "b1" ? "" : "b1");
                    setNaverFirstFloorOnly(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    naverFloorType === "b1"
                      ? "bg-purple-600 text-white border-purple-600 shadow-xs ring-2 ring-purple-600/30"
                      : "bg-white text-purple-700 border-purple-200 hover:bg-purple-50"
                  }`}
                >
                  ⛳ 지하1층
                </button>

                <select
                  value={naverPyeongRange}
                  onChange={(e) => setNaverPyeongRange(e.target.value)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold border outline-none cursor-pointer ${
                    naverPyeongRange ? "border-blue-400 text-blue-700 bg-blue-50/50" : "bg-white border-gray-200 text-gray-700"
                  }`}
                >
                  <option value="">평수 전체</option>
                  <option value="under10">소형 (~10평)</option>
                  <option value="10to30">중형 (10~30평)</option>
                  <option value="30to60">중대형 (30~60평)</option>
                  <option value="over60">대형 (60평+)</option>
                </select>

                <button
                  onClick={() => setNaverFavoriteOnly(!naverFavoriteOnly)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    naverFavoriteOnly
                      ? "bg-amber-500 text-white border-amber-500 shadow-xs"
                      : "bg-white text-amber-800 border-amber-300 hover:bg-amber-50"
                  }`}
                >
                  ⭐ 관심
                </button>

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
              </div>
            )}
          </div>
        )}

        {/* 범례 바 (일반 모드 전용) */}
        {!fullScreenMode && (
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
        )}

        {/* 지도 캔버스 및 오버레이 */}
        <div className={`relative w-full ${fullScreenMode ? "h-[calc(100vh-140px)] min-h-[580px] sm:min-h-[660px]" : "h-[500px] sm:h-[580px]"} bg-gray-100 transition-all`}>
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 z-10">
              지도를 불러오는 중입니다...
            </div>
          )}
          <div ref={mapContainerRef} className="w-full h-full z-0" />

          {/* 🌟 [전체화면 모드] 좌상단 플로팅 퀵 권역 & 검색바 */}
          {fullScreenMode && (
            <div className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 max-w-[calc(100%-120px)]">
              <select
                value={naverRegion}
                onChange={(e) => {
                  const reg = PRESET_REGIONS.find((r) => r.regionKey === e.target.value);
                  setNaverRegion(e.target.value);
                  setNaverRegionInput(e.target.value);
                  if (reg) handleFlyTo(reg.lat, reg.lng, reg.zoom);
                }}
                className="px-2.5 py-1.5 bg-white/95 backdrop-blur-md rounded-xl text-xs font-black text-gray-800 shadow-md border border-gray-200 outline-none cursor-pointer"
              >
                {PRESET_REGIONS.map((r) => (
                  <option key={r.label} value={r.regionKey}>
                    {r.label}
                  </option>
                ))}
              </select>

              <div className="hidden sm:flex items-center bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl px-2 py-1 shadow-md">
                <input
                  type="text"
                  placeholder="동네/역 검색"
                  value={naverRegionInput}
                  onChange={(e) => setNaverRegionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setNaverRegion(naverRegionInput);
                    }
                  }}
                  className="text-xs text-gray-800 outline-none w-28 placeholder:text-gray-400"
                />
                {naverRegionInput && (
                  <button
                    onClick={() => {
                      setNaverRegionInput("");
                      setNaverRegion("");
                    }}
                    className="text-gray-400 hover:text-gray-600 text-xs px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 🌟 [전체화면 모드] 우상단 수도권 퀵 복귀 버튼 */}
          {fullScreenMode && (
            <div className="absolute top-3 right-3 z-[400] flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleFlyTo(37.43, 127.08, 11)}
                className="px-2.5 py-1.5 bg-white/95 backdrop-blur-md rounded-xl text-xs font-extrabold text-gray-700 shadow-md border border-gray-200 hover:bg-gray-50 cursor-pointer"
                title="수도권 중심 좌표로 이동"
              >
                🌐 수도권
              </button>
            </div>
          )}

          {/* 🌟 [전체화면 모드] 하단 플로팅 필터 독 & 매물 목록 보기 버튼 */}
          {fullScreenMode && !isDrawerOpen && !selectedPinnedItem && !selectedNaver && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[420] w-[95%] max-w-md flex flex-col items-center gap-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
              {/* 4대 소스 토글 필 버튼들 */}
              <div className="flex items-center justify-center gap-1 p-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200 w-full overflow-x-auto">
                {/* 1. ⚖️ 경매 */}
                <button
                  type="button"
                  onClick={() => onToggleSource && onToggleSource("auction")}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    selectedSources?.auction
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-gray-100 text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <span className="whitespace-nowrap break-keep">⚖️ 경매</span>
                  <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${selectedSources?.auction ? "bg-white/20 text-white" : "text-gray-400"}`}>
                    {sourceCounts?.auction ?? items.filter((i) => i.source === "auction" || !i.source).length}
                  </span>
                </button>

                {/* 2. 🏛️ 공매 */}
                <button
                  type="button"
                  onClick={() => onToggleSource && onToggleSource("onbid")}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    selectedSources?.onbid
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-gray-100 text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <span className="whitespace-nowrap break-keep">🏛️ 공매</span>
                  <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${selectedSources?.onbid ? "bg-white/20 text-white" : "text-gray-400"}`}>
                    {sourceCounts?.onbid ?? items.filter((i) => i.source === "onbid").length}
                  </span>
                </button>

                {/* 3. 🟢 네이버 */}
                <button
                  type="button"
                  onClick={() => {
                    if (onToggleSource) onToggleSource("naver");
                    setShowNaver(!showNaver);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    (selectedSources?.naver ?? showNaver)
                      ? "bg-[#03c75a] text-white shadow-xs"
                      : "bg-gray-100 text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <span className="whitespace-nowrap break-keep">🟢 시세</span>
                  <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${(selectedSources?.naver ?? showNaver) ? "bg-white/20 text-white" : "text-gray-400"}`}>
                    {naverTotalMatching || naverItems.length}
                  </span>
                </button>

                {/* 4. 🏆 낙찰 */}
                <button
                  type="button"
                  onClick={() => onToggleSource && onToggleSource("results")}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                    selectedSources?.results
                      ? "bg-amber-600 text-white shadow-xs"
                      : "bg-gray-100 text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <span className="whitespace-nowrap break-keep">🏆 낙찰</span>
                  <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${selectedSources?.results ? "bg-white/20 text-white" : "text-gray-400"}`}>
                    {sourceCounts?.results ?? items.filter((i) => i.source === "results" || i.winning_bid).length}
                  </span>
                </button>
              </div>

              {/* 매물 목록 열기 버튼 */}
              <button
                type="button"
                onClick={() => {
                  setIsDrawerOpen(true);
                  setDrawerTab("list");
                }}
                className="w-full py-2.5 px-4 bg-gray-900/95 hover:bg-black text-white text-xs sm:text-sm font-black rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between border border-gray-700 cursor-pointer active:scale-98 transition-all"
              >
                <span className="flex items-center gap-1.5">
                  <span>📋</span>
                  <span>매물 목록 보기</span>
                </span>
                <span className="flex items-center gap-1 text-[11px] text-gray-300 bg-white/20 px-2.5 py-0.5 rounded-full font-bold">
                  <span>총 {(items.length + (showNaver ? naverItems.length : 0)).toLocaleString()}건</span>
                  <span>▲</span>
                </span>
              </button>
            </div>
          )}

          {/* 🌟 [바텀시트 (Bottom Sheet / Drawer)] 매물 목록 및 상세 정보 */}
          {(isDrawerOpen || selectedPinnedItem || selectedNaver) && (
            <div className="absolute inset-x-0 bottom-0 max-h-[70vh] sm:max-h-[60vh] bg-white rounded-t-3xl shadow-2xl border-t border-gray-200 z-[530] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200">
              {/* 바텀시트 상단 헤더 & 탭 */}
              <div className="px-4 pt-2.5 pb-2 bg-gray-50 border-b border-gray-200 shrink-0">
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-2" />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {(selectedPinnedItem || selectedNaver) && (
                      <button
                        type="button"
                        onClick={() => setDrawerTab("pinned")}
                        className={`px-3 py-1 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                          drawerTab === "pinned"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        }`}
                      >
                        📌 선택 매물 상세
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDrawerTab("list")}
                      className={`px-3 py-1 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                        drawerTab === "list" || (!selectedPinnedItem && !selectedNaver)
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                      }`}
                    >
                      📋 지도 매물 목록 ({(items.length + (showNaver ? naverItems.length : 0)).toLocaleString()}건)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsDrawerOpen(false);
                      setSelectedPinnedItem(null);
                      setSelectedNaver(null);
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-gray-500 hover:text-gray-900 bg-white hover:bg-gray-100 rounded-lg border border-gray-200 cursor-pointer flex items-center gap-1"
                  >
                    <span>✕ 지도 전체보기</span>
                  </button>
                </div>
              </div>

              {/* 바텀시트 본문 스크롤 영역 */}
              <div className="flex-1 overflow-y-auto p-4">
                {/* 1. 선택 매물 상세 탭 (또는 핀이 선택되었을 때) */}
                {(drawerTab === "pinned" || (!isDrawerOpen && (selectedPinnedItem || selectedNaver))) && (
                  <div>
                    {selectedPinnedItem && (
                      <div className="max-w-xl mx-auto space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`px-2.5 py-0.5 rounded-md text-xs font-black text-white ${
                              selectedPinnedItem.source === "results" || selectedPinnedItem.winning_bid
                                ? "bg-amber-600"
                                : selectedPinnedItem.source === "onbid"
                                ? "bg-purple-600"
                                : "bg-blue-600"
                            }`}>
                              {selectedPinnedItem.source === "results" || selectedPinnedItem.winning_bid
                                ? "🏆 낙찰결과"
                                : selectedPinnedItem.source === "onbid"
                                ? "🏛️ 온비드 공매"
                                : `⚖️ 법원경매 ${selectedPinnedItem.ai_grade ? `(${selectedPinnedItem.ai_grade}등급)` : ""}`}
                            </span>
                            <span className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-md">
                              {selectedPinnedItem.case_number || selectedPinnedItem.cltr_no}
                            </span>
                            {selectedPinnedItem.usage && (
                              <span className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                                {selectedPinnedItem.usage}
                              </span>
                            )}
                          </div>
                        </div>

                        <h4 className="text-base font-extrabold text-gray-900">
                          📍 {selectedPinnedItem.location || selectedPinnedItem.cltr_nm}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {selectedPinnedItem.area_pyeong || selectedPinnedItem.bld_area_pyeong ? (
                            <span>전용 <strong className="text-gray-800">{selectedPinnedItem.area_pyeong || selectedPinnedItem.bld_area_pyeong}평</strong> · </span>
                          ) : null}
                          <span>{selectedPinnedItem.floor ? (selectedPinnedItem.floor < 0 ? `지하${Math.abs(selectedPinnedItem.floor)}층` : `${selectedPinnedItem.floor}층`) : "층수미상"}</span>
                          {selectedPinnedItem.reg_org_nm ? ` · ${selectedPinnedItem.reg_org_nm}` : ""}
                        </p>

                        {/* 가격 브리핑 */}
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          {selectedPinnedItem.winning_bid && selectedPinnedItem.winning_bid > 0 ? (
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-xs font-bold text-amber-900 block">최종 낙찰가</span>
                                <span className="text-lg font-black text-amber-700">
                                  {selectedPinnedItem.winning_bid.toLocaleString()}원
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs font-extrabold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full">
                                  낙찰가율 {selectedPinnedItem.winning_rate || 0}%
                                </span>
                                {selectedPinnedItem.bidder_count ? (
                                  <span className="block text-[11px] text-gray-500 mt-1">
                                    경쟁률 {selectedPinnedItem.bidder_count}명 응찰
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-xs font-bold text-blue-900 block">최저 입찰가</span>
                                <span className="text-lg font-black text-blue-700">
                                  {(selectedPinnedItem.min_bid || 0).toLocaleString()}원
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs text-gray-500 line-through block">
                                  감정 {(selectedPinnedItem.appraisal || 0).toLocaleString()}원
                                </span>
                                {selectedPinnedItem.failed_count !== undefined && (
                                  <span className="text-xs font-bold text-rose-600">
                                    유찰 {selectedPinnedItem.failed_count}회
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 하단 액션 버튼 */}
                        <div className="flex items-center gap-2 pt-1">
                          {onAddToPlanner && (
                            <button
                              type="button"
                              onClick={() => {
                                const src = selectedPinnedItem.source === "results" ? "results" : selectedPinnedItem.source === "onbid" ? "onbid" : "auction";
                                onAddToPlanner(selectedPinnedItem, src);
                              }}
                              className="px-3 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                            >
                              <span>📍</span> <span>임장담기</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectItem(selectedPinnedItem)}
                            className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs transition-colors cursor-pointer text-center"
                          >
                            🔍 AI 상세분석 & 권리분석 열기
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedNaver && (
                      <div className="max-w-xl mx-auto space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-[#03c75a] text-white text-xs font-extrabold">
                              N 네이버 상가 ({selectedNaver.trade_type})
                            </span>
                            {selectedNaver.floor === 1 ? (
                              <span className="px-2 py-0.5 rounded-md bg-orange-500 text-white text-xs font-extrabold">
                                ✨ 1층 상가
                              </span>
                            ) : selectedNaver.floor ? (
                              <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs font-bold">
                                {selectedNaver.floor < 0 ? `지하${Math.abs(selectedNaver.floor)}층` : `${selectedNaver.floor}층`} / {selectedNaver.total_floor || "-"}층
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <h4 className="text-base font-extrabold text-gray-900">
                          {selectedNaver.article_name || "일반상가"}
                        </h4>
                        <p className="text-xs text-gray-500">
                          📍 {selectedNaver.addr_sgg} {selectedNaver.addr_emd} · 전용{" "}
                          <strong className="text-gray-800">{selectedNaver.area_pyeong}평</strong> ({selectedNaver.area_m2}㎡)
                        </p>

                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
                          {selectedNaver.trade_type === "매매" ? (
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-emerald-800">네이버 매매 호가</span>
                              <div className="text-right">
                                <span className="text-lg font-black text-emerald-700">
                                  {formatNaverPrice10k(selectedNaver.price_sale_10k)}원
                                </span>
                                {selectedNaver.area_pyeong > 0 && (
                                  <span className="block text-[11px] text-emerald-600 font-semibold">
                                    평당 {Math.round(selectedNaver.price_sale_10k / selectedNaver.area_pyeong).toLocaleString()}만원
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-emerald-800">네이버 보증금 / 월세</span>
                              <div className="text-right">
                                <span className="text-lg font-black text-emerald-700">
                                  {formatNaverPrice10k(selectedNaver.deposit_10k)} / 월 {formatNaverPrice10k(selectedNaver.monthly_rent_10k)}
                                </span>
                                {selectedNaver.area_pyeong > 0 && (
                                  <span className="block text-[11px] text-emerald-600 font-semibold">
                                    평당 월세 {(selectedNaver.monthly_rent_10k / selectedNaver.area_pyeong).toFixed(1)}만원
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-gray-400 truncate">
                            {selectedNaver.realtor || "공인중개사"} {selectedNaver.confirm_date ? `· 확인 ${selectedNaver.confirm_date}` : ""}
                          </span>
                          <a
                            href={selectedNaver.detail_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-2 rounded-xl bg-[#03c75a] hover:bg-emerald-600 text-white text-xs font-extrabold transition-colors shrink-0"
                          >
                            네이버 부동산 원문 ↗
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 지도 내 매물 스크롤 리스트 탭 */}
                {(drawerTab === "list" || (!selectedPinnedItem && !selectedNaver)) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {/* 경매/공매/낙찰 아이템들 */}
                    {items.slice(0, 50).map((it, idx) => {
                      const isResults = it.source === "results" || !!it.winning_bid;
                      const isOnbid = it.source === "onbid";
                      return (
                        <div
                          key={it.case_number || it.cltr_no || idx}
                          onClick={() => {
                            setSelectedPinnedItem(it);
                            setSelectedNaver(null);
                            setDrawerTab("pinned");
                            if (it.lat && it.lng) handleFlyTo(it.lat, it.lng, 16);
                          }}
                          className="p-3 rounded-2xl border border-gray-200 hover:border-blue-500 bg-gray-50/50 hover:bg-blue-50/30 transition-all cursor-pointer flex flex-col justify-between gap-1.5"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white ${
                              isResults ? "bg-amber-600" : isOnbid ? "bg-purple-600" : "bg-blue-600"
                            }`}>
                              {isResults ? "🏆 낙찰" : isOnbid ? "🏛️ 공매" : "⚖️ 경매"}
                            </span>
                            <span className="text-xs font-bold text-gray-700 truncate max-w-[200px]">
                              {it.case_number || it.cltr_no}
                            </span>
                            <span className="text-[11px] font-bold text-gray-500">
                              {it.area_pyeong || it.bld_area_pyeong ? `${it.area_pyeong || it.bld_area_pyeong}평` : ""}
                            </span>
                          </div>

                          <h5 className="text-xs font-extrabold text-gray-900 line-clamp-1">
                            {it.location || it.cltr_nm}
                          </h5>

                          <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 text-xs">
                            <span className="font-extrabold text-blue-700">
                              {isResults
                                ? `낙찰 ${(it.winning_bid || 0).toLocaleString()}원 (${it.winning_rate || 0}%)`
                                : `최저 ${(it.min_bid || 0).toLocaleString()}원`}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              {it.reg_org_nm || it.usage || "상세보기 ↗"}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* 네이버 상가 아이템들 */}
                    {showNaver &&
                      naverItems.slice(0, 30).map((n) => (
                        <div
                          key={n.article_id}
                          onClick={() => {
                            setSelectedNaver(n);
                            setSelectedPinnedItem(null);
                            setDrawerTab("pinned");
                            if (n.lat && n.lng) handleFlyTo(n.lat, n.lng, 16);
                          }}
                          className="p-3 rounded-2xl border border-gray-200 hover:border-emerald-500 bg-gray-50/50 hover:bg-emerald-50/30 transition-all cursor-pointer flex flex-col justify-between gap-1.5"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#03c75a] text-white">
                              🟢 네이버
                            </span>
                            <span className="text-xs font-bold text-gray-700 truncate max-w-[200px]">
                              {n.article_name || "일반상가"}
                            </span>
                            <span className="text-[11px] font-bold text-gray-500">
                              {n.area_pyeong}평
                            </span>
                          </div>

                          <h5 className="text-xs font-extrabold text-gray-900 line-clamp-1">
                            📍 {n.addr_sgg} {n.addr_emd}
                          </h5>

                          <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 text-xs">
                            <span className="font-extrabold text-emerald-700">
                              {n.trade_type === "매매"
                                ? `매매 ${formatNaverPrice10k(n.price_sale_10k)}원`
                                : `월세 ${formatNaverPrice10k(n.deposit_10k)}/${formatNaverPrice10k(n.monthly_rent_10k)}`}
                            </span>
                            <span className="text-[11px] text-emerald-600 font-bold">
                              네이버 매물 ↗
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 네이버 상가 실매물 카드 리스트 (일반 모드 전용) */}
      {!fullScreenMode && showNaver && (
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
