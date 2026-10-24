-- Snapshots and their raw/derived evidence are immutable once written.
-- UPDATE is always rejected. DELETE is only allowed as part of a cascade
-- (brand / workspace deletion), signalled by the session setting
-- aivt.allow_evidence_delete = 'on'.
CREATE OR REPLACE FUNCTION aivt_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is immutable: UPDATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aivt_guard_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('aivt.allow_evidence_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is immutable: direct DELETE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON snapshots FOR EACH ROW EXECUTE FUNCTION aivt_block_update();
--> statement-breakpoint
CREATE TRIGGER ai_responses_no_update BEFORE UPDATE ON ai_responses FOR EACH ROW EXECUTE FUNCTION aivt_block_update();
--> statement-breakpoint
CREATE TRIGGER brand_mentions_no_update BEFORE UPDATE ON brand_mentions FOR EACH ROW EXECUTE FUNCTION aivt_block_update();
--> statement-breakpoint
CREATE TRIGGER citations_no_update BEFORE UPDATE ON citations FOR EACH ROW EXECUTE FUNCTION aivt_block_update();
--> statement-breakpoint
CREATE TRIGGER sentiment_no_update BEFORE UPDATE ON sentiment_analyses FOR EACH ROW EXECUTE FUNCTION aivt_block_update();
--> statement-breakpoint
CREATE TRIGGER snapshots_guard_delete BEFORE DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION aivt_guard_delete();
