create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.week_status as enum ('active', 'closed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.job_type as enum ('ability', 'prestige', 'incentive', 'other', 'none');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.pay_type as enum ('regular', 'overtime', 'unit', 'none');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.earn_slot_source as enum ('template', 'user', 'migration', 'ai');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_source as enum ('plaid', 'manual', 'migration');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_status as enum ('applied', 'pending_review', 'excluded');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.plaid_item_status as enum ('active', 'login_required', 'error');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_rule_type as enum ('merchant', 'category', 'pattern');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.debt_status as enum ('active', 'paid');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.asset_category as enum ('vehicle', 'cash', 'investment', 'other');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.ai_review_type as enum ('weekly', 'paycheck');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.email_backup_status as enum ('sent', 'failed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.snapshot_type as enum (
    'pre_migration',
    'pre_week_close',
    'post_week_close',
    'history_edit',
    'week_reopen',
    'year_close',
    'manual_backup'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.migration_status as enum ('running', 'succeeded', 'failed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.review_severity as enum ('info', 'warning', 'error');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.review_resolution_status as enum ('open', 'resolved', 'ignored');
exception when duplicate_object then null;
end $$;

create or replace function public.shiftly_first_sunday(p_date date)
returns date
language sql
immutable
as $$
  select (
    date_trunc('year', p_date)::date
    + ((7 - extract(dow from date_trunc('year', p_date)::date)::int) % 7)
  )::date;
$$;

create or replace function public.shiftly_display_week_number(p_start_date date)
returns integer
language sql
immutable
as $$
  select floor((p_start_date - public.shiftly_first_sunday(p_start_date))::numeric / 7)::integer + 1;
$$;

create or replace function public.weeks_per_month()
returns numeric
language sql
immutable
as $$
  select 4.33::numeric;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
