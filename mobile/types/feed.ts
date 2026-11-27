export type SafetyGrade = 'GREEN' | 'YELLOW' | 'RED';

export interface RawCourtRight {
  type?: string;
  name?: string;
  right_holder?: string;
  registration_date?: string;
  claim_amount?: number | string;
  is_standard_right?: boolean;
  is_extinguished?: boolean;
  remarks?: string;
  [key: string]: any;
}

export interface RawCourtData {
  rights_list: RawCourtRight[];
  remarks: string;
  special_rights: string[];
  tenant_registration_date?: string;
  tenant_deposit?: number;
  tenant_deposit_str?: string;
  is_payout_requested?: boolean;
  court_name?: string;
  legal_div_no?: string;
  failed_count?: number;
  auction_date?: string;
}

export interface FeedItem {
  case_number: string;
  headline: string;
  safety_grade: SafetyGrade;
  gap_amount: number;
  gap_amount_str: string;
  gap_short_str?: string;
  ref_price_name: string;
  summary_bullets: string[];
  card_tags?: string[];
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
  photos?: string[];
  raw_court_data?: RawCourtData;
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
