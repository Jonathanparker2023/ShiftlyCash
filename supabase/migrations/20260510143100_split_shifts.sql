alter table public.earn_slots
  add column if not exists regular_hours numeric(6, 2) not null default 0,
  add column if not exists overtime_hours numeric(6, 2) not null default 0;

alter table public.template_slots
  add column if not exists regular_hours numeric(6, 2) not null default 0,
  add column if not exists overtime_hours numeric(6, 2) not null default 0;

alter table public.earn_slots
  drop constraint if exists earn_slots_split_hours_check;

alter table public.earn_slots
  add constraint earn_slots_split_hours_check check (
    regular_hours >= 0
    and overtime_hours >= 0
    and (
      pay_type::text <> 'split'
      or (regular_hours > 0 and overtime_hours > 0)
    )
  );

alter table public.template_slots
  drop constraint if exists template_slots_split_hours_check;

alter table public.template_slots
  add constraint template_slots_split_hours_check check (
    regular_hours >= 0
    and overtime_hours >= 0
    and (
      pay_type::text <> 'split'
      or (regular_hours > 0 and overtime_hours > 0)
    )
  );

update public.earn_slots
set
  regular_hours = case when pay_type::text = 'regular' then hours_or_units else 0 end,
  overtime_hours = case when pay_type::text = 'overtime' then hours_or_units else 0 end
where pay_type::text in ('regular', 'overtime');

update public.template_slots
set
  regular_hours = case when pay_type::text = 'regular' then hours_or_units else 0 end,
  overtime_hours = case when pay_type::text = 'overtime' then hours_or_units else 0 end
where pay_type::text in ('regular', 'overtime');

-- Default template cleanup for Jon's real recurring split shifts:
-- Monday Ability = 4 regular + 2 OT in one visible slot.
update public.template_slots
set
  pay_type = 'split',
  hours_or_units = 6,
  regular_hours = 4,
  overtime_hours = 2,
  updated_at = now()
where day_index = 1
  and slot_index = 1
  and job_type::text = 'ability';

delete from public.template_slots
where day_index = 1
  and slot_index = 2
  and job_type::text = 'ability'
  and pay_type::text = 'overtime';

-- Friday Nate is Prestige ILST under the hood, displayed as Prestige in the UI:
-- 4 regular + 8 OT in one visible slot.
delete from public.template_slots
where day_index = 5
  and slot_index = 1
  and job_type::text in ('prestige', 'prestige_ilst')
  and pay_type::text = 'overtime';

update public.template_slots
set
  job_type = 'prestige_ilst',
  pay_type = 'split',
  hours_or_units = 12,
  regular_hours = 4,
  overtime_hours = 8,
  updated_at = now()
where day_index = 5
  and slot_index = 0
  and job_type::text in ('prestige', 'prestige_ilst');

update public.template_slots
set
  slot_index = 1,
  updated_at = now()
