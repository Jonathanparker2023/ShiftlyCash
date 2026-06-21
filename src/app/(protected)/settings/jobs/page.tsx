import { redirect } from "next/navigation";

import { JobsEditor } from "@/components/jobs/JobsEditor";
import { CAPABILITIES } from "@/lib/edition";
import { getJobsData } from "@/lib/jobs/data";

export default async function JobsPage() {
  if (!CAPABILITIES.showCustomJobs) {
    redirect("/");
  }

  const data = await getJobsData();

  return (
    <main className="min-h-screen px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
            ShiftlyCash
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1.5 text-sm text-white/65">
            Create jobs with their own pay rates and colors. They show up in the
            shift and template pickers.
          </p>
        </header>
        <JobsEditor initialData={data} />
      </section>
    </main>
  );
}
