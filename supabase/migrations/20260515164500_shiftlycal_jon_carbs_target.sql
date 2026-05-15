-- Seed Jon's daily carbs target for the 1650 cal cut.
-- 180g protein = 720 cal. Reserving ~50g fat = 450 cal.
-- Remaining 480 cal / 4 cal-per-g = 120g carbs.

update public.settings
  set carbs_target_g = coalesce(carbs_target_g, 120)
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
