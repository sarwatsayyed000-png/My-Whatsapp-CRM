-- ============================================================
-- 043_contact_opt_out
--
-- Marketing opt-out for contacts. WhatsApp's Business Messaging Policy
-- requires honouring a customer's request to stop receiving marketing
-- messages, and sending to people who have asked to stop drags down the
-- number's quality rating.
--
--   opted_out      — true once the contact asked to stop (or an agent
--                    marked them). Broadcasts skip these contacts;
--                    one-to-one inbox replies are unaffected.
--   opted_out_at   — when it happened (NULL while subscribed).
--   opt_out_source — 'keyword' (customer sent STOP / UNSUBSCRIBE,
--                    detected by the inbound webhook) or 'manual'
--                    (toggled in the Contacts UI).
--
-- A customer who later sends START / SUBSCRIBE is opted back in by the
-- webhook, which clears all three columns.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_out_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_opt_out_source_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_opt_out_source_check
      CHECK (opt_out_source IS NULL OR opt_out_source IN ('keyword', 'manual'));
  END IF;
END $$;

-- Partial index: broadcasts and the Contacts filter look up the (small)
-- opted-out set per account.
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts(account_id)
  WHERE opted_out;

COMMENT ON COLUMN contacts.opted_out IS
  'True when the contact asked to stop marketing messages. Broadcasts skip them.';
COMMENT ON COLUMN contacts.opted_out_at IS
  'When the contact opted out. NULL while subscribed.';
COMMENT ON COLUMN contacts.opt_out_source IS
  '''keyword'' (inbound STOP/UNSUBSCRIBE) or ''manual'' (set in the Contacts UI).';
