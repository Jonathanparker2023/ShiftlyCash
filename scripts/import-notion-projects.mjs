#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IMPORT_DIR = path.resolve(
  process.cwd(),
  "..",
  "shiftlycash-emergency-backups",
  "notion-import",
);

const PROJECT_STATUS_COLORS = {
  doing: "#22c55e",
  ongoing: "#f97316",
  planned: "#3b82f6",
  "on hold": "#ef4444",
  done: "#a855f7",
};

main().catch((error) => {
  console.error(`\nNotion import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(".env.local");
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.apply && args.dryRun) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

  const importDir = path.resolve(args.importDir ?? DEFAULT_IMPORT_DIR);
  const projectsPath = path.resolve(args.projects ?? path.join(importDir, "projects.csv"));
  const tasksPath = path.resolve(args.tasks ?? path.join(importDir, "tasks.csv"));
  const mode = args.apply ? "apply" : "dry-run";

  if (!existsSync(projectsPath)) {
    throw new Error(`Missing projects CSV: ${projectsPath}`);
  }
  if (!existsSync(tasksPath)) {
    throw new Error(`Missing tasks CSV: ${tasksPath}`);
  }
  if (args.apply && !args.userEmail && !args.userId) {
    throw new Error("--apply requires --user-email or --user-id so rows attach to the right user.");
  }

  const parsed = loadAndNormalize({ projectsPath, tasksPath });
  const report = buildReport(parsed, {
    mode,
    projectsPath,
    tasksPath,
  });

  if (mode === "dry-run") {
    printReport(report);
    await writeReport(report, args.reportPath);
    return;
  }

  const supabase = createServiceClient();
  const userId = await resolveUserId(supabase, args);
  const appliedReport = await applyImport(supabase, userId, parsed, report);
  printReport(appliedReport);
  await writeReport(appliedReport, args.reportPath);
}

function printHelp() {
  console.log(`
Usage:
  npm run import:notion-projects -- --dry-run
  npm run import:notion-projects -- --apply --user-email you@example.com

Defaults:
  projects CSV: ../shiftlycash-emergency-backups/notion-import/projects.csv
  tasks CSV:    ../shiftlycash-emergency-backups/notion-import/tasks.csv

Required for --apply:
  SUPABASE_SERVICE_ROLE_KEY in .env.local or shell env
  NEXT_PUBLIC_SUPABASE_URL in .env.local or shell env
  --user-email or --user-id

Options:
  --import-dir <path>       Folder containing projects.csv and tasks.csv
  --projects <path>         Override projects CSV path
  --tasks <path>            Override tasks CSV path
  --dry-run                 Default; no Supabase writes
  --apply                   Write to Supabase
  --user-email <email>      Supabase auth user email for imported rows
  --user-id <uuid>          Supabase auth user id for imported rows
  --report <path>           Write JSON report to this path
`);
}

function parseArgs(argv) {
  const args = { dryRun: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === "--import-dir") {
      args.importDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--projects") {
      args.projects = requireValue(arg, next);
      index += 1;
    } else if (arg === "--tasks") {
      args.tasks = requireValue(arg, next);
      index += 1;
    } else if (arg === "--user-email") {
      args.userEmail = requireValue(arg, next).trim().toLowerCase();
      index += 1;
    } else if (arg === "--user-id") {
      args.userId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--report") {
      args.reportPath = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function loadAndNormalize({ projectsPath, tasksPath }) {
  const projectRows = parseCsvFile(projectsPath);
  const taskRows = parseCsvFile(tasksPath);
  const warnings = [];
  const projects = normalizeProjects(projectRows, warnings);
  const tasks = normalizeTasks(taskRows, projects, warnings);

  return { projects, tasks, warnings };
}

function parseCsvFile(filePath) {
  const raw = stripBom(readFileSync(filePath, "utf8"));
  const rows = parseCsv(raw);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const record = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = (row[index] ?? "").trim();
    }
    return record;
  });
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeProjects(rows, warnings) {
  const projects = [];
  const seen = new Set();

  for (const row of rows) {
    const name = readField(row, ["Name"]);
    if (!name) {
      warnings.push("Skipped a project row without a Name.");
      continue;
    }

    const key = normalizeKey(name);
    if (seen.has(key)) {
      warnings.push(`Skipped duplicate project in CSV: ${name}`);
      continue;
    }
    seen.add(key);

    const notionStatus = readField(row, ["Status"]) || "Planned";
    const archived = parseBoolean(readField(row, ["Archived"]));
    projects.push({
      name,
      description: "",
      color: PROJECT_STATUS_COLORS[normalizeKey(notionStatus)] ?? "#3b82f6",
      status: archived || normalizeKey(notionStatus) === "done" ? "archived" : "active",
      deadline: null,
      sourceStatus: notionStatus,
    });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects.map((project, index) => ({
    ...project,
    sortOrder: (index + 1) * 10,
  }));
}

function normalizeTasks(rows, projects, warnings) {
  const tasks = [];
  const projectKeys = new Map(projects.map((project) => [normalizeKey(project.name), project]));
  const seen = new Set();

  for (const row of rows) {
    const title = readField(row, ["Name"]);
    if (!title) {
      warnings.push("Skipped a task row without a Name.");
      continue;
    }

    const projectField = readField(row, [
      "Project",
      "Projects",
      "Project relation",
      "Projects relation",
    ]);
    if (!projectField) {
      warnings.push(`Skipped inbox task without a project: ${title}`);
      continue;
    }

    const projectNames = splitRelationNames(projectField);
    const matchedProject = projectNames
      .map((projectName) => projectKeys.get(normalizeKey(projectName)))
      .find(Boolean);

    if (!matchedProject) {
      warnings.push(`Skipped task with no matching project: ${title} -> ${projectField}`);
      continue;
    }
    if (projectNames.length > 1) {
      warnings.push(`Task has multiple projects; using first match: ${title} -> ${matchedProject.name}`);
    }

    const dedupeKey = `${normalizeKey(matchedProject.name)}::${normalizeKey(title)}`;
    if (seen.has(dedupeKey)) {
      warnings.push(`Skipped duplicate task in CSV: ${matchedProject.name} / ${title}`);
      continue;
    }
    seen.add(dedupeKey);

    tasks.push({
      projectName: matchedProject.name,
      title,
      description: readField(row, ["Description"]) || null,
      dueDate: normalizeDate(readField(row, ["Due", "Due date", "Due Date"])),
      status: mapTaskStatus(readField(row, ["Status"])),
    });
  }

  const perProjectCount = new Map();
  return tasks.map((task) => {
    const count = (perProjectCount.get(task.projectName) ?? 0) + 1;
    perProjectCount.set(task.projectName, count);
    return {
      ...task,
      sortOrder: count * 10,
      completedAt: task.status === "done" ? new Date().toISOString() : null,
    };
  });
}

function splitRelationNames(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readField(row, candidates) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value.trim()]),
  );

  for (const candidate of candidates) {
    const value = normalized.get(normalizeHeader(candidate));
    if (value) return value.trim();
  }

  return "";
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeKey(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseBoolean(value) {
  const normalized = normalizeKey(value);
  return normalized === "yes" || normalized === "true" || normalized === "checked" || normalized === "1";
}

function normalizeDate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const isoDate = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function mapTaskStatus(value) {
  const normalized = normalizeKey(value);
  if (normalized === "done") return "done";
  if (normalized === "doing" || normalized === "in progress") return "in_progress";
  return "todo";
}

function buildReport(parsed, metadata) {
  return {
    source: "notion-csv",
    mode: metadata.mode,
    projectsPath: metadata.projectsPath,
    tasksPath: metadata.tasksPath,
    counts: {
      projects: parsed.projects.length,
      tasks: parsed.tasks.length,
      warnings: parsed.warnings.length,
    },
    warnings: parsed.warnings,
    preview: {
      projects: parsed.projects.slice(0, 10),
      tasks: parsed.tasks.slice(0, 20),
    },
    apply: {
      wroteToSupabase: false,
      inserted: { projects: 0, tasks: 0 },
      skippedExisting: { projects: 0, tasks: 0 },
    },
  };
}

async function applyImport(supabase, userId, parsed, report) {
  const existingProjects = await fetchExistingProjects(supabase, userId);
  const projectIdByName = new Map();
  const inserted = { projects: 0, tasks: 0 };
  const skippedExisting = { projects: 0, tasks: 0 };

  for (const project of parsed.projects) {
    const key = normalizeKey(project.name);
    const existing = existingProjects.get(key);
    if (existing) {
      projectIdByName.set(key, existing.id);
      skippedExisting.projects += 1;
      continue;
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: project.name,
        description: project.description,
        color: project.color,
        status: project.status,
        sort_order: project.sortOrder,
        deadline: project.deadline,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Unable to insert project "${project.name}": ${error.message}`);

    projectIdByName.set(key, data.id);
    inserted.projects += 1;
  }

  const existingTasks = await fetchExistingTasks(supabase, userId);
  for (const task of parsed.tasks) {
    const projectId = projectIdByName.get(normalizeKey(task.projectName));
    if (!projectId) {
      report.warnings.push(`Skipped task because project was unavailable at apply time: ${task.title}`);
      continue;
    }

    const taskKey = `${projectId}::${normalizeKey(task.title)}`;
    if (existingTasks.has(taskKey)) {
      skippedExisting.tasks += 1;
      continue;
    }

    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      project_id: projectId,
      title: task.title,
      description: task.description,
      due_date: task.dueDate,
      status: task.status,
      sort_order: task.sortOrder,
      completed_at: task.completedAt,
    });

    if (error) throw new Error(`Unable to insert task "${task.title}": ${error.message}`);

    existingTasks.add(taskKey);
    inserted.tasks += 1;
  }

  return {
    ...report,
    counts: {
      ...report.counts,
      warnings: report.warnings.length,
    },
    apply: {
      wroteToSupabase: true,
      inserted,
      skippedExisting,
    },
  };
}

