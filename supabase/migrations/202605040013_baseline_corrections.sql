-- One-off correction (2026-05-04): align Jon's baseline expenses with his
-- current real-life list. Targets all existing users (single-user app for now).

-- Delete obsolete entries
delete from public.expenses
where name in ('ChatGPT', 'Verizon');

-- Correct amounts and names
update public.expenses set amount = 22.00 where name = 'Car Wash';
update public.expenses set amount = 192.00 where name = 'Perplexity';
update public.expenses set name = 'Oil change 3m', amount = 36.00 where name = 'Oil Change';
update public.expenses set expiration_date = '2030-04-16'::date where name = 'Home Insurance';

-- Add missing entries
insert into public.expenses (user_id, name, amount, expiration_date, is_active, sort_order)
select
  u.user_id,
  v.name,
  v.amount,
  v.expires,
  true,
  v.sort_order
from (
  select distinct user_id from public.expenses
) u
cross join (values
  ('Perplexity Overages'::text, 62.00::numeric, '2026-06-09'::date, 175),
  ('Claude Overages'::text, 25.00::numeric, '2026-05-11'::date, 180),
  ('Claude max 5x'::text, 133.00::numeric, null::date, 185),
  ('eleven labs'::text, 22.00::numeric, null::date, 190),
  ('Prime Video'::text, 18.00::numeric, null::date, 195),
  ('Amazon Prime'::text, 7.00::numeric, null::date, 200)
) as v(name, amount, expires, sort_order)
on conflict (user_id, name) do nothing;
