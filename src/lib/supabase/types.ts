export type AgeBand = "under_13" | "13_15" | "16_17" | "18_20" | "21_29" | "30_44" | "45_59" | "60_plus";
export type Generation = "gen_alpha" | "gen_z" | "millennial" | "gen_x" | "boomer";
export type Currency = "xp" | "zap_points" | "region_credits" | "reward_tokens";

export type Profile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  age_band: AgeBand;
  generation: Generation | null;
  gender: string | null;
  orientation: string | null;
  country_code: string | null;
  interface_language: string;
  chat_language: string;
  online_visible: boolean;
  profile_visible: boolean;
  generation_visible: boolean;
  country_visible: boolean;
  gender_visible: boolean;
  age_band_visible: boolean;
  interests_visible: boolean;
  xp: number;
  zap_points: number;
  region_credits: number;
  level: number;
  streak_days: number;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MatchPreferences = {
  profile_id: string;
  preferred_age_bands: AgeBand[];
  preferred_genders: string[];
  preferred_orientations: string[];
  preferred_generations: Generation[];
  preferred_languages: string[];
  preferred_continents: string[];
  preferred_interests: string[];
  preferred_countries: string[];
  interest_wait_seconds: 5 | 10 | 15 | 30 | 45 | 60;
  country_targeting_enabled: boolean;
  updated_at: string;
};
