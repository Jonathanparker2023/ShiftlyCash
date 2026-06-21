import { redirect } from "next/navigation";

import { TemplateEditor } from "@/components/template/TemplateEditor";
import { CAPABILITIES } from "@/lib/edition";
import { getTemplateEditorData } from "@/lib/template/data";

export default async function TemplateSettingsPage() {
  if (!CAPABILITIES.showWeeklyTemplate) {
    redirect("/");
  }

  const data = await getTemplateEditorData();
  const editorKey = [
    data.templateId,
    ...data.days.flatMap((day) =>
      day.slots.map(
        (slot) =>
          `${slot.dayIndex}:${slot.slotIndex}:${slot.jobType}:${slot.payType}:${slot.hoursOrUnits}`,
      ),
    ),
  ].join("|");

  return (
    <main className="min-h-screen px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
            ShiftlyCash
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
            Weekly Template
          </h1>
          <p className="mt-1.5 text-sm text-white/65">
            The shifts that autofill into every new week. Edit them like the
            dashboard.
          </p>
        </header>

        <TemplateEditor initialData={data} key={editorKey} />
      </section>
    </main>
  );
}
