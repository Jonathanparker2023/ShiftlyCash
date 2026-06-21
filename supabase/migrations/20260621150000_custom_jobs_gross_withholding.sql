alter table public.custom_jobs
  add column if not exists regular_gross_rate_cents integer not null default 0 check (regular_gross_rate_cents >= 0),
  add column if not exists ot_gross_rate_cents integer not null default 0 check (ot_gross_rate_cents >= 0),
  add column if not exists withholding_rate numeric(6,4) not null default 0 check (withholding_rate >= 0 and withholding_rate < 1);

update public.custom_jobs
  set regular_gross_rate_cents = coalesce(nullif(regular_gross_rate_cents, 0), regular_rate_cents),
      ot_gross_rate_cents = coalesce(nullif(ot_gross_rate_cents, 0), ot_rate_cents),
      withholding_rate = coalesce(withholding_rate, 0);

comment on column public.custom_jobs.regular_gross_rate_cents is
  'Gross regular hourly rate in cents. regular_rate_cents remains the computed net rate used by earnings views.';
comment on column public.custom_jobs.ot_gross_rate_cents is
  'Gross overtime hourly rate in cents. ot_rate_cents remains the computed net rate used by earnings views.';
comment on column public.custom_jobs.withholding_rate is
  'Fractional withholding estimate, e.g. 0.1800 for 18%.';
