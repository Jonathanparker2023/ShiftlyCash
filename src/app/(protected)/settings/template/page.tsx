import { redirect } from "next/navigation";

import { TemplatesTabs } from "@/components/template/TemplatesTabs";
import { CAPABILITIES } from "@/lib/edition";
import { getJobsData, type JobsData } from "@/lib/jobs/data";
import { getTemplateEditorData } from "@/lib/template/data";

export default async function TemplateSettingsPage() {
  if (!CAPABILITIES.showWeeklyTemplate) {
    redirect("/");
  }

  const data = await getTemplateEditorData();
  const jobsData: JobsData | null = CAPABILITIES.showCustomJobs
    ? await getJobsData()
    : null;
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
            Templates
          </h1>
          <p className="mt-1.5 text-sm text-white/65">
            The shifts that autofill into every new week, and the jobs they use.
          </p>
        </header>

        <TemplatesTabs
          editorKey={editorKey}
          jobsData={jobsData}
          showJobs={CAPABILITIES.showCustomJobs}
          templateData={data}
        />
      </section>
    </main>
  );
}
