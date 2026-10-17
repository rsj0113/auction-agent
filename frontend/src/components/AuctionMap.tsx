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
  lat?: number;
  lng?: number;
}

interface AuctionMapProps {
  items: MapItem[];
  onSelectItem: (item: any) => void;
  focusRegion?: string;
}

const PRESET_REGIONS = [
  { label: "🎯 성남·분당", lat: 37.395, lng: 127.125, zoom: 12 },
  { label: "🏙️ 서울 전체", lat: 37.541, lng: 126.986, zoom: 11 },
  { label: "💎 강남·서초·송파", lat: 37.502, lng: 127.055, zoom: 12 },
  { label: "🌳 경기 남부(수원·용인)", lat: 37.275, lng: 127.075, zoom: 11 },
  { label: "🌲 경기 북부(고양·남양주)", lat: 37.655, lng: 127.015, zoom: 11 },
];

export default function AuctionMap({ items, onSelectItem, focusRegion }: AuctionMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // Load Leaflet CSS & JS dynamically via CDN (no extra npm dependency needed)
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

  // Initialize map
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      // 기본 중심: 성남·서울 수도권이 한눈에 보이는 좌표
      const map = L.map(mapContainerRef.current, {
        center: [37.45, 127.08],
        zoom: 11,
        zoomControl: true,
      });

      // API 키가 전혀 필요 없고 한글 지명/지하철역이 선명하게 나오는 OpenStreetMap 공식 타일
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

  // Render markers when items change
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !markersLayerRef.current) return;
    const L = (window as any).L;
    const layerGroup = markersLayerRef.current;
    layerGroup.clearLayers();

    const validItems = items.filter((it) => typeof it.lat === "number" && typeof it.lng === "number" && it.lat > 33 && it.lng > 124);

    validItems.forEach((item) => {
      const grade = (item.ai_grade || "B").toUpperCase();
      const bg =
        grade === "S"
          ? "#7c3aed"
          : grade === "A"
          ? "#2563eb"
          : grade === "B"
          ? "#059669"
          : grade === "C"
          ? "#d97706"
          : "#dc2626";

      const priceLabel = formatMoneyShort(item.min_bid);
      const discLabel = item.market_discount_pct && item.market_discount_pct > 0 ? `-${Math.round(item.market_discount_pct)}%` : "";

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
          box-shadow:0 3px 8px rgba(0,0,0,0.28);
          border:2px solid #ffffff;
          transform:translate(-50%, -50%);
          cursor:pointer;
        ">
          <span>${grade}</span>
          <span>${priceLabel}</span>
          ${discLabel ? `<span style="background:rgba(255,255,255,0.22);padding:0 4px;border-radius:6px;font-size:10px;">${discLabel}</span>` : ""}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: "auction-price-pin",
        iconSize: [0, 0],
      });

      const zBoost =
        grade === "S" ? 1000 : grade === "A" ? 800 : grade === "B" ? 500 : grade === "C" ? 200 : 0;

      const marker = L.marker([item.lat, item.lng], { icon: customIcon, zIndexOffset: zBoost });
      marker.bindTooltip(
        `<div style="font-size:12px;font-weight:700;">${item.case_number} (${item.usage || "매물"})</div>
         <div style="font-size:11px;color:#374151;max-width:220px;white-space:normal;">${item.location}</div>
         <div style="font-size:11px;color:#2563eb;font-weight:700;margin-top:2px;">최저가: ${priceLabel} (유찰 ${item.failed_count}회)</div>`,
        { direction: "top", offset: [0, -12] }
      );
      marker.on("click", () => {
        onSelectItem(item);
      });
      marker.addTo(layerGroup);
    });

    // 검색어나 필터로 매물이 좁혀졌을 때 해당 매물들 중심으로 자동 이동
    if (validItems.length > 0 && validItems.length <= 150) {
      const bounds = L.latLngBounds(validItems.map((i) => [i.lat, i.lng]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
    }
  }, [items, mapReady, focusRegion]);

  const handleFlyTo = (lat: number, lng: number, zoom: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], zoom, { duration: 0.8 });
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* 상단 지역 원클릭 점프 바 */}
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
        <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"></span>S등급</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>A등급</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span>B등급</span>
          <span className="text-gray-700 font-bold ml-1">표시 매물 {items.length.toLocaleString()}건</span>
        </div>
      </div>

      {/* 지도 캔버스 */}
      <div className="relative w-full h-[480px] sm:h-[560px] bg-gray-100">
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 z-10">
            지도를 불러오는 중입니다...
          </div>
        )}
        <div ref={mapContainerRef} className="w-full h-full z-0" />
      </div>
    </div>
  );
}