async function fetchExistingProjects(supabase, userId) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,name")
    .eq("user_id", userId);

  if (error) throw new Error(`Unable to read existing projects: ${error.message}`);

  return new Map((data ?? []).map((row) => [normalizeKey(row.name), row]));
}

async function fetchExistingTasks(supabase, userId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("project_id,title")
    .eq("user_id", userId);

  if (error) throw new Error(`Unable to read existing tasks: ${error.message}`);

  return new Set((data ?? []).map((row) => `${row.project_id}::${normalizeKey(row.title)}`));
}

async function resolveUserId(supabase, args) {
  if (args.userId) return args.userId;

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(`Unable to list Supabase users: ${error.message}`);
  }

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === args.userEmail);
  if (!user) {
    throw new Error(`No Supabase auth user found for ${args.userEmail}.`);
  }

  return user.id;
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Add it only locally; never expose it to the browser.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function writeReport(report, reportPath) {
  if (!reportPath) return;
  await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
}

function printReport(report) {
  console.log(`Mode: ${report.mode}`);
  console.log(`Projects: ${report.counts.projects}`);
  console.log(`Tasks: ${report.counts.tasks}`);
  console.log(`Warnings: ${report.counts.warnings}`);
  if (report.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of report.warnings.slice(0, 50)) {
      console.log(`- ${warning}`);
    }
    if (report.warnings.length > 50) {
      console.log(`- ...and ${report.warnings.length - 50} more`);
    }
  }
  if (report.apply.wroteToSupabase) {
    console.log(`\nInserted: ${JSON.stringify(report.apply.inserted)}`);
    console.log(`Skipped existing: ${JSON.stringify(report.apply.skippedExisting)}`);
  }
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) return;

      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    });
  } catch {
    // .env.local is optional for dry-run.
  }
}
