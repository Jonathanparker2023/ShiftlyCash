create or replace function public.reset_shiftlycal_projected_entries(
  p_user_id uuid,
  p_rows jsonb
)
returns table(cleaned integer, projected integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('shiftlycal_projection:' || p_user_id::text, 0)
  );

  delete from public.food_entries
    where user_id = p_user_id
      and is_projected_plan = true;

  get diagnostics cleaned = row_count;

  insert into public.food_entries (
    user_id,
    date,
    logged_time,
    meal_name,
    category,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    fiber_g,
    sodium_mg,
    added_sugar_g,
    saturated_fat_g,
    is_projected_plan,
    verdict,
    verdict_source,
    verdict_reason,
    verdict_context
  )
  select
    p_user_id,
    (row_data ->> 'date')::date,
    nullif(row_data ->> 'logged_time', '')::time,
    row_data ->> 'meal_name',
    row_data ->> 'category',
    (row_data ->> 'calories')::integer,
    (row_data ->> 'protein_g')::integer,
    (row_data ->> 'carbs_g')::integer,
    (row_data ->> 'fat_g')::integer,
    (row_data ->> 'fiber_g')::integer,
    (row_data ->> 'sodium_mg')::integer,
    (row_data ->> 'added_sugar_g')::integer,
    (row_data ->> 'saturated_fat_g')::integer,
    true,
    'good',
    'unscored',
    'Projected plan entry.',
    null
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row_data;

  get diagnostics projected = row_count;
  return next;
end;
$$;

grant execute on function public.reset_shiftlycal_projected_entries(uuid, jsonb)
  to authenticated, service_role;
