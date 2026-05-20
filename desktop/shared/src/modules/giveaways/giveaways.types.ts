export type GiveawayStatus = "open" | "closed" | "ended";
export type GiveawayPlatformMode =
  | "winner_selects_after_win"
  | "fixed_platform";
export type GiveawayPrizeType =
  | "standard_game_key"
  | "deluxe_game_key"
  | "dlc_key"
  | "other";
export type GiveawayPreviousWinnerRestrictionMode =
  | "exact_item_only"
  | "base_game_blocks_deluxe"
  | "none";
export type GiveawayWinnerStatus =
  | "pending_confirmation"
  | "confirmed"
  | "expired"
  | "rerolled";
export type GiveawayPurchaseStatus =
  | "not_purchased"
  | "pending_purchase"
  | "purchased"
  | "delivered"
  | "activation_confirmed_optional";

export type Giveaway = {
  id: number;
  title: string;
  keyword: string;
  status: GiveawayStatus;
  winner_count: number;
  item_name: string;
  item_edition: string;
  game_name: string;
  marketplace_name: string;
  marketplace_note: string;
  platform_mode: GiveawayPlatformMode;
  supported_platforms_json: string;
  prize_type: GiveawayPrizeType;
  minimum_follow_age_days: number;
  must_be_present_to_win: number;
  response_window_minutes: number;
  one_entry_per_person: number;
  allow_extra_entries: number;
  previous_winner_restriction_mode: GiveawayPreviousWinnerRestrictionMode;
  age_guidance_text: string;
  region_availability_disclaimer: string;
  entry_window_minutes: number;
  entries_close_at: string | null;
  timer_started_at: string | null;
  operator_twitch_user_id: string;
  operator_login: string;
  draw_seed: string;
  draw_result_json: string;
  last_draw_at: string | null;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
  ended_at: string | null;
};

export type GiveawayEntry = {
  id: number;
  giveaway_id: number;
  twitch_user_id: string;
  login: string;
  display_name: string;
  entered_at: string;
  eligibility_status: "eligible" | "ineligible" | "removed";
  eligibility_reason: string;
  followed_at: string | null;
  follow_checked_at: string | null;
  follow_age_days: number;
  is_operator: number;
  is_mod: number;
  removed_at: string | null;
  removed_reason: string;
};

export type GiveawayWinner = {
  id: number;
  giveaway_id: number;
  twitch_user_id: string;
  login: string;
  display_name: string;
  drawn_at: string;
  status: GiveawayWinnerStatus;
  response_expires_at: string | null;
  expired_at: string | null;
  confirmed_at: string | null;
  claimed_at: string | null;
  delivered_at: string | null;
  rerolled_at: string | null;
  selected_platform: string;
  region_country: string;
  delivery_method: string;
  marketplace_used: string;
  purchase_status: GiveawayPurchaseStatus;
  fulfillment_status: "not_fulfilled" | "fulfilled";
  confirmation_notes: string;
  draw_seed: string;
};
