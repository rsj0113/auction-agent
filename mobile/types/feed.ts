export type SafetyGrade = 'GREEN' | 'YELLOW' | 'RED';
export type DifficultyLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type SourceType = 'auction' | 'onbid_sale' | 'onbid_lease';

export interface OnbidInfo {
  cltr_no: string;
  onbid_cltr_no?: string;
  prpt_div: string;
  reg_org_nm: string;
  bid_status: string;
  bid_start_date: string;
  bid_end_date: string;
  detail_url: string;
  annual_fee?: number;
  annual_fee_str?: string;
  est_monthly_fee?: number;
  est_monthly_fee_str?: string;
  deposit_note?: string;
  lease_period_note?: string;
  land_area_m2?: number;
  bld_area_m2?: number;
}

export interface RawCourtRight {
  type?: string;
  name?: string;
  date?: string;
  right_holder?: string;
  registration_date?: string;
  claim_amount?: number | string;
  is_standard_right?: boolean;
  is_extinguished?: boolean;
  remarks?: string;
  [key: string]: any;
}

export interface SpecialRightObject {
  id?: string;
  name?: string;
  short?: string;
  badge_color?: string;
  risk_level?: string;
  icon?: string;
  desc?: string;
}

export interface TenantRecord {
  name: string;
  room: string;
  move_in_date: string;
  deposit: number;
  deposit_str: string;
  monthly_rent?: string;
  fixed_date?: string;
  is_payout_requested: boolean;
  seniority: 'SENIOR' | 'JUNIOR' | 'UNKNOWN';
}

export interface RawCourtData {
  rights_list: RawCourtRight[] | string;
  remarks: string;
  special_rights: Array<string | SpecialRightObject> | string;
  tenants_list?: TenantRecord[];
  senior_assumed_deposit?: number;
  senior_assumed_deposit_str?: string;
  senior_unknown_count?: number;
  tenant_registration_date?: string;
  tenant_deposit?: number;
  tenant_deposit_str?: string;
  is_payout_requested?: boolean;
  court_name?: string;
  legal_div_no?: string;
  failed_count?: number;
  auction_date?: string;
}

export interface MalsoRight {
  name: string;
  date: string;
  right_holder?: string;
  claim_amount?: number | string;
}

export interface AIAnalysis {
  score: number;
  grade: string;
  verdict: string;
  suggested_bid: string;
  expected_yield: string;
  key_points: string[];
  risks: string[];
  extinguished_rights: string[];
  retained_rights: string[];
  analysis_detail: string;
  malso_right?: MalsoRight | null;
  assumed_deposit: number;
  assumed_deposit_str: string;
  senior_unknown_count?: number;
}

export interface BidHistoryItem {
  round: number;
  price: number;
  price_str: string;
  ratio_pct: number;
  status: string;
  is_current: boolean;
  date: string;
}

export interface RentalEstimate {
  est_deposit: number;
  est_deposit_str: string;
  est_monthly_rent: number;
  est_monthly_rent_str: string;
  est_jeonse: number;
  est_jeonse_str: string;
  annual_yield_pct: number;
  gap_invest_cash: number;
  gap_invest_cash_str: string;
  sample_count: number;
  source_label: string;
}

export interface AreaWinningStats {
  region_label: string;
  sample_count: number;
  avg_winning_rate: number;
  avg_bidder_count: number;
}

export interface FeedItem {
  case_number: string;
  source_type?: SourceType;
  source_badge?: string;
  disposal_method?: '매각' | '임대';
  onbid_info?: OnbidInfo | null;
  headline: string;
  safety_grade: SafetyGrade;
  difficulty?: DifficultyLevel;
  gap_amount: number;
  gap_amount_str: string;
  gap_short_str?: string;
  ref_price_name: string;
  market_price?: number;
  market_price_str?: string;
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
  photo_source?: 'court' | 'streetview' | 'stock';
  photo_source_label?: string;
  ai_analysis?: AIAnalysis;
  bid_history?: BidHistoryItem[];
  rental_estimate?: RentalEstimate | null;
  area_winning_stats?: AreaWinningStats | null;
  raw_court_data?: RawCourtData;
  court_name: string;
}

export interface MobileFeedData {
  generated_at: string;
  total_count: number;
  auction_count?: number;
  onbid_sale_count?: number;
  onbid_lease_count?: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  rental_matched_count?: number;
  area_stats_matched_count?: number;
  items: FeedItem[];
}
