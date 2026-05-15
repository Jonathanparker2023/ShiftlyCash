-- Jon disclosed mild high blood pressure. Apply DASH lower-sodium plan:
--   - Add 'high_blood_pressure' to health_flags (verdict engine maps this to a
--     surgical sodium rule per src/lib/cal/verdict.ts).
--   - Drop sodium target from 2300mg (general FDA DV) to 1500mg (DASH lower-sodium
--     for hypertension; shows ~2-7 mm Hg additional systolic drop vs standard
--     2300mg per NHLBI guidance).
-- Other targets (calories, protein, fiber, sat fat, added sugar, water) unchanged.

update public.settings
  set health_flags = array(
        select distinct unnest(coalesce(health_flags, '{}'::text[]) || array['high_blood_pressure'])
      ),
      sodium_target_mg = 1500
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
