update public.transactions t
set review_reason = 'amortized_expense'
where t.status = 'excluded'
  and coalesce(t.review_reason, '') <> 'amortized_expense'
  and exists (
    select 1
    from public.expenses e
    where e.user_id = t.user_id
      and (
        e.name = concat(t.merchant_name, ' (amort ', t.date::text, ')')
        or e.name like concat(t.merchant_name, ' (amort ', t.date::text, ') #', '%')
      )
  );
