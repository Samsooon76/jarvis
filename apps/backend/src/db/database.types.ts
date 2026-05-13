export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      prospects: {
        Row: {
          ai_priority_score: number;
          ai_summary: string | null;
          close_probability: number;
          company: string | null;
          created_at: string;
          deal_amount: number | null;
          deal_stage: string | null;
          email: string | null;
          hubspot_contact_id: string;
          hubspot_deal_id: string | null;
          hubspot_prospect_key: string;
          id: string;
          last_contact_at: string | null;
          name: string;
          next_action: string | null;
          next_action_at: string | null;
          org_id: string;
          owner_user_id: string | null;
          phone: string | null;
          raw_data: Json;
          skipped_at: string | null;
          snoozed_until: string | null;
          synced_at: string;
          tags: string[];
          title: string | null;
          updated_at: string;
        };
      };
      users: {
        Row: {
          auth_user_id: string | null;
          avatar_url: string | null;
          created_at: string;
          email: string;
          hubspot_owner_id: string | null;
          id: string;
          name: string;
          org_id: string | null;
          role: string;
          settings: Json;
          updated_at: string;
        };
      };
      monthly_sales_targets: {
        Row: {
          created_at: string;
          hubspot_owner_id: string;
          id: string;
          objective_amount: number;
          org_id: string;
          owner_name: string;
          target_month: string;
          updated_at: string;
        };
      };
    };
  };
};
