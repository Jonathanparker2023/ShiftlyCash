create or replace function public.upsert_plaid_item_from_server(
  p_plaid_item_id text,
  p_access_token_encrypted text,
  p_institution_name text,
  p_status public.plaid_item_status default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required to store Plaid item.';
  end if;

  insert into public.plaid_items (
    user_id,
    plaid_item_id,
    access_token_encrypted,
    institution_name,
    status
  )
  values (
    v_user_id,
    p_plaid_item_id,
    p_access_token_encrypted,
    nullif(btrim(coalesce(p_institution_name, '')), ''),
    p_status
  )
  on conflict (user_id, plaid_item_id) where plaid_item_id is not null
  do update
    set
      access_token_encrypted = excluded.access_token_encrypted,
      institution_name = excluded.institution_name,
      status = excluded.status
  returning id into v_item_id;

  return v_item_id;
end;
$$;

grant execute on function public.upsert_plaid_item_from_server(
  text,
  text,
  text,
  public.plaid_item_status
) to authenticated;

create or replace function public.plaid_items_for_server_sync()
returns table (
  id uuid,
  plaid_item_id text,
  access_token_encrypted text,
  cursor text,
  institution_name text,
  status public.plaid_item_status
)
language sql
security definer
set search_path = public
as $$
  select
    pi.id,
    pi.plaid_item_id,
    pi.access_token_encrypted,
    pi.cursor,
    pi.institution_name,
    pi.status
  from public.plaid_items pi
  where pi.user_id = auth.uid()
  order by pi.created_at;
$$;

grant execute on function public.plaid_items_for_server_sync() to authenticated;

create or replace function public.update_plaid_item_sync_state(
  p_item_id uuid,
  p_cursor text,
  p_status public.plaid_item_status default 'active'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required to update Plaid item.';
  end if;

  update public.plaid_items
  set
    cursor = p_cursor,
    status = p_status,
    last_synced_at = now()
  where id = p_item_id
    and user_id = v_user_id;
end;
$$;

grant execute on function public.update_plaid_item_sync_state(
  uuid,
  text,
  public.plaid_item_status
) to authenticated;

do $$
begin
  alter table public.transactions
    add constraint transactions_user_plaid_transaction_unique
    unique (user_id, plaid_transaction_id);
exception
  when duplicate_object then null;
end $$;
