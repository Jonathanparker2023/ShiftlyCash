-- Split Prestige ILST shifts into their own job type/rates and lower the
-- Prestige withholding stopgap to match Jon's observed paystub.

alter type public.job_type add value if not exists 'prestige_ilst';

alter table public.settings
  add column if not exists prestige_ilst_net_rate numeric(10, 2) not null default 15.48,
  add column if not exists prestige_ilst_ot_net_rate numeric(10, 2) not null default 23.22;

alter table public.settings
  alter column prestige_regular_net_rate set default 14.62,
  alter column prestige_ot_net_rate set default 21.93,
  alter column prestige_withholding_rate set default 0.1400;

update public.settings set
  prestige_regular_net_rate = 14.62,
  prestige_ot_net_rate = 21.93,
  prestige_withholding_rate = 0.14,
  prestige_ilst_net_rate = 15.48,
  prestige_ilst_ot_net_rate = 23.22,
  updated_at = now()
where prestige_withholding_rate = 0.18;

create or replace view public.v_day_totals
with (security_invoker = true)
as
with earn_totals as (
  select
    es.day_id,
    es.user_id,
    coalesce(sum(
      case
        when es.job_type::text = 'ability' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type::text = 'ability' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'incentive'
          then es.hours_or_units * (1 - s.ability_withholding_rate)
        when es.job_type::text = 'other'
          then es.hours_or_units
        else 0
      end
    ), 0)::numeric(12, 2) as earnings_total,
    coalesce(sum(
      case
        when es.job_type::text = 'ability' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type::text = 'ability' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type::text = 'incentive'
          then es.hours_or_units * (1 - s.ability_withholding_rate)
        else 0
      end
    ), 0)::numeric(12, 2) as ability_paycheck_earnings,
    coalesce(sum(
      case
        when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        else 0
      end
    ), 0)::numeric(12, 2) as prestige_paycheck_earnings,
    coalesce(sum(es.hours_or_units) filter (
      where es.job_type::text in ('ability', 'prestige', 'prestige_ilst')
    ), 0)::numeric(10, 2) as wage_hours_total
  from public.earn_slots es
  join public.settings s on s.user_id = es.user_id
  group by es.day_id, es.user_id
),
transaction_totals as (
  select
    t.day_id,
    t.user_id,
    coalesce(sum(t.amount) filter (where t.status = 'applied'), 0)::numeric(12, 2)
      as transaction_spend_total,
    coalesce(sum(t.amount) filter (
      where t.status = 'applied' and t.source = 'manual'
    ), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(t.amount) filter (
      where t.status = 'applied' and t.source = 'plaid'
    ), 0)::numeric(12, 2) as plaid_transaction_total,
    coalesce(count(*) filter (where t.status = 'pending_review'), 0)::integer
      as pending_transaction_count
  from public.transactions t
  where t.day_id is not null
  group by t.day_id, t.user_id
)
select
  d.id as day_id,
  d.user_id,
  d.week_id,
  d.date,
  d.day_index,
  d.base_amount,
  d.manual_spend_adjustment,
  d.spend_locked,
  coalesce(e.earnings_total, 0)::numeric(12, 2) as earnings_total,
  coalesce(e.ability_paycheck_earnings, 0)::numeric(12, 2) as ability_paycheck_earnings,
  coalesce(e.prestige_paycheck_earnings, 0)::numeric(12, 2) as prestige_paycheck_earnings,
  coalesce(e.wage_hours_total, 0)::numeric(10, 2) as wage_hours_total,
  coalesce(t.transaction_spend_total, 0)::numeric(12, 2) as transaction_spend_total,
  coalesce(t.manual_transaction_total, 0)::numeric(12, 2) as manual_transaction_total,
  coalesce(t.plaid_transaction_total, 0)::numeric(12, 2) as plaid_transaction_total,
  coalesce(t.pending_transaction_count, 0)::integer as pending_transaction_count,
  (
    coalesce(t.transaction_spend_total, 0)
    + d.manual_spend_adjustment
  )::numeric(12, 2) as spend_total,
  (
    coalesce(e.earnings_total, 0)
    - (coalesce(t.transaction_spend_total, 0) + d.manual_spend_adjustment)
    - d.base_amount
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id;

alter table public.settings
  drop constraint if exists settings_rate_bounds;

alter table public.settings
  add constraint settings_rate_bounds check (
    ability_regular_net_rate >= 0
    and ability_ot_net_rate >= 0
    and prestige_regular_net_rate >= 0
    and prestige_ot_net_rate >= 0
    and prestige_ilst_net_rate >= 0
    and prestige_ilst_ot_net_rate >= 0
    and ability_withholding_rate >= 0 and ability_withholding_rate < 1
    and prestige_withholding_rate >= 0 and prestige_withholding_rate < 1
  );

create or replace function public.replace_default_template_slots(p_slots jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_inserted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to save template slots.';
  end if;

  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Template slots payload must be a JSON array.';
  end if;

  select wt.id
    into v_template_id
  from public.weekly_templates wt
  where wt.user_id = v_user_id
    and wt.is_default
  order by wt.created_at
  limit 1;

  if v_template_id is null then
    raise exception 'Default weekly template not found.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_slots) as payload(slot)
    where (payload.slot ->> 'dayIndex')::integer not between 0 and 6
      or (payload.slot ->> 'slotIndex')::integer not between 0 and 3
      or (payload.slot ->> 'jobType') not in (
        'ability',
        'prestige',
        'prestige_ilst',
        'incentive',
        'other',
        'none'
      )
      or (payload.slot ->> 'payType') not in ('regular', 'overtime', 'unit', 'none')
      or (payload.slot ->> 'hoursOrUnits')::numeric < 0
  ) then
    raise exception 'Template slots payload contains invalid values.';
  end if;

  delete from public.template_slots
  where user_id = v_user_id
    and template_id = v_template_id;

  insert into public.template_slots (
    user_id,
    template_id,
    day_index,
    slot_index,
    job_type,
    pay_type,
    hours_or_units
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id,
    v_template_id,
    parsed.day_index,
    parsed.slot_index,
    parsed.job_type::public.job_type,
    parsed.pay_type::public.pay_type,
    parsed.hours_or_units
  from (
    select
      (payload.slot ->> 'dayIndex')::integer as day_index,
      (payload.slot ->> 'slotIndex')::integer as slot_index,
      (payload.slot ->> 'jobType') as job_type,
      (payload.slot ->> 'payType') as pay_type,
      (payload.slot ->> 'hoursOrUnits')::numeric as hours_or_units
    from jsonb_array_elements(p_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and parsed.hours_or_units > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;

  return v_inserted_count;
end;
$$;

grant execute on function public.replace_default_template_slots(jsonb) to authenticated;
