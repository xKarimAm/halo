import type { MeetingContext } from "../../../contracts/ext/gen/types";

/** One participant row in the popup form. Empty role means "no role yet". */
export interface RoleRow {
  name: string;
  role: string;
}

/** Raw popup form state. Agenda is free text, one item per line. */
export interface SetupForm {
  subject: string;
  agendaText: string;
  rows: RoleRow[];
  viewerLang: "en" | "ar";
  projectId: string;
}

/** Split the agenda textarea into items: one per line, trimmed, empties dropped. */
export function parseAgenda(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Build the contract `meeting.context` payload from the popup form.
 * Rows with a blank name are dropped; a blank role is omitted (not sent as "");
 * a blank project is omitted (project_id stays optional).
 */
export function buildMeetingContext(form: SetupForm): MeetingContext {
  const roles = form.rows
    .map((row) => ({ name: row.name.trim(), role: row.role.trim() }))
    .filter((row) => row.name.length > 0)
    .map((row) =>
      row.role.length > 0 ? { name: row.name, role: row.role } : { name: row.name },
    );
  const context: MeetingContext = {
    subject: form.subject.trim(),
    agenda: parseAgenda(form.agendaText),
    roles,
    viewer_lang: form.viewerLang,
  };
  const projectId = form.projectId.trim();
  if (projectId.length > 0) {
    context.project_id = projectId;
  }
  return context;
}

/**
 * Merge adapter tile names into the role rows for prefill.
 * Existing rows are kept as-is (names typed before anyone joins survive and
 * match by exact name); one blank-role row is appended per unseen tile name.
 * Rows are never removed: a tile that left keeps its row.
 */
export function mergeTileNames(rows: RoleRow[], tileNames: string[]): RoleRow[] {
  const known = new Set(rows.map((row) => row.name));
  const merged = rows.map((row) => ({ ...row }));
  for (const name of tileNames) {
    if (!known.has(name)) {
      known.add(name);
      merged.push({ name, role: "" });
    }
  }
  return merged;
}
