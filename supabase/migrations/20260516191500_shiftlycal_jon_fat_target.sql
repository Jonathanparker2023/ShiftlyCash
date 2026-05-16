-- Set Jon's daily total fat target to 50g.
-- Math from the 1650 cal cut + 180g protein + 120g carbs setup:
--   Protein 180g × 4 cal/g = 720 cal (44%)
--   Carbs   120g × 4 cal/g = 480 cal (29%)
--   Fat      50g × 9 cal/g = 450 cal (27%)
-- The 18g saturated fat ceiling sits inside the 50g total.

update public.settings
  set fat_target_g = 50
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
