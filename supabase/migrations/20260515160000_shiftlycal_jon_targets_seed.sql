-- Seed Jon's targets for the new metrics added in batch 14.
-- Values: FDA/DGA-aligned, scaled for a 1650 cal/day cut.
--   sodium: 2300 mg/day (standard ceiling; not on BP flag yet)
--   added sugar: 41 g/day (10% of 1650 cal = 165 cal / 4 cal-per-g)
--   saturated fat: 18 g/day (10% of 1650 cal = 165 cal / 9 cal-per-g)
--   water: 100 oz/day (general male sedentary baseline)

update public.settings
  set sodium_target_mg = coalesce(sodium_target_mg, 2300),
      added_sugar_target_g = coalesce(added_sugar_target_g, 41),
      saturated_fat_target_g = coalesce(saturated_fat_target_g, 18),
      water_target_oz = coalesce(water_target_oz, 100)
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
