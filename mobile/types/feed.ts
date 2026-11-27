export type SafetyGrade = 'GREEN' | 'YELLOW' | 'RED';

export interface FeedItem {
  case_number: string;
  headline: string;
  safety_grade: SafetyGrade;
  gap_amount: number;
  gap_amount_str: string;
  ref_price_name: string;
  summary_bullets: string[];
  min_bid: number;
  min_bid_str: string;
  appraisal: number;
  appraisal_str: string;
  discount_pct: number;
  deposit_required: number;
  deposit_required_str: string;
  usage: string;
  area_pyeong: number;
  location: string;
  short_location: string;
  floor: number;
  failed_count: number;
  auction_date: string;
  d_day: string;
  lat?: number | null;
  lng?: number | null;
  photo_url: string;
  court_name: string;
}

export interface MobileFeedData {
  generated_at: string;
  total_count: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  items: FeedItem[];
}
