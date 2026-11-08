CREATE OR REPLACE FUNCTION public.create_quick_report(
  p_lat double precision,
  p_lng double precision,
  p_quick_category text,
  p_report_session_id uuid,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_pin_id uuid;
  v_description text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active membership required';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'valid lat/lng required';
  END IF;

  IF p_report_session_id IS NULL THEN
    RAISE EXCEPTION 'report_session_id required';
  END IF;

  IF p_quick_category IS NULL OR p_quick_category NOT IN (
    'kaza','radar','polis','yol_calismasi','tehlike','yol_kapali'
  ) THEN
    RAISE EXCEPTION 'invalid quick_category: %', p_quick_category;
  END IF;

  v_description := COALESCE(
    NULLIF(btrim(p_description), ''),
    'Hizli ihbar: ' || p_quick_category
  );

  INSERT INTO public.pins (
    owner_id, lat, lng, description, category, report_mode, quick_category
  )
  VALUES (
    v_user_id, p_lat, p_lng, v_description, U&'GR\0130', 'quick', p_quick_category
  )
  RETURNING id INTO v_pin_id;

  INSERT INTO public.quick_report_stats (
    report_session_id, pin_id, user_id, event_type, quick_category
  )
  VALUES (
    p_report_session_id, v_pin_id, v_user_id, 'confirmed', p_quick_category
  );

  RETURN v_pin_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_quick_report(double precision,double precision,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_quick_report(double precision,double precision,text,uuid,text) TO authenticated;