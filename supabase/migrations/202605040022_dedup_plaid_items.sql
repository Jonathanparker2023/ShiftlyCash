-- Remove duplicate Plaid item connection. User accidentally linked Chime twice;
-- both items were independently syncing the same account producing duplicate
-- transactions. Keep the older item (created first), delete the newer one.

do $$
declare
  v_dup_item_id uuid := '1578e415-1969-458b-8438-394707870a35';
begin
  delete from public.transactions where plaid_item_id = v_dup_item_id;
  delete from public.plaid_items where id = v_dup_item_id;
end $$;
