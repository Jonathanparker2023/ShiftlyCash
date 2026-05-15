update public.settings
  set age = 28,
      sex = 'male',
      height_cm = 175,
      activity_level = 'sedentary',
      current_phase = 'cut',
      goals_text = 'Aggressive but healthy fat loss for property/investing trajectory; protein-prioritized, sustainable energy.',
      health_flags = '{}'::text[],
      tdee_calories = 1650,
      protein_target_g = coalesce(protein_target_g, 180),
      fiber_target_g = coalesce(fiber_target_g, 30)
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  );
