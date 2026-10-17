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
}

interface AuctionMapProps {
  items: MapItem[];
  onSelectItem: (item: any) => void;
  focusRegion?: string;
}

const PRESET_REGIONS = [
  { label: "🎯 성남·분당", lat: 37.395, lng: 127.125, zoom: 13 },
  { label: "🏙️ 서울 전체", lat: 37.525, lng: 127.025, zoom: 12 },
  { label: "💎 강남·서초·송파", lat: 37.502, lng: 127.055, zoom: 13 },
  { label: "🌳 수원·안양", lat: 37.315, lng: 127.005, zoom: 12 },
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
  const dep = n.deposit_10k >= 10000 ? `${(n.deposit_10k / 10000).toFixed(1).replace(/\.0$/, "")}억` : `${n.deposit_10k}`;
  return `월세 ${dep}/${n.monthly_rent_10k}`;
}

export default function AuctionMap({ items, onSelectItem, focusRegion }: AuctionMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // 네이버 상가 실매물 오버레이 상태
  const [showNaver, setShowNaver] = useState(true);
  const [naverFirstFloorOnly, setNaverFirstFloorOnly] = useState(false);
  const [naverTradeType, setNaverTradeType] = useState<"" | "매매" | "월세">("");
  const [naverItems, setNaverItems] = useState<NaverShopItem[]>([]);
  const [selectedNaver, setSelectedNaver] = useState<NaverShopItem | null>(null);

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

  // Fetch Naver commercial listings
  useEffect(() => {
    if (!showNaver) {
      setNaverItems([]);
      return;
    }
    const params = new URLSearchParams();
    params.set("limit", "350");
    if (focusRegion && focusRegion.trim()) {
      params.set("region", focusRegion.trim());
    }
    if (naverTradeType) {
      params.set("trade_type", naverTradeType);
    }
    if (naverFirstFloorOnly) {
      params.set("first_floor_only", "true");
    }

    fetch(`/api/naver-listings?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json) => {
        if (json && Array.isArray(json.data)) {
          setNaverItems(json.data);
        }
      })
      .catch(() => {});
  }, [showNaver, focusRegion, naverFirstFloorOnly, naverTradeType]);

  // Initialize map
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [37.395, 127.125], // 성남·분당 중심 기본 시작
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
    if (showNaver && naverItems.length > 0) {
      const validNaver = naverItems.filter(
        (n) => typeof n.lat === "number" && typeof n.lng === "number" && n.lat > 33 && n.lng > 124
      );

      validNaver.forEach((n) => {
        const isFirstFloor = n.floor === 1;
        const floorText = isFirstFloor ? "1층 " : n.floor && n.floor < 0 ? `B${Math.abs(n.floor)} ` : n.floor ? `${n.floor}층 ` : "";
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
    }

    // 2. 법원 경매 핀 렌더링 (항상 상단 레이어 우선)
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

  // Move map only when focusRegion changes explicitly
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !focusRegion) return;
    const L = (window as any).L;
    const validItems = items.filter(
      (it) => typeof it.lat === "number" && typeof it.lng === "number" && it.lat > 33 && it.lng > 124
    );
    if (validItems.length > 0 && validItems.length <= 150) {
      const bounds = L.latLngBounds(validItems.map((i) => [i.lat, i.lng]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    }
  }, [focusRegion, mapReady]);

  const handleFlyTo = (lat: number, lng: number, zoom: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], zoom, { duration: 0.8 });
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {/* 상단 지역 이동 + 네이버 상가 오버레이 컨트롤 바 */}
        <div className="px-3.5 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-gray-700 mr-1">📍 빠른 지역 이동:</span>
            {PRESET_REGIONS.map((reg) => (
              <button
                key={reg.label}
                onClick={() => handleFlyTo(reg.lat, reg.lng, reg.zoom)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-blue-50 text-gray-700 hover:text-blue-700 border border-gray-200 hover:border-blue-200 transition-colors cursor-pointer shadow-2xs"
              >
                {reg.label}
              </button>
            ))}
          </div>

          {/* 네이버 부동산 상가 필터 토글 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setShowNaver(!showNaver)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                showNaver
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <span>🟢 네이버 상가 같이보기</span>
              <span className="px-1.5 py-0.2 rounded bg-black/15 text-[10px]">
                {showNaver ? `${naverItems.length}건 ON` : "OFF"}
              </span>
            </button>

            {showNaver && (
              <>
                <button
                  onClick={() => setNaverFirstFloorOnly(!naverFirstFloorOnly)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    naverFirstFloorOnly
                      ? "bg-orange-500 text-white border-orange-500 shadow-xs"
                      : "bg-white text-orange-700 border-orange-200 hover:bg-orange-50"
                  }`}
                >
                  🏪 네이버 1층 상가만
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
              </>
            )}
          </div>
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
              네이버 상가 실매물 ({naverItems.length}건)
            </span>
            <span className="text-gray-400 text-[10px]">
              * 지도에서 N(초록 핀)을 클릭하면 상가 시세 상세 및 네이버 부동산 원문으로 이동합니다
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
                <button
                  onClick={() => setSelectedNaver(null)}
                  className="text-gray-400 hover:text-gray-700 text-sm font-bold px-1.5 cursor-pointer"
                >
                  ✕
                </button>
              </div>

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

      {/* 하단 네이버 상가 실매물 카드 리스트 (같이보기 ON 일 때 표시) */}
      {showNaver && naverItems.length > 0 && (
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#03c75a] text-white text-xs font-black">N</span>
              <h3 className="text-sm sm:text-base font-extrabold text-gray-900">
                네이버 부동산 상가 실매물 ({naverItems.length.toLocaleString()}건)
              </h3>
              <span className="text-xs text-gray-500">
                경매 물건과 주변 실제 상가 매매·월세 호가를 즉시 비교하세요
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {naverItems.slice(0, 60).map((n) => {
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
                      <div className="flex items-center gap-1">
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
                      <span className="text-[11px] font-extrabold text-gray-700">
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
        </div>
      )}
    </div>
  );
}
