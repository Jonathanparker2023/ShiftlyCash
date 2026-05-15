-- Set Jon's daily carbs target to 120g.
-- Math check against 1650 cal cut:
--   120g carbs × 4 cal/g = 480 cal (29% of TDEE)
--   180g protein × 4 cal/g = 720 cal (44%)
--   Remaining ~450 cal for fat = 50g (27%)
-- A moderate-low carb cut distribution. Protein-led, training-fuel-adequate.

update public.settings
  set carbs_target_g = 120
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
