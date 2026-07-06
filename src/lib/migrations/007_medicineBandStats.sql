-- ══════════════════════════════════════════════════
-- MedSetu — Tier Commission Redesign: category band stats
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- master_medicines has ~2.5 lakh rows — a plain GROUP BY from the client
-- would mean pulling every row over the wire just to count them. This
-- function does the aggregation in Postgres and returns one row per
-- category, so the admin UI only ever fetches a few dozen rows.
CREATE OR REPLACE FUNCTION get_category_band_stats()
RETURNS TABLE (
  category          TEXT,
  total_count       BIGINT,
  classified_count  BIGINT,
  high_count        BIGINT,
  moderate_count    BIGINT,
  low_count         BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(category, 'Uncategorized')                     AS category,
    COUNT(*)                                                 AS total_count,
    COUNT(commission_band)                                   AS classified_count,
    COUNT(*) FILTER (WHERE commission_band = 'high')         AS high_count,
    COUNT(*) FILTER (WHERE commission_band = 'moderate')     AS moderate_count,
    COUNT(*) FILTER (WHERE commission_band = 'low')          AS low_count
  FROM master_medicines
  GROUP BY category
  ORDER BY total_count DESC;
$$;
