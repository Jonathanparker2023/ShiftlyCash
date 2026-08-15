-- Raise the per-day shift limit from 4 slots to 7.
--
-- slot_index was bounded to 0..3 in three places that all have to move together:
-- the check constraints on earn_slots, template_slots and sticky_labels, and the
-- validation inside replace_default_template_slots. Miss one and the UI offers a
-- row the database then refuses.
--
-- Widening a check constraint is safe in both directions of data: every existing
-- row is already inside the new range, so the ADD validates without a rewrite.
--
-- NOTE for the app side: slot indexes at or above SYNTHETIC_SLOT_BASE (1000) are
-- synthetic read-only Amortized Income rows and are never persisted here. That
-- sentinel used to be 4 -- "one past the last real slot" -- which this change
-- would have collided with, so it was moved out of range in the same commit.

alter table public.earn_slots
  drop constraint if exists earn_slots_valid_slot;
alter table public.earn_slots
  add constraint earn_slots_valid_slot check (slot_index between 0 and 6);

alter table public.template_slots
  drop constraint if exists template_slots_valid_slot;
alter table public.template_slots
  add constraint template_slots_valid_slot check (slot_index between 0 and 6);

alter table public.sticky_labels
  drop constraint if exists sticky_labels_valid_slot;
alter table public.sticky_labels
  add constraint sticky_labels_valid_slot check (slot_index between 0 and 6);

-- replace_default_template_slots carries the same bound in its validation block.
-- Rather than paste an 89-line function body in here -- which would silently
-- freeze whatever else has changed in it since -- read the live definition,
-- rewrite the one bound, and put it back. If the expected text is not found the
-- migration fails loudly instead of leaving a half-raised limit.
do $$
declare
  v_src text;
  v_old constant text := 'slot_index not between 0 and 3';
  v_new constant text := 'slot_index not between 0 and 6';
begin
  select pg_get_functiondef(p.oid)
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'replace_default_template_slots';

  if v_src is null then
    raise exception 'replace_default_template_slots not found; cannot raise the slot bound.';
  end if;

  if position(v_old in v_src) = 0 then
    if position(v_new in v_src) > 0 then
      raise notice 'Slot bound already raised to 6; nothing to do.';
      return;
    end if;
    raise exception 'Expected slot bound % not found in replace_default_template_slots.', v_old;
  end if;

  execute replace(v_src, v_old, v_new);
end;
$$;