where day_index = 5
  and slot_index = 2
  and job_type::text = 'ability'
  and not exists (
    select 1
    from public.template_slots conflict_slot
    where conflict_slot.template_id = public.template_slots.template_id
      and conflict_slot.day_index = 5
      and conflict_slot.slot_index = 1
  );

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
        when es.job_type::text = 'ability' and es.pay_type::text = 'split'
          then (es.regular_hours * s.ability_regular_net_rate)
            + (es.overtime_hours * s.ability_ot_net_rate)
        when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_regular_net_rate)
            + (es.overtime_hours * s.prestige_ot_net_rate)
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_ilst_net_rate)
            + (es.overtime_hours * s.prestige_ilst_ot_net_rate)
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
        when es.job_type::text = 'ability' and es.pay_type::text = 'split'
          then (es.regular_hours * s.ability_regular_net_rate)
            + (es.overtime_hours * s.ability_ot_net_rate)
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
        when es.job_type::text = 'prestige' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_regular_net_rate)
            + (es.overtime_hours * s.prestige_ot_net_rate)
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_ilst_net_rate)
            + (es.overtime_hours * s.prestige_ilst_ot_net_rate)
        else 0
      end
    ), 0)::numeric(12, 2) as prestige_paycheck_earnings,
    coalesce(sum(
      case
        when es.job_type::text in ('ability', 'prestige', 'prestige_ilst')
          then case
            when es.pay_type::text = 'split'
              then es.regular_hours + es.overtime_hours
            else es.hours_or_units
          end
        else 0
      end
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

create or replace function public.apply_default_template_to_week(p_week_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_touched_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to apply a template.';
  end if;

  if not exists (
    select 1
    from public.weeks w
    where w.id = p_week_id
      and w.user_id = v_user_id
  ) then
    raise exception 'Week not found.';
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

  with updated as (
    update public.earn_slots es
      set
        job_type = ts.job_type,
        pay_type = ts.pay_type,
        hours_or_units = ts.hours_or_units,
        regular_hours = ts.regular_hours,
        overtime_hours = ts.overtime_hours,
        label = sl.label,
        source = 'template',
        updated_at = now()
    from public.days d
    join public.template_slots ts
      on ts.user_id = v_user_id
      and ts.template_id = v_template_id
      and ts.day_index = d.day_index
    left join public.sticky_labels sl
      on sl.user_id = v_user_id
      and sl.day_index = ts.day_index
      and sl.slot_index = ts.slot_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and es.user_id = v_user_id
      and es.day_id = d.id
      and es.slot_index = ts.slot_index
      and es.job_type = 'none'
      and es.hours_or_units = 0
    returning es.id
  ),
  inserted as (
    insert into public.earn_slots (
      user_id,
      day_id,
      slot_index,
      job_type,
      pay_type,
      hours_or_units,
      regular_hours,
      overtime_hours,
      label,
      source
    )
    select
      v_user_id,
      d.id,
      ts.slot_index,
      ts.job_type,
      ts.pay_type,
      ts.hours_or_units,
      ts.regular_hours,
      ts.overtime_hours,
      sl.label,
      'template'
    from public.days d
    join public.template_slots ts
      on ts.user_id = v_user_id
      and ts.template_id = v_template_id
      and ts.day_index = d.day_index
    left join public.sticky_labels sl
      on sl.user_id = v_user_id
      and sl.day_index = ts.day_index
      and sl.slot_index = ts.slot_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and not exists (
        select 1
        from public.earn_slots es
        where es.user_id = v_user_id
          and es.day_id = d.id
          and es.slot_index = ts.slot_index
      )
    returning id
  )
  select count(*)::integer
    into v_touched_count
  from (
    select id from updated
    union all
    select id from inserted
  ) touched;

  return v_touched_count;
end;
$$;

grant execute on function public.apply_default_template_to_week(uuid) to authenticated;

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
    from (
      select
        (payload.slot ->> 'dayIndex')::integer as day_index,
        (payload.slot ->> 'slotIndex')::integer as slot_index,
        (payload.slot ->> 'jobType') as job_type,
        (payload.slot ->> 'payType') as pay_type,
        coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
        coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
        coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours
      from jsonb_array_elements(p_slots) as payload(slot)
    ) parsed
    where parsed.day_index not between 0 and 6
      or parsed.slot_index not between 0 and 3
      or parsed.job_type not in (
        'ability',
        'prestige',
        'prestige_ilst',
        'incentive',
        'other',
        'none'
      )
      or parsed.pay_type not in ('regular', 'overtime', 'split', 'unit', 'none')
      or parsed.hours_or_units < 0
      or parsed.regular_hours < 0
      or parsed.overtime_hours < 0
      or (
        parsed.pay_type = 'split'
        and (
          parsed.job_type not in ('ability', 'prestige', 'prestige_ilst')
          or parsed.regular_hours <= 0
          or parsed.overtime_hours <= 0
        )
      )
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
    hours_or_units,
    regular_hours,
    overtime_hours
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id,
    v_template_id,
    parsed.day_index,
    parsed.slot_index,
    parsed.job_type::public.job_type,
    parsed.pay_type::public.pay_type,
    case
      when parsed.pay_type = 'split'
        then parsed.regular_hours + parsed.overtime_hours
      else parsed.hours_or_units
    end,
    parsed.regular_hours,
    parsed.overtime_hours
  from (
    select
      (payload.slot ->> 'dayIndex')::integer as day_index,
      (payload.slot ->> 'slotIndex')::integer as slot_index,
      (payload.slot ->> 'jobType') as job_type,
      (payload.slot ->> 'payType') as pay_type,
      coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
      coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
      coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours
    from jsonb_array_elements(p_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and (
      case
        when parsed.pay_type = 'split'
          then parsed.regular_hours + parsed.overtime_hours
        else parsed.hours_or_units
      end
    ) > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;

  return v_inserted_count;
end;
$$;

grant execute on function public.replace_default_template_slots(jsonb) to authenticated;
