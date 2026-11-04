-- Consolidated record of security and archive/index changes already applied
-- directly to the production Supabase project. Idempotent for safe replay.

-- 1) Keep archived pin schema aligned with live pins.
ALTER TABLE public.archived_pins
  ADD COLUMN IF NOT EXISTS voice_note_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.archived_pins'::regclass
      AND contype = 'p'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.archived_pins WHERE id IS NULL)
       OR EXISTS (
         SELECT id FROM public.archived_pins
         GROUP BY id HAVING count(*) > 1
       ) THEN
      RAISE EXCEPTION 'archived_pins contains null or duplicate ids; refusing to add primary key';
    END IF;

    ALTER TABLE public.archived_pins ALTER COLUMN id SET NOT NULL;
    ALTER TABLE public.archived_pins
      ADD CONSTRAINT archived_pins_pkey PRIMARY KEY (id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_old_pins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin or service_role required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.archived_pins
    (id, owner_id, lat, lng, description, created_at, category, voice_note_url)
  SELECT
    id, owner_id, lat, lng, description, created_at, category, voice_note_url
  FROM public.pins
  WHERE created_at < NOW() - INTERVAL '24 hours'
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.pins
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_old_pins() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_old_pins() FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_pins() TO authenticated, service_role;

-- Archived records are visible only to admins.
DROP POLICY IF EXISTS archived_pins_admin_select ON public.archived_pins;
CREATE POLICY archived_pins_admin_select
  ON public.archived_pins
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- 2) Remove anonymous/public RPC execution from user-facing SECURITY DEFINER RPCs.
REVOKE EXECUTE ON FUNCTION public.add_comment(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aytar_online_members() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_profanity(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_pin_with_photos(double precision, double precision, text, text, jsonb, text, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_pin(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_pins_bulk(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_pin_vote(uuid, smallint) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.add_comment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aytar_online_members() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_profanity(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_pin_with_photos(double precision, double precision, text, text, jsonb, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pins_bulk(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_pin_vote(uuid, smallint) TO authenticated, service_role;

-- Pin down search_path on callable SECURITY DEFINER routines.
ALTER FUNCTION public.add_comment(uuid, text) SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.check_profanity(text) SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.create_pin_with_photos(double precision, double precision, text, text, jsonb, text, uuid) SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.delete_pin(uuid) SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.delete_pins_bulk(uuid[]) SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.toggle_pin_vote(uuid, smallint) SET search_path = public, auth, pg_temp;

-- 3) Foreign-key supporting indexes added during the audit.
CREATE INDEX IF NOT EXISTS pin_comments_pin_id_idx ON public.pin_comments(pin_id);
CREATE INDEX IF NOT EXISTS pin_comments_user_id_idx ON public.pin_comments(user_id);
CREATE INDEX IF NOT EXISTS pin_reactions_user_id_idx ON public.pin_reactions(user_id);
CREATE INDEX IF NOT EXISTS pin_reports_reporter_id_idx ON public.pin_reports(reporter_id);
CREATE INDEX IF NOT EXISTS pin_votes_user_id_idx ON public.pin_votes(user_id);
CREATE INDEX IF NOT EXISTS aytar_blocked_users_blocked_id_idx ON public.aytar_blocked_users(blocked_id);
CREATE INDEX IF NOT EXISTS aytar_call_signals_sender_id_idx ON public.aytar_call_signals(sender_id);
CREATE INDEX IF NOT EXISTS aytar_muted_users_muted_id_idx ON public.aytar_muted_users(muted_id);
CREATE INDEX IF NOT EXISTS pins_owner_id_idx ON public.pins(owner_id);
CREATE INDEX IF NOT EXISTS reference_codes_created_by_idx ON public.reference_codes(created_by);

-- 4) Trigger functions: revoke direct anon/PUBLIC RPC access only.
-- Trigger definitions and function bodies are intentionally unchanged.
REVOKE EXECUTE ON FUNCTION public.dispatch_aytar_push_webhook() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_push_on_new_message() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_profile_pin_count() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_profile_vote_count() FROM anon, PUBLIC;
