-- Backfill: Chime push captures from today's testing were inserted with
-- status='pending_review' and day_id=null. The ingest endpoint now resolves
-- the day_id from the transaction date and writes status='applied' when a
-- matching unlocked day exists. Mirror that here for the existing rows.

update public.transactions t
   set status = 'applied',
       review_reason = null,
       day_id = d.id,
       updated_at = now()
  from public.days d
 where t.source = 'chime'
   and t.status = 'pending_review'
   and d.user_id = t.user_id
   and d.date = t.date
   and d.spend_locked = false;
