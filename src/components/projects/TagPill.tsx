import type { Tag } from "@/lib/projects/types";

export function TagPill({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex max-w-[10rem] items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4"
      style={{
        backgroundColor: `${tag.color}1A`,
        borderColor: `${tag.color}66`,
        color: tag.color,
      }}
      title={tag.name}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
