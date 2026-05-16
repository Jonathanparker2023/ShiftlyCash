alter type public.transaction_source add value if not exists 'chime';

alter table public.chime_raw_captures
  add column if not exists raw_title text,
  add column if not exists parse_failure_reason text;
