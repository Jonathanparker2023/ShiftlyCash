/**
 * How many editable shift slots a single day can hold.
 *
 * Raised from 4 to 7 so a day can carry a full split-shift schedule. The value
 * is mirrored by check constraints on earn_slots, template_slots and
 * sticky_labels, and by the slot_index validation inside
 * replace_default_template_slots -- raise those together or the UI will offer
 * rows the database refuses.
 */
export const MAX_SHIFT_SLOTS = 7;

/**
 * Slot index where synthetic, read-only rows begin (Amortized Income daily
 * credits). These are rendered alongside real slots but are never persisted as
 * earn_slots, so their index only has to avoid colliding with a real one.
 *
 * It used to be 4 -- literally "one past the last real slot" -- which quietly
 * became wrong the moment real slots grew past 4. Parking it far above any
 * plausible slot count keeps the two ranges from ever meeting again.
 */
export const SYNTHETIC_SLOT_BASE = 1000;
