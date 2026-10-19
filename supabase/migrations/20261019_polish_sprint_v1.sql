-- İstanbul Nokta Polish Sprint v1: search on the existing pins schema.
-- SECURITY INVOKER keeps the existing pins RLS policies in effect.
CREATE OR REPLACE FUNCTION public.pins_search(q text)
RETURNS SETOF public.pins
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p.*
  FROM public.pins AS p
  WHERE auth.uid() IS NOT NULL
    AND NULLIF(btrim(q), '') IS NOT NULL
    AND p.description ILIKE '%' || btrim(q) || '%'
  ORDER BY p.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.pins_search(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pins_search(text) TO authenticated;
