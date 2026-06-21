"use client";

import { useState } from "react";

import { JobsEditor } from "@/components/jobs/JobsEditor";
import { TemplateEditor } from "@/components/template/TemplateEditor";
import type { JobsData } from "@/lib/jobs/data";
import type { TemplateEditorData } from "@/lib/template/types";

type Tab = "template" | "jobs";

export function TemplatesTabs({
  templateData,
  jobsData,
  editorKey,
  showJobs,
}: {
  templateData: TemplateEditorData;
  jobsData: JobsData | null;
  editorKey: string;
  showJobs: boolean;
}) {
  const [tab, setTab] = useState<Tab>("template");
  const active = tab === "jobs" && showJobs ? "jobs" : "template";

  return (
    <div className="space-y-5">
      {showJobs ? (
        <div className="inline-flex rounded-xl border border-white/12 bg-white/[0.05] p-1">
          <TabButton active={active === "template"} onClick={() => setTab("template")}>
            Weekly template
          </TabButton>
          <TabButton active={active === "jobs"} onClick={() => setTab("jobs")}>
            Jobs
          </TabButton>
        </div>
      ) : null}

      {active === "jobs" && jobsData ? (
        <JobsEditor initialData={jobsData} />
      ) : (
        <TemplateEditor initialData={templateData} key={editorKey} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={
        active
          ? "h-9 rounded-lg bg-white/15 px-4 text-sm font-semibold text-white"
          : "h-9 rounded-lg px-4 text-sm font-medium text-white/60 transition hover:text-white"
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
