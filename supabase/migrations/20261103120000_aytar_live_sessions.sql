-- AYTAR LIVE: session records, location privacy and private Realtime signaling.
-- Apply to the AYTAR Supabase project only after reviewing this migration.
-- The browser never writes session rows; the authenticated live-session Edge Function
-- performs start/join/heartbeat/end with service_role after validating the caller.

CREATE TABLE IF NOT EXISTS public.live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL,
  room_id uuid NOT NULL,
  slot_no smallint NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_slot_no_check CHECK (slot_no BETWEEN 1 AND 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_slot_active_uidx
  ON public.live_sessions(slot_no) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS live_sessions_active_last_seen_idx
  ON public.live_sessions(last_seen_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS live_sessions_user_active_idx
  ON public.live_sessions(user_id,last_seen_at DESC) WHERE ended_at IS NULL;

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_sessions FROM PUBLIC, anon;
GRANT SELECT ON public.live_sessions TO authenticated;
GRANT ALL ON public.live_sessions TO service_role;

DROP POLICY IF EXISTS live_sessions_select_active_members ON public.live_sessions;
CREATE POLICY live_sessions_select_active_members
  ON public.live_sessions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.status = 'active'
  ));

REVOKE INSERT, UPDATE, DELETE ON public.live_sessions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.live_session_locations_private (
  session_id uuid PRIMARY KEY REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.live_session_locations_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_session_locations_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.live_session_locations_private TO service_role;

CREATE OR REPLACE VIEW public.live_sessions_public
WITH (security_invoker = true)
AS
SELECT id,user_id,lat,lng,room_id,started_at
FROM public.live_sessions
WHERE ended_at IS NULL
  AND last_seen_at >= now() - interval '5 minutes';
GRANT SELECT ON public.live_sessions_public TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_live_session_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE chosen_slot smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.user_id AND p.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Active membership required' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(74102110);
    SELECT candidate.slot_no INTO chosen_slot
    FROM pg_catalog.generate_series(1,10) AS candidate(slot_no)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.live_sessions s
      WHERE s.slot_no = candidate.slot_no AND s.ended_at IS NULL
    )
    ORDER BY candidate.slot_no LIMIT 1;
    IF chosen_slot IS NULL THEN
      RAISE EXCEPTION 'Live publication limit reached (10)' USING ERRCODE = 'P0001';
    END IF;
    NEW.slot_no := chosen_slot;
    NEW.started_at := pg_catalog.now();
    NEW.last_seen_at := pg_catalog.now();
    NEW.ended_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.pin_id IS DISTINCT FROM OLD.pin_id THEN
    RAISE EXCEPTION 'Session owner and pin cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'Ended sessions cannot be reactivated' USING ERRCODE = 'P0001';
  END IF;
  NEW.slot_no := OLD.slot_no;
  IF NEW.ended_at IS NULL THEN NEW.last_seen_at := pg_catalog.now(); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_live_session_slot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS live_sessions_allocate_slot ON public.live_sessions;
CREATE TRIGGER live_sessions_allocate_slot
  BEFORE INSERT OR UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.allocate_live_session_slot();

-- Only authenticated active members may signal inside a room topic.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='aytar_live_signal_read') THEN
    CREATE POLICY aytar_live_signal_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (realtime.topic() LIKE 'room:%' AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.status='active'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='aytar_live_signal_write') THEN
    CREATE POLICY aytar_live_signal_write ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (realtime.topic() LIKE 'room:%' AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.status='active'
      ));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='live_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
  END IF;
END
$$;
