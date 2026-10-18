"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";

export interface ChecklistState {
  leakChecked: boolean;       // 누수 / 방수 / 결로 확인
  vacancyChecked: boolean;    // 공실 여부 / 실제 점유자(임차인 or 소유자)
  feeChecked: boolean;        // 미납 관리비(공용/전용) 확인
  parkingChecked: boolean;    // 주차 대수 및 진입로 확인
  realtorChecked: boolean;    // 인근 공인중개업소 전월세 시세 탐문
}

export interface InspectionItem {
  id: string;
  source: "auction" | "onbid" | "naver";
  title: string;
  location: string;
  lat: number;
  lng: number;
  usage?: string;
  floorText: string;
  priceText: string;
  appraisalText?: string;
  discountText?: string;
  detailUrl?: string;
  keyFeatures: string[];
  checklist: ChecklistState;
  memo: string;
  completed: boolean;
  completedAt?: string;
}

// 🎯 성남 추천 코스 1: 성남 원도심(수정·중원구) 빌라 & 알짜 상가
const PRESET_SEONGNAM_VILLAS_SHOPS: InspectionItem[] = [
  {
    id: "2026타경50020",
    source: "auction",
    title: "수정구 태평동 3294 402호 (실거주·재개발 빌라)",
    location: "경기도 성남시 수정구 태평동 3294 4층402호",
    lat: 37.445501,
    lng: 127.131857,
    usage: "다세대/빌라",
    floorText: "지상 4층",
    priceText: "최저 2억 2,330만원",
    appraisalText: "감정 3억 1,900만원",
    discountText: "70% (1회 유찰)",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+수정구+태평동+3294",
    keyFeatures: ["대항력 없음(인수안전)", "전용 39.6평 대형", "태평역 역세권 생활권", "내일(10/19) 입찰기일"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2026-09905-001",
    source: "onbid",
    title: "수정구 태평동 5611 태평빌딩 203호 (소액 3천만원대 구분상가)",
    location: "경기도 성남시 수정구 태평동 5611 태평빌딩 2층 203호",
    lat: 37.4468,
    lng: 127.1345,
    usage: "근린상가",
    floorText: "지상 2층",
    priceText: "최저 3,090만원",
    appraisalText: "감정 1억 300만원",
    discountText: "🔥 70% 할인",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+수정구+태평동+5611",
    keyFeatures: ["소액 3,000만원 투자", "캠코 온비드 세금압류 매각", "마감 10/21(수)"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2026-06583-001",
    source: "onbid",
    title: "중원구 은행동 1257 3층 301호 (7천만원대 다세대 빌라)",
    location: "경기도 성남시 중원구 은행동 1257 3층 301호",
    lat: 37.4532,
    lng: 127.1652,
    usage: "다세대/빌라",
    floorText: "지상 3층",
    priceText: "최저 7,860만원",
    appraisalText: "감정 1억 3,100만원",
    discountText: "📉 40% 할인",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+중원구+은행동+1257",
    keyFeatures: ["7천만원대 소액 빌라", "지상 3층 로열층", "을지대 성남캠퍼스 배후", "온비드 매각"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2025타경52536",
    source: "auction",
    title: "중원구 상대원동 2569 (통 다가구주택 36평)",
    location: "경기도 성남시 중원구 상대원동 2569",
    lat: 37.435366,
    lng: 127.179077,
    usage: "단독/다가구",
    floorText: "건물 전체 (1층 창고 포함)",
    priceText: "최저 6억 9,007만원",
    appraisalText: "감정 9억 8,581만원",
    discountText: "70% (1회 유찰)",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+중원구+상대원동+2569",
    keyFeatures: ["성남하이테크밸리 배후", "월세 수익형 통건물", "제시외 건물 포함 일괄매각", "내일(10/19) 기일"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2025타경2219",
    source: "auction",
    title: "중원구 성남동 3499 니즈몰 7층 (모란역 1천만원대 초저가 상가)",
    location: "경기도 성남시 중원구 성남동 3499 니즈몰 7층7009호",
    lat: 37.431435,
    lng: 127.135088,
    usage: "상가/근린시설",
    floorText: "지상 7층",
    priceText: "최저 1,137만원",
    appraisalText: "감정 9,600만원",
    discountText: "📉 11.8% 폭락 유찰",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+중원구+성남동+3499",
    keyFeatures: ["모란역 초역세권 대형몰", "473평 대형 점포", "체납관리비 확인 필수"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
];

// 🌲 성남 추천 코스 2: 분당·판교 상권 & 광주 삼동 엠포빌리지 가성비 투어
const PRESET_BUNDANG_GWANGJU: InspectionItem[] = [
  {
    id: "2026-0400-017876",
    source: "onbid",
    title: "분당구 서현동 90 근린생활 127호 (서현역 1층 상가 공공임대)",
    location: "경기도 성남시 분당구 서현동 90",
    lat: 37.3852,
    lng: 127.1245,
    usage: "상가/근린시설",
    floorText: "지상 1층",
    priceText: "연 773만원 (월 64만원)",
    appraisalText: "감정 연 1,209만원",
    discountText: "36% 할인 (공공임대)",
    detailUrl: "https://map.kakao.com/link/search/경기도+성남시+분당구+서현동+90",
    keyFeatures: ["서현역 역세권 1층", "스포츠센터 배후 유동인구", "공공임대 안정성"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2654866335",
    source: "naver",
    title: "분당구 야탑동 복합상가 1층 (평당 938만 급매)",
    location: "성남시 분당구 야탑동 복합상가 1층",
    lat: 37.4115,
    lng: 127.1285,
    usage: "상가/근린시설",
    floorText: "지상 1층 전면",
    priceText: "매매 4억 5,000만원",
    appraisalText: "-",
    discountText: "평당 938만원 급매",
    detailUrl: "https://map.kakao.com/link/search/성남시+분당구+야탑동",
    keyFeatures: ["1층 48평 대형", "전면창 개방감 우수", "시세 비교 기준 매물"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2025타경51821",
    source: "auction",
    title: "광주시 삼동 엠포빌리지 302호 (감정 2.1억 ➡️ 최저 2,400만원 대형빌라)",
    location: "경기도 광주시 삼동 310-1 엠포빌리지 3층 302호",
    lat: 37.437748,
    lng: 127.257692,
    usage: "다세대/빌라",
    floorText: "지상 3층",
    priceText: "최저 2,482만원",
    appraisalText: "감정 2억 1,000만원",
    discountText: "📉 11.8% 파격 유찰",
    detailUrl: "https://map.kakao.com/link/search/경기도+광주시+삼동+310-1",
    keyFeatures: ["경강선 삼동역(판교 2정거장)", "전용 39.6평 대형 빌라", "내일(10/19) 입찰기일"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
  {
    id: "2025타경51859",
    source: "auction",
    title: "광주시 신현동 포레스트타운 302호 (분당 서현동 인접 3천만 빌라)",
    location: "경기도 광주시 신현동 883-11 포레스트타운 312동 3층 302호",
    lat: 37.439042,
    lng: 127.267086,
    usage: "다세대/빌라",
    floorText: "지상 3층",
    priceText: "최저 3,625만원",
    appraisalText: "감정 1억 5,100만원",
    discountText: "24% 수준 유찰",
    detailUrl: "https://map.kakao.com/link/search/경기도+광주시+신현동+883-11",
    keyFeatures: ["분당 판교/서현 진입 버스 밀집", "3천만원대 소액 투자", "내일(10/19) 기일"],
    checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
    memo: "",
    completed: false,
  },
];

const LOCAL_STORAGE_KEY = "auction_field_trip_planner_v1";

// 위경도 기반 Haversine 거리 계산 (km)
function calcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 지구 반경 km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// 거리(km) 기반 예상 차량 이동 시간 (분) - 도심 우회 및 신호 감안
function estimateTravelMinutes(distKm: number): number {
  if (distKm <= 0.1) return 3;
  // 도심 주행 평균 시속 24km/h 기준 + 신호대기 4분
  const roadDist = distKm * 1.35;
  const mins = Math.round((roadDist / 24) * 60) + 4;
  return Math.max(5, mins);
}

// "HH:MM" 형식에 분(minutes)을 더하여 반환
function addMinutes(timeStr: string, minutesToAdd: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutesToAdd;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export default function FieldTripPlannerPage() {
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [startTime, setStartTime] = useState("10:00");
  const [stayDurationMinutes, setStayDurationMinutes] = useState(35); // 매물당 체류 시간 (분)
  const [activeTab, setActiveTab] = useState<"both" | "timeline" | "map">("both");
  const [expandedChecklistId, setExpandedChecklistId] = useState<string | null>(null);

  // 직접 매물 추가 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addFloor, setAddFloor] = useState("지상 1층");
  const [addUsage, setAddUsage] = useState("다세대/빌라");
  const [addNote, setAddNote] = useState("");

  const handleDirectAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addLocation.trim()) {
      alert("소재지(주소)를 입력해주세요.");
      return;
    }
    let lat = 37.441;
    let lng = 127.135;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addLocation)}&format=json&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
        }
      }
    } catch {}

    const newItem: InspectionItem = {
      id: `custom-${Date.now()}`,
      source: "naver",
      title: addTitle.trim() || addLocation.trim(),
      location: addLocation.trim(),
      lat,
      lng,
      usage: addUsage,
      floorText: addFloor,
      priceText: addPrice || "가격 미정",
      appraisalText: "-",
      discountText: "직접 추가",
      detailUrl: `https://map.kakao.com/link/search/${encodeURIComponent(addLocation)}`,
      keyFeatures: [addUsage, addNote].filter(Boolean),
      checklist: { leakChecked: false, vacancyChecked: false, feeChecked: false, parkingChecked: false, realtorChecked: false },
      memo: addNote,
      completed: false,
    };

    setItems((prev) => [...prev, newItem]);
    setIsAddModalOpen(false);
    setAddTitle("");
    setAddLocation("");
    setAddPrice("");
    setAddNote("");
  };

  // Leaflet 지도 Ref
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersGroupRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  // 로컬스토리지 로드
  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setItems(parsed);
          return;
        }
      }
    } catch {}
    // 기본 프리셋 로드: 성남 원도심 빌라+상가
    setItems(PRESET_SEONGNAM_VILLAS_SHOPS);
  }, []);

  // 로컬스토리지 저장
  useEffect(() => {
    if (!isClient) return;
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items, isClient]);

  // Leaflet CDN 로드
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

    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setMapReady(true);
    document.body.appendChild(script);
  }, []);

  // 타임라인 스케줄 계산 (시작 시간, 체류 시간, 이동 시간 결합)
  const schedule = useMemo(() => {
    let curTime = startTime;
    return items.map((item, idx) => {
      const arrival = curTime;
      const departure = addMinutes(arrival, stayDurationMinutes);

      let travelToNext = 0;
      let distToNext = 0;
      if (idx < items.length - 1) {
        const next = items[idx + 1];
        distToNext = calcDistanceKm(item.lat, item.lng, next.lat, next.lng);
        travelToNext = estimateTravelMinutes(distToNext);
        curTime = addMinutes(departure, travelToNext);
      }

      return {
        item,
        index: idx + 1,
        arrival,
        departure,
        travelToNext,
        distToNext,
      };
    });
  }, [items, startTime, stayDurationMinutes]);

  // 완료 통계
  const completedCount = useMemo(() => items.filter((i) => i.completed).length, [items]);
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
  const totalTravelKm = useMemo(() => {
    let total = 0;
    for (let i = 0; i < items.length - 1; i++) {
      total += calcDistanceKm(items[i].lat, items[i].lng, items[i + 1].lat, items[i + 1].lng);
    }
    return Math.round(total * 10) / 10;
  }, [items]);

  // 지도 인스턴스 초기화 및 마커/폴리라인 렌더링
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: items.length > 0 ? [items[0].lat, items[0].lng] : [37.44, 127.14],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      markersGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (items.length === 0) return;

    const latlngs: [number, number][] = [];

    items.forEach((item, idx) => {
      latlngs.push([item.lat, item.lng]);

      const isDone = item.completed;
      const num = idx + 1;

      // 커스텀 번호 마커 아이콘
      const markerHtml = `
        <div style="
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: ${isDone ? "#10b981" : "#2563eb"};
          color: white;
          font-weight: 900;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          border: 2.5px solid white;
          cursor: pointer;
          transform: scale(${isDone ? "0.95" : "1.05"});
          transition: all 0.2s;
        ">
          ${isDone ? "✓" : num}
        </div>
      `;

      const customIcon = L.divIcon({
        className: "custom-inspection-pin",
        html: markerHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18],
      });

      const popupContent = `
        <div style="font-family: -apple-system, sans-serif; font-size: 12px; min-width: 200px; padding: 2px;">
          <div style="font-size: 11px; font-weight: 800; color: ${isDone ? "#059669" : "#2563eb"}; margin-bottom: 2px;">
            ${isDone ? "✅ 임장 완료" : `📍 순번 #${num}`} · ${item.source === "auction" ? "법원경매" : item.source === "onbid" ? "온비드공매" : "네이버상가"}
          </div>
          <div style="font-weight: bold; font-size: 13px; color: #111827; margin-bottom: 4px; line-height: 1.3;">
            ${item.title}
          </div>
          <div style="color: #4b5563; font-size: 11px; margin-bottom: 6px;">
            ${item.location}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; background: #f3f4f6; padding: 4px 6px; rounded: 6px;">
            <span style="font-weight: 800; color: #1d4ed8;">${item.priceText}</span>
            <span style="font-size: 10px; color: #6b7280;">${item.floorText}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
            <a href="https://map.kakao.com/link/search/${encodeURIComponent(item.location)}" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #fef08a; color: #854d0e; padding: 4px; border-radius: 4px; font-weight: bold; text-decoration: none; font-size: 11px;">
              로드뷰 ↗
            </a>
            <a href="https://map.kakao.com/link/to/${encodeURIComponent(item.title)},${item.lat},${item.lng}" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #2563eb; color: white; padding: 4px; border-radius: 4px; font-weight: bold; text-decoration: none; font-size: 11px;">
              길찾기 🚗
            </a>
          </div>
        </div>
      `;

      const marker = L.marker([item.lat, item.lng], { icon: customIcon }).bindPopup(popupContent);
      markersGroup.addLayer(marker);
    });

    // 순서대로 연결하는 동선 Polyline
    if (latlngs.length >= 2) {
      polylineRef.current = L.polyline(latlngs, {
        color: "#3b82f6",
        weight: 3.5,
        opacity: 0.8,
        dashArray: "6, 8",
      }).addTo(map);

      map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] });
    } else if (latlngs.length === 1) {
      map.setView(latlngs[0], 14);
    }
  }, [items, mapReady]);

  // 임장 완료 토글
  const handleToggleComplete = (id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          const nextVal = !it.completed;
          return {
            ...it,
            completed: nextVal,
            completedAt: nextVal ? new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : undefined,
          };
        }
        return it;
      })
    );
  };

  // 체크리스트 항목 토글
  const handleToggleChecklist = (itemId: string, key: keyof ChecklistState) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === itemId) {
          return {
            ...it,
            checklist: {
              ...it.checklist,
              [key]: !it.checklist[key],
            },
          };
        }
        return it;
      })
    );
  };

  // 메모 수정
  const handleMemoChange = (itemId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, memo: val } : it))
    );
  };

  // 순서 위로 이동
  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setItems((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // 순서 아래로 이동
  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1) return;
    setItems((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // 매물 삭제
  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // 프리셋 로드
  const handleLoadPreset = (preset: InspectionItem[]) => {
    if (confirm("현재 목록을 교체하고 추천 임장 코스를 불러올까요?")) {
      setItems(preset);
    }
  };

  // 전체 초기화
  const handleClearAll = () => {
    if (confirm("임장 플래너를 모두 비우시겠습니까?")) {
      setItems([]);
    }
  };

  if (!isClient) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 flex flex-col font-sans break-keep">
      {/* 1. 상단 네비게이션 헤더 */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-200/90 shadow-2xs">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
              title="홈으로 돌아가기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-1">
                  <span>📍</span> <span>현장 임장 플래너</span>
                </span>
                <span className="text-[10px] sm:text-xs font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  타임라인 & 동선 지도
                </span>
              </div>
              <p className="text-[11px] text-gray-500 font-medium hidden sm:block">
                매물별 방문 순서, 이동 소요 시간, 현장 체크리스트를 관리하는 실전 투자자용 로드맵
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href="/auctions"
              className="text-xs font-bold text-gray-600 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 px-2.5 py-1.5 rounded-xl transition-colors shrink-0"
            >
              + 매물 검색
            </Link>
          </div>
        </div>

        {/* 2. 임장 진행률 & 요약 바 */}
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border-t border-b border-blue-100/80 px-3 sm:px-5 py-2">
          <div className="w-full max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-extrabold text-blue-900 flex items-center gap-1">
                <span>🎯</span>
                <span>진행률:</span>
                <strong className="text-blue-700 text-sm ml-0.5">{completedCount} / {items.length}곳</strong>
                <span className="text-gray-400 font-normal">({progressPercent}%)</span>
              </span>
              <div className="flex-1 sm:w-44 bg-blue-200/60 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-gray-600 font-semibold shrink-0">
              <span className="bg-white/80 px-2 py-0.5 rounded-md border border-blue-200/60">
                🚗 총 이동: <strong className="text-blue-800 font-bold">{totalTravelKm} km</strong>
              </span>
              <span className="bg-white/80 px-2 py-0.5 rounded-md border border-purple-200/60">
                ⏰ 시작: <strong className="text-purple-800 font-bold">{startTime}</strong> (각 {stayDurationMinutes}분 체류)
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 3. 본문 컨테이너 */}
      <main className="w-full max-w-7xl mx-auto px-3 sm:px-5 py-4 flex-1 flex flex-col gap-4">
        {/* 상단 추천 코스 로드 & 설정 컨트롤 바 */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-3 sm:p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="text-xs font-bold text-gray-500 mr-1">추천 코스:</span>
            <button
              onClick={() => handleLoadPreset(PRESET_SEONGNAM_VILLAS_SHOPS)}
              className="text-xs font-extrabold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1"
            >
              <span>🏛️</span>
              <span>성남 원도심 빌라+상가 (5곳)</span>
            </button>
            <button
              onClick={() => handleLoadPreset(PRESET_BUNDANG_GWANGJU)}
              className="text-xs font-extrabold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1"
            >
              <span>🌲</span>
              <span>분당·판교·광주 코스 (4곳)</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="text-xs font-extrabold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
            >
              <span>➕</span>
              <span>직접 매물 추가</span>
            </button>
            {items.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs font-semibold text-gray-400 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                비우기
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-gray-500 font-medium">시작 시각:</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 font-bold text-gray-800 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 font-medium">체류:</span>
              <select
                value={stayDurationMinutes}
                onChange={(e) => setStayDurationMinutes(Number(e.target.value))}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 font-bold text-gray-800 text-xs"
              >
                <option value={20}>20분</option>
                <option value={30}>30분</option>
                <option value={35}>35분 (기본)</option>
                <option value={45}>45분</option>
                <option value={60}>1시간</option>
              </select>
            </div>
          </div>
        </div>

        {/* 뷰 전환 탭 (모바일 전용) */}
        <div className="flex md:hidden items-center bg-gray-200 p-1 rounded-xl text-xs font-bold">
          <button
            onClick={() => setActiveTab("both")}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === "both" ? "bg-white text-blue-600 shadow-2xs" : "text-gray-600"
            }`}
          >
            📋 리스트 & 지도
          </button>
          <button
            onClick={() => setActiveTab("timeline")}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === "timeline" ? "bg-white text-blue-600 shadow-2xs" : "text-gray-600"
            }`}
          >
            ⏱️ 타임라인
          </button>
          <button
            onClick={() => setActiveTab("map")}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === "map" ? "bg-white text-blue-600 shadow-2xs" : "text-gray-600"
            }`}
          >
            🗺️ 동선 지도
          </button>
        </div>

        {/* 2열 반응형 레이아웃: 왼쪽 타임라인 / 오른쪽 지도 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
          {/* [좌측 7컬럼] 타임라인 & 매물 체크리스트 */}
          <div
            className={`lg:col-span-7 flex flex-col gap-3 ${
              activeTab === "map" ? "hidden md:flex" : "flex"
            }`}
          >
            {schedule.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500">
                <span className="text-3xl block mb-2">📍</span>
                <p className="font-bold text-gray-800 mb-1">임장 플래너가 비어 있습니다.</p>
                <p className="text-xs text-gray-400 mb-4">상단의 추천 코스 버튼을 눌러보거나 매물 검색에서 매물을 담아보세요.</p>
                <button
                  onClick={() => handleLoadPreset(PRESET_SEONGNAM_VILLAS_SHOPS)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors"
                >
                  성남 원도심 빌라+상가 코스 로드
                </button>
              </div>
            ) : (
              schedule.map((entry) => {
                const { item, index, arrival, departure, travelToNext, distToNext } = entry;
                const isChecklistOpen = expandedChecklistId === item.id;

                return (
                  <div key={item.id} className="relative flex flex-col">
                    {/* 매물 카드 */}
                    <div
                      className={`bg-white rounded-2xl border transition-all shadow-2xs p-3.5 sm:p-4.5 ${
                        item.completed
                          ? "border-emerald-300 bg-emerald-50/20"
                          : "border-gray-200 hover:border-blue-400"
                      }`}
                    >
                      {/* 카드 상단: 순번, 시간대, 완료 토글 버튼 */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                              item.completed
                                ? "bg-emerald-600 text-white"
                                : "bg-blue-600 text-white shadow-2xs"
                            }`}
                          >
                            {item.completed ? "✓" : index}
                          </span>
                          <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-lg flex items-center gap-1">
                            <span>⏰</span>
                            <span>{arrival} ~ {departure}</span>
                          </span>
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${
                            item.source === "auction"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : item.source === "onbid"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}>
                            {item.source === "auction" ? "⚖️ 경매" : item.source === "onbid" ? "🏛️ 공매" : "🟢 네이버"}
                          </span>
                        </div>

                        {/* 완료 체크 버튼 & 순서 이동 */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleToggleComplete(item.id)}
                            className={`px-2.5 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1 ${
                              item.completed
                                ? "bg-emerald-600 text-white shadow-2xs scale-102"
                                : "bg-gray-100 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 border border-gray-200"
                            }`}
                          >
                            <span>{item.completed ? "✅ 완료됨" : "임장 완료"}</span>
                            {item.completedAt && <span className="text-[10px] font-normal opacity-85">({item.completedAt})</span>}
                          </button>

                          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50 ml-1">
                            <button
                              onClick={() => handleMoveUp(index - 1)}
                              disabled={index === 1}
                              className="px-1.5 py-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer text-xs"
                              title="위로 이동"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => handleMoveDown(index - 1)}
                              disabled={index === items.length}
                              className="px-1.5 py-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer text-xs border-l border-gray-200"
                              title="아래로 이동"
                            >
                              ▼
                            </button>
                          </div>

                          <button
                            onClick={() => handleRemove(item.id)}
                            className="p-1 text-gray-300 hover:text-red-500 transition-colors cursor-pointer text-xs ml-0.5"
                            title="목록에서 삭제"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* 매물명 및 주소 */}
                      <div className="mb-2">
                        <h3
                          className={`text-sm sm:text-base font-bold transition-colors ${
                            item.completed ? "text-gray-500 line-through" : "text-gray-900"
                          }`}
                        >
                          {item.title}
                        </h3>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <span>📍</span>
                          <span>{item.location}</span>
                        </p>
                      </div>

                      {/* 가격 & 층수 박스 */}
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-2.5 mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-blue-700 text-sm">{item.priceText}</span>
                          {item.appraisalText && item.appraisalText !== "-" && (
                            <span className="text-[11px] text-gray-400 line-through">{item.appraisalText}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {item.discountText && (
                            <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.2 rounded">
                              {item.discountText}
                            </span>
                          )}
                          <span className="text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 px-1.5 py-0.2 rounded">
                            {item.floorText}
                          </span>
                        </div>
                      </div>

                      {/* 핵심 특징 뱃지 */}
                      {item.keyFeatures && item.keyFeatures.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mb-2.5">
                          {item.keyFeatures.map((feat, fIdx) => (
                            <span
                              key={fIdx}
                              className="text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200/80 px-2 py-0.5 rounded-md"
                            >
                              ✓ {feat}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 현장 체크리스트 토글 버튼 */}
                      <div className="border-t border-gray-100 pt-2 flex items-center justify-between text-xs">
                        <button
                          onClick={() => setExpandedChecklistId(isChecklistOpen ? null : item.id)}
                          className="font-bold text-gray-700 hover:text-blue-600 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span>📋 현장 체크리스트</span>
                          <span className="text-[10px] text-gray-400 font-normal">
                            ({Object.values(item.checklist).filter(Boolean).length}/5 확인)
                          </span>
                          <span className="text-gray-400 text-[10px]">{isChecklistOpen ? "▲" : "▼"}</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          <a
                            href={`https://map.kakao.com/link/search/${encodeURIComponent(item.location)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded-lg bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 text-[11px] font-bold transition-colors"
                          >
                            📍 로드뷰
                          </a>
                          <a
                            href={`https://map.kakao.com/link/to/${encodeURIComponent(item.title)},${item.lat},${item.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors"
                          >
                            🚗 길찾기
                          </a>
                        </div>
                      </div>

                      {/* 아코디언: 현장 점검 체크리스트 5종 및 현장 메모장 */}
                      {isChecklistOpen && (
                        <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs animate-in fade-in duration-200">
                          <p className="font-extrabold text-slate-800 text-[11px] flex items-center gap-1">
                            <span>🔍</span> <span>현장에서 반드시 확인할 5가지 항목</span>
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-gray-200 cursor-pointer hover:bg-blue-50/50">
                              <input
                                type="checkbox"
                                checked={item.checklist.leakChecked}
                                onChange={() => handleToggleChecklist(item.id, "leakChecked")}
                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                              />
                              <span className={item.checklist.leakChecked ? "line-through text-gray-400 font-semibold" : "font-semibold text-gray-700"}>
                                💧 누수·결로·외벽 방수 상태
                              </span>
                            </label>

                            <label className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-gray-200 cursor-pointer hover:bg-blue-50/50">
                              <input
                                type="checkbox"
                                checked={item.checklist.vacancyChecked}
                                onChange={() => handleToggleChecklist(item.id, "vacancyChecked")}
                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                              />
                              <span className={item.checklist.vacancyChecked ? "line-through text-gray-400 font-semibold" : "font-semibold text-gray-700"}>
                                👤 점유 현황 (소유자 or 임차인)
                              </span>
                            </label>

                            <label className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-gray-200 cursor-pointer hover:bg-blue-50/50">
                              <input
                                type="checkbox"
                                checked={item.checklist.feeChecked}
                                onChange={() => handleToggleChecklist(item.id, "feeChecked")}
                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                              />
                              <span className={item.checklist.feeChecked ? "line-through text-gray-400 font-semibold" : "font-semibold text-gray-700"}>
                                🧾 미납 관리비 (공용/전용) 체납
                              </span>
                            </label>

                            <label className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-gray-200 cursor-pointer hover:bg-blue-50/50">
                              <input
                                type="checkbox"
                                checked={item.checklist.parkingChecked}
                                onChange={() => handleToggleChecklist(item.id, "parkingChecked")}
                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                              />
                              <span className={item.checklist.parkingChecked ? "line-through text-gray-400 font-semibold" : "font-semibold text-gray-700"}>
                                🅿️ 주차 대수 및 차량 진입로 폭
                              </span>
                            </label>
                          </div>

                          <label className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-gray-200 cursor-pointer hover:bg-blue-50/50">
                            <input
                              type="checkbox"
                              checked={item.checklist.realtorChecked}
                              onChange={() => handleToggleChecklist(item.id, "realtorChecked")}
                              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                            />
                            <span className={item.checklist.realtorChecked ? "line-through text-gray-400 font-semibold" : "font-semibold text-gray-700"}>
                              🏪 인근 부동산 중개소 2곳 실거래·전월세 호가 탐문
                            </span>
                          </label>

                          {/* 현장 메모 인풋 */}
                          <div className="pt-1">
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">
                              📝 현장 메모 / 부동산 탐문 기록
                            </label>
                            <textarea
                              rows={2}
                              value={item.memo || ""}
                              onChange={(e) => handleMemoChange(item.id, e.target.value)}
                              placeholder="예: 관리소 확인 결과 체납관리비 없음. 1층 편의점 유동인구 많음. 302호 계단 크랙 발견 등..."
                              className="w-full bg-white border border-gray-300 rounded-lg p-2 text-xs text-gray-800 outline-none focus:border-blue-500 shadow-2xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 다음 매물로 이동 안내 바 (마지막 항목 제외) */}
                    {index < items.length && (
                      <div className="flex items-center justify-center my-1.5">
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200/80 rounded-full text-[11px] font-bold text-blue-800 shadow-2xs">
                          <span>🚗 다음 목적지 이동:</span>
                          <span>약 {travelToNext}분 소요</span>
                          <span className="text-blue-400">·</span>
                          <span>{distToNext} km</span>
                          <span>↓</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* [우측 5컬럼] Leaflet 동선 지도 (우측 고정) */}
          <div
            className={`lg:col-span-5 flex flex-col gap-2 ${
              activeTab === "timeline" ? "hidden md:flex" : "flex"
            }`}
          >
            <div className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs overflow-hidden flex flex-col h-[520px] lg:sticky lg:top-24">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200/80 flex items-center justify-between text-xs">
                <span className="font-black text-gray-800 flex items-center gap-1">
                  <span>🗺️</span> <span>임장 동선 시각화 지도</span>
                </span>
                <span className="text-[11px] text-gray-500 font-medium">
                  {items.length}개 지점 경로 표시
                </span>
              </div>

              <div ref={mapContainerRef} className="w-full flex-1 bg-slate-100" />

              <div className="p-2.5 bg-white border-t border-gray-200 text-[11px] text-gray-600 flex items-center justify-between">
                <span>💡 지도 위 핀을 누르면 카카오 로드뷰 & 길찾기가 열립니다.</span>
                <span className="font-bold text-blue-600">성남·광주 권역</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 직접 매물 추가 모달 */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-1.5">
                <span>➕</span> <span>새 임장 매물 직접 추가</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDirectAdd} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  소재지 (주소) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: 경기도 성남시 수정구 태평동 1234"
                  value={addLocation}
                  onChange={(e) => setAddLocation(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  물건 이름 / 애칭
                </label>
                <input
                  type="text"
                  placeholder="예: 태평동 현대빌라 201호 / 서현동 1층 카페"
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">용도</label>
                  <select
                    value={addUsage}
                    onChange={(e) => setAddUsage(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-2.5 py-2 text-gray-800 outline-none focus:border-blue-500"
                  >
                    <option value="다세대/빌라">다세대/빌라</option>
                    <option value="상가/근린">상가/근린시설</option>
                    <option value="단독/다가구">단독/다가구</option>
                    <option value="아파트">아파트</option>
                    <option value="오피스텔">오피스텔</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">층수</label>
                  <input
                    type="text"
                    placeholder="예: 1층, 3층, B1"
                    value={addFloor}
                    onChange={(e) => setAddFloor(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-800 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">희망가 / 호가 / 최저가</label>
                <input
                  type="text"
                  placeholder="예: 2억 3,000만원 / 보증금 3천·월 150"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-800 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">사전 메모 / 방문 목적</label>
                <textarea
                  rows={2}
                  placeholder="예: 전세 갭투자 타당성 검토, 주변 1층 공실률 및 상권 확인"
                  value={addNote}
                  onChange={(e) => setAddNote(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl p-2 text-gray-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl text-gray-600 hover:bg-gray-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold shadow-sm"
                >
                  플래너에 추가하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
