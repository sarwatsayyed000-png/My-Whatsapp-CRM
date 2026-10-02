-- ============================================================
-- 044_crm_deals.sql — "CRM & Deals" (Phase 2)
--
-- Numbered 044 (not 043) because the open opt-out PR already ships
-- 043_contact_opt_out.sql; two files sharing a version prefix would
-- collide in `supabase migration` history.
--
-- What this migration adds
--   1. deals: stage_entered_at, closed_at, source columns; conversations:
--      crm_assign_pending (waiting for qualification → round-robin).
--   2. crm_settings            — per-account auto-create + round-robin
--                                 toggles and the round-robin cursor.
--   3. lead_qualification_settings — per-account "run this Flow before
--                                 round-robin" switch.
--   4. follow_up_cadences / follow_up_cadence_steps — automated
--                                 WhatsApp follow-up sequences.
--   5. deal_follow_ups         — manual + automated follow-ups.
--   6. agent_targets           — per-agent, per-period targets.
--   7. team_report_settings    — email report preferences.
--   8. crm_bump_round_robin()  — atomic cursor advance (service role).
--   9. Triggers on deals that (a) stamp stage_entered_at and
--      (b) schedule / cancel automated cadence follow-ups so EVERY
--      write path (board drag, bulk edit, public API, webhook) is
--      covered without each caller remembering to do it.
--  10. notifications.type widened with 'follow_up_due'.
--
-- RLS follows the account-sharing pattern from 017/020:
--   viewer  → SELECT
--   agent+  → write operational rows (deal_follow_ups)
--   admin+  → write settings-class rows (cadences, settings, targets)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. DEALS — new columns
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the deal is marked won/lost, cleared on reopen. Drives
  -- the Team Performance period maths (updated_at moves on any edit).
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  -- 'manual' (created in the UI / API) or 'whatsapp_auto' (webhook).
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_source_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_source_check CHECK (source IN ('manual', 'whatsapp_auto'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_account_contact_open
  ON deals(account_id, contact_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_deals_conversation ON deals(conversation_id);
CREATE INDEX IF NOT EXISTS idx_deals_account_closed ON deals(account_id, closed_at)
  WHERE closed_at IS NOT NULL;

-- Backfill closed_at for deals closed before this migration.
UPDATE deals SET closed_at = COALESCE(updated_at, created_at)
WHERE status IN ('won', 'lost') AND closed_at IS NULL;

-- TRUE while a new conversation waits for round-robin assignment
-- (the lead-qualification flow is still running). Cleared once the
-- conversation and its deal are assigned.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS crm_assign_pending BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_conversations_crm_assign_pending
  ON conversations(account_id, contact_id) WHERE crm_assign_pending;

-- ============================================================
-- 2. CRM_SETTINGS (one row per account)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  auto_create_deals BOOLEAN NOT NULL DEFAULT TRUE,
  round_robin_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Monotonic counter advanced atomically by crm_bump_round_robin().
  round_robin_counter BIGINT NOT NULL DEFAULT 0,
  last_assigned_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_settings_last_assigned
  ON crm_settings(last_assigned_profile_id);

ALTER TABLE crm_settings ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON crm_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS crm_settings_select ON crm_settings;
DROP POLICY IF EXISTS crm_settings_insert ON crm_settings;
DROP POLICY IF EXISTS crm_settings_update ON crm_settings;
DROP POLICY IF EXISTS crm_settings_delete ON crm_settings;
CREATE POLICY crm_settings_select ON crm_settings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY crm_settings_insert ON crm_settings FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY crm_settings_update ON crm_settings FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY crm_settings_delete ON crm_settings FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Atomic round-robin cursor. Called by the webhook (service role)
-- only; UPSERT so accounts without a settings row still rotate.
CREATE OR REPLACE FUNCTION crm_bump_round_robin(p_account_id UUID)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO crm_settings (account_id, round_robin_counter)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
    SET round_robin_counter = crm_settings.round_robin_counter + 1
  RETURNING round_robin_counter;
$$;

ALTER FUNCTION crm_bump_round_robin(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION crm_bump_round_robin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm_bump_round_robin(UUID) TO service_role;

-- ============================================================
-- 3. LEAD_QUALIFICATION_SETTINGS (one row per account)
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_qualification_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_qualification_flow ON lead_qualification_settings(flow_id);

ALTER TABLE lead_qualification_settings ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON lead_qualification_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_qualification_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS lead_qualification_settings_select ON lead_qualification_settings;
DROP POLICY IF EXISTS lead_qualification_settings_insert ON lead_qualification_settings;
DROP POLICY IF EXISTS lead_qualification_settings_update ON lead_qualification_settings;
DROP POLICY IF EXISTS lead_qualification_settings_delete ON lead_qualification_settings;
CREATE POLICY lead_qualification_settings_select ON lead_qualification_settings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_qualification_settings_insert ON lead_qualification_settings FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_qualification_settings_update ON lead_qualification_settings FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_qualification_settings_delete ON lead_qualification_settings FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 4. FOLLOW_UP_CADENCES + STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_up_cadences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  trigger_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  stop_when TEXT NOT NULL DEFAULT 'reply_or_closed'
    CHECK (stop_when IN ('reply_or_closed', 'closed', 'never')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_account ON follow_up_cadences(account_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_pipeline ON follow_up_cadences(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_trigger_active
  ON follow_up_cadences(trigger_stage_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_config ON follow_up_cadences(whatsapp_config_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_cadences_created_by ON follow_up_cadences(created_by);

ALTER TABLE follow_up_cadences ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON follow_up_cadences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON follow_up_cadences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS follow_up_cadences_select ON follow_up_cadences;
DROP POLICY IF EXISTS follow_up_cadences_insert ON follow_up_cadences;
DROP POLICY IF EXISTS follow_up_cadences_update ON follow_up_cadences;
DROP POLICY IF EXISTS follow_up_cadences_delete ON follow_up_cadences;
CREATE POLICY follow_up_cadences_select ON follow_up_cadences FOR SELECT USING (is_account_member(account_id));
CREATE POLICY follow_up_cadences_insert ON follow_up_cadences FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY follow_up_cadences_update ON follow_up_cadences FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY follow_up_cadences_delete ON follow_up_cadences FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS follow_up_cadence_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cadence_id UUID NOT NULL REFERENCES follow_up_cadences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  -- Delay is relative to the previous step (step 0: relative to the
  -- moment the deal entered the trigger stage).
  delay_value INTEGER NOT NULL DEFAULT 1 CHECK (delay_value >= 0),
  delay_unit TEXT NOT NULL DEFAULT 'days' CHECK (delay_unit IN ('minutes', 'hours', 'days')),
  template_name TEXT NOT NULL,
  template_language TEXT,
  -- Positional {{1}}, {{2}}… values. May contain tokens resolved at
  -- send time: {{contact.name}}, {{deal.title}}, {{agent.name}}.
  template_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cadence_id, position)
);

ALTER TABLE follow_up_cadence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follow_up_cadence_steps_select ON follow_up_cadence_steps;
DROP POLICY IF EXISTS follow_up_cadence_steps_modify ON follow_up_cadence_steps;
CREATE POLICY follow_up_cadence_steps_select ON follow_up_cadence_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM follow_up_cadences c WHERE c.id = follow_up_cadence_steps.cadence_id AND is_account_member(c.account_id))
);
CREATE POLICY follow_up_cadence_steps_modify ON follow_up_cadence_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM follow_up_cadences c WHERE c.id = follow_up_cadence_steps.cadence_id AND is_account_member(c.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM follow_up_cadences c WHERE c.id = follow_up_cadence_steps.cadence_id AND is_account_member(c.account_id, 'admin'))
);

-- ============================================================
-- 5. DEAL_FOLLOW_UPS
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Denormalised from the deal so RLS + "list my account's" queries
  -- don't need a join. Kept in sync by the insert trigger below.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  channel TEXT NOT NULL DEFAULT 'task' CHECK (channel IN ('whatsapp', 'call', 'task')),
  template_name TEXT,
  is_automated BOOLEAN NOT NULL DEFAULT FALSE,
  cadence_id UUID REFERENCES follow_up_cadences(id) ON DELETE SET NULL,
  cadence_step_position INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped', 'cancelled')),
  -- Why an automated row was cancelled/skipped, or the send error.
  status_reason TEXT,
  completed_at TIMESTAMPTZ,
  -- Set once the due-notification has been sent to the agent.
  notified_at TIMESTAMPTZ,
  -- Meta message id of the automated send.
  whatsapp_message_id TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_account_status_due
  ON deal_follow_ups(account_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_deal ON deal_follow_ups(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_assigned ON deal_follow_ups(assigned_to);
CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_cadence ON deal_follow_ups(cadence_id);
CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_created_by ON deal_follow_ups(created_by);
-- Cron hot path: due pending rows across all accounts.
CREATE INDEX IF NOT EXISTS idx_deal_follow_ups_pending_due
  ON deal_follow_ups(due_at) WHERE status = 'pending';
-- At most one pending row per (deal, cadence) — the cron schedules
-- the next step only after the current one is done.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_follow_ups_one_pending_per_cadence
  ON deal_follow_ups(deal_id, cadence_id)
  WHERE status = 'pending' AND cadence_id IS NOT NULL;

ALTER TABLE deal_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_follow_ups_select ON deal_follow_ups;
DROP POLICY IF EXISTS deal_follow_ups_insert ON deal_follow_ups;
DROP POLICY IF EXISTS deal_follow_ups_update ON deal_follow_ups;
DROP POLICY IF EXISTS deal_follow_ups_delete ON deal_follow_ups;
CREATE POLICY deal_follow_ups_select ON deal_follow_ups FOR SELECT USING (is_account_member(account_id));
CREATE POLICY deal_follow_ups_insert ON deal_follow_ups FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deal_follow_ups_update ON deal_follow_ups FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY deal_follow_ups_delete ON deal_follow_ups FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Force account_id to match the parent deal (a client can't file a
-- follow-up into another tenant by passing a foreign account_id).
CREATE OR REPLACE FUNCTION deal_follow_ups_stamp_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT account_id INTO NEW.account_id FROM deals WHERE id = NEW.deal_id;
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'deal % not found', NEW.deal_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION deal_follow_ups_stamp_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS deal_follow_ups_stamp_account ON deal_follow_ups;
CREATE TRIGGER deal_follow_ups_stamp_account
  BEFORE INSERT OR UPDATE OF deal_id ON deal_follow_ups
  FOR EACH ROW EXECUTE FUNCTION deal_follow_ups_stamp_account();

-- ============================================================
-- 6. AGENT_TARGETS
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'quarterly')),
  target_deals_won INTEGER NOT NULL DEFAULT 10 CHECK (target_deals_won >= 0),
  target_revenue NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (target_revenue >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, agent_id, period)
);

CREATE INDEX IF NOT EXISTS idx_agent_targets_agent ON agent_targets(agent_id);

ALTER TABLE agent_targets ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON agent_targets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS agent_targets_select ON agent_targets;
DROP POLICY IF EXISTS agent_targets_insert ON agent_targets;
DROP POLICY IF EXISTS agent_targets_update ON agent_targets;
DROP POLICY IF EXISTS agent_targets_delete ON agent_targets;
CREATE POLICY agent_targets_select ON agent_targets FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_targets_insert ON agent_targets FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_targets_update ON agent_targets FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY agent_targets_delete ON agent_targets FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 7. TEAM_REPORT_SETTINGS (one row per account)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_report_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  recipients TEXT[] NOT NULL DEFAULT '{}',
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_report_settings ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON team_report_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON team_report_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS team_report_settings_select ON team_report_settings;
DROP POLICY IF EXISTS team_report_settings_insert ON team_report_settings;
DROP POLICY IF EXISTS team_report_settings_update ON team_report_settings;
DROP POLICY IF EXISTS team_report_settings_delete ON team_report_settings;
CREATE POLICY team_report_settings_select ON team_report_settings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY team_report_settings_insert ON team_report_settings FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY team_report_settings_update ON team_report_settings FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY team_report_settings_delete ON team_report_settings FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 8. DEAL TRIGGERS — stage entry stamp + cadence scheduling
-- ============================================================

-- BEFORE: stamp stage_entered_at whenever the stage changes.
CREATE OR REPLACE FUNCTION deals_stamp_stage_entered()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE: stamp closed_at when the deal is won/lost, clear on reopen.
CREATE OR REPLACE FUNCTION deals_stamp_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR NEW.closed_at IS NULL THEN
      NEW.closed_at := COALESCE(
        CASE WHEN TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN OLD.closed_at END,
        NOW()
      );
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_stamp_closed_at ON deals;
CREATE TRIGGER deals_stamp_closed_at
  BEFORE INSERT OR UPDATE OF status ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_stamp_closed_at();

DROP TRIGGER IF EXISTS deals_stamp_stage_entered ON deals;
CREATE TRIGGER deals_stamp_stage_entered
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_stamp_stage_entered();

-- AFTER: cancel follow-ups whose stop condition just hit, then
-- schedule step 0 of every active cadence on the stage the deal just
-- entered. Later steps are scheduled by the cron after each send
-- (src/lib/crm/cadence.ts), so a sequence never runs ahead of itself.
CREATE OR REPLACE FUNCTION deals_sync_cadences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_changed BOOLEAN;
  v_closed BOOLEAN;
BEGIN
  v_stage_changed := TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id;
  v_closed := NEW.status IN ('won', 'lost')
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status);

  -- Deal closed → stop sequences that stop on close.
  IF v_closed THEN
    UPDATE deal_follow_ups f
    SET status = 'cancelled', status_reason = 'deal_closed', completed_at = NOW()
    FROM follow_up_cadences c
    WHERE f.deal_id = NEW.id
      AND f.status = 'pending'
      AND f.is_automated
      AND c.id = f.cadence_id
      AND c.stop_when IN ('reply_or_closed', 'closed');
  END IF;

  IF TG_OP = 'UPDATE' AND v_stage_changed THEN
    -- Deal left the stage → its sequences no longer apply (unless the
    -- cadence is configured to never stop).
    UPDATE deal_follow_ups f
    SET status = 'cancelled', status_reason = 'left_stage', completed_at = NOW()
    FROM follow_up_cadences c
    WHERE f.deal_id = NEW.id
      AND f.status = 'pending'
      AND f.is_automated
      AND c.id = f.cadence_id
      AND c.trigger_stage_id IS DISTINCT FROM NEW.stage_id
      AND c.stop_when <> 'never';
  END IF;

  IF v_stage_changed AND NEW.status = 'open' THEN
    INSERT INTO deal_follow_ups (
      account_id, deal_id, assigned_to, due_at, channel, template_name,
      is_automated, cadence_id, cadence_step_position, note
    )
    SELECT
      NEW.account_id,
      NEW.id,
      NEW.assigned_to,
      NOW() + make_interval(
        mins  => CASE WHEN s.delay_unit = 'minutes' THEN s.delay_value ELSE 0 END,
        hours => CASE WHEN s.delay_unit = 'hours'   THEN s.delay_value ELSE 0 END,
        days  => CASE WHEN s.delay_unit = 'days'    THEN s.delay_value ELSE 0 END
      ),
      'whatsapp',
      s.template_name,
      TRUE,
      c.id,
      s.position,
      c.name
    FROM follow_up_cadences c
    JOIN LATERAL (
      SELECT * FROM follow_up_cadence_steps st
      WHERE st.cadence_id = c.id
      ORDER BY st.position ASC
      LIMIT 1
    ) s ON TRUE
    WHERE c.trigger_stage_id = NEW.stage_id
      AND c.account_id = NEW.account_id
      AND c.is_active
    ON CONFLICT DO NOTHING;
  END IF;

  -- Keep pending follow-ups owned by the deal's current agent.
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    UPDATE deal_follow_ups
    SET assigned_to = NEW.assigned_to
    WHERE deal_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let follow-up bookkeeping block a deal write.
  RAISE WARNING 'deals_sync_cadences failed for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION deals_sync_cadences() OWNER TO postgres;

DROP TRIGGER IF EXISTS deals_sync_cadences ON deals;
CREATE TRIGGER deals_sync_cadences
  AFTER INSERT OR UPDATE OF stage_id, status, assigned_to ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_sync_cadences();

-- ============================================================
-- 9. NOTIFICATIONS — allow follow-up reminders
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'follow_up_due'));

-- ============================================================
-- 10. REALTIME — follow-ups refresh live on the board
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'deal_follow_ups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deal_follow_ups;
  END IF;
END $$;
