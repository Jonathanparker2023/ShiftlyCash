import { TemplateEditor } from "@/components/template/TemplateEditor";
import { getTemplateEditorData } from "@/lib/template/data";

export default async function TemplateSettingsPage() {
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
    <main className="min-h-screen bg-zinc-50 px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-5 border-b border-zinc-200 pb-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
              ShiftlyCash
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Default Template
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              V1 schedule editor for the template used to prefill new weeks.
            </p>
          </div>
        </header>

        <TemplateEditor initialData={data} key={editorKey} />
      </section>
    </main>
  );
}
