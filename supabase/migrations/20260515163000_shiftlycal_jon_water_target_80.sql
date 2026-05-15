-- Drop water target from 100oz to 80oz.
-- 100oz was the IOM population ceiling (3.7L total × 80% from beverages).
-- For Jon's specific profile (sedentary male, temperate climate, mild HBP, cut),
-- 80oz is the evidence-defensible target — above sedentary baseline, below
-- ambitious active-target, achievable enough to actually hit daily.

update public.settings
  set water_target_oz = 80
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
