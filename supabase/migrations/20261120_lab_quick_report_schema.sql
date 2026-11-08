-- =============================================================
-- Quick Report schema migration (additive)
-- create_pin_with_photos akisina ve voice_note_url alanina dokunmaz.
-- Idempotent; adds only Quick Report columns, indexes, stats table and RLS policies.
-- =============================================================

ALTER TABLE public.pins
  ADD COLUMN IF NOT EXISTS report_mode text NOT NULL DEFAULT 'detailed',
  ADD COLUMN IF NOT EXISTS quick_category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pins_report_mode'
      AND conrelid = 'public.pins'::regclass
  ) THEN
    ALTER TABLE public.pins
      ADD CONSTRAINT chk_pins_report_mode
      CHECK (report_mode IN ('quick', 'detailed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pins_quick_category'
      AND conrelid = 'public.pins'::regclass
  ) THEN
    ALTER TABLE public.pins
      ADD CONSTRAINT chk_pins_quick_category
      CHECK (
        quick_category IS NULL OR quick_category IN (
          'kaza', 'radar', 'polis', 'yol_calismasi', 'tehlike', 'yol_kapali'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pins_quick_category_consistency'
      AND conrelid = 'public.pins'::regclass
  ) THEN
    -- NOT: Bu constraint eklenirken mevcut satirlar taranir.
    -- LAB'da report_mode varsayilan 'detailed' oldugundan eski pinler
    -- quick_category NULL ise kontrolden gecer.
    -- Uretime tasinacaksa once NOT VALID + VALIDATE onerilir.
    ALTER TABLE public.pins
      ADD CONSTRAINT chk_pins_quick_category_consistency
      CHECK (
        (report_mode = 'quick' AND quick_category IS NOT NULL) OR
        (report_mode = 'detailed' AND quick_category IS NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_pins_report_mode
  ON public.pins(report_mode);

CREATE INDEX IF NOT EXISTS idx_pins_quick_category
  ON public.pins(quick_category)
  WHERE report_mode = 'quick';

CREATE TABLE IF NOT EXISTS public.quick_report_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_session_id uuid NOT NULL,
  pin_id uuid REFERENCES public.pins(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  quick_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_qrs_event_type'
      AND conrelid = 'public.quick_report_stats'::regclass
  ) THEN
    ALTER TABLE public.quick_report_stats
      ADD CONSTRAINT chk_qrs_event_type
      CHECK (event_type IN ('created', 'confirmed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_qrs_quick_category'
      AND conrelid = 'public.quick_report_stats'::regclass
  ) THEN
    ALTER TABLE public.quick_report_stats
      ADD CONSTRAINT chk_qrs_quick_category
      CHECK (
        quick_category IS NULL OR quick_category IN (
          'kaza', 'radar', 'polis', 'yol_calismasi', 'tehlike', 'yol_kapali'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_qrs_session
  ON public.quick_report_stats(report_session_id);

CREATE INDEX IF NOT EXISTS idx_qrs_user_created
  ON public.quick_report_stats(user_id, created_at DESC);

-- RLS satir filtresidir; tablo seviyesi yetki ayri olarak verilir.
GRANT SELECT, INSERT ON public.quick_report_stats TO authenticated;
-- UPDATE/DELETE yetkisi bilerek verilmez.

ALTER TABLE public.quick_report_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qrs_insert_own ON public.quick_report_stats;
CREATE POLICY qrs_insert_own
  ON public.quick_report_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND event_type IN ('created', 'cancelled')
  );

DROP POLICY IF EXISTS qrs_select_own ON public.quick_report_stats;
CREATE POLICY qrs_select_own
  ON public.quick_report_stats
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- confirmed olayi yalnizca SECURITY DEFINER RPC tarafindan yazilir.
-- Istemci dogrudan confirmed olayi uretmesin.
-- TODO (LAB sonrasi): created/cancelled olaylarini da
-- log_quick_report_event RPC uzerinden yaz; report_session_id +
-- quick_category tutarliligini DB tarafinda dogrula.
