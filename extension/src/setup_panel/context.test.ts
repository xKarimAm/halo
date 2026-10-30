import { describe, expect, it } from "vitest";

import goldenContext from "../../../../../contracts/golden/meeting.context.json";
import {
  buildMeetingContext,
  mergeTileNames,
  parseAgenda,
  type RoleRow,
  type SetupForm,
} from "./context";

const baseForm: SetupForm = {
  subject: "Launch readiness",
  agendaText: "Pricing\nRTL",
  rows: [
    { name: "Layla", role: "Engineering lead" },
    { name: "Omar", role: "" },
  ],
  viewerLang: "en",
  projectId: "halo-q4",
};

describe("parseAgenda", () => {
  it("splits one item per line", () => {
    expect(parseAgenda("Pricing\nRTL")).toEqual(["Pricing", "RTL"]);
  });

  it("trims whitespace and drops empty lines", () => {
    expect(parseAgenda("  Pricing \n\n  \nRTL\n")).toEqual(["Pricing", "RTL"]);
  });

  it("handles CRLF line endings", () => {
    expect(parseAgenda("Pricing\r\nRTL\r\n")).toEqual(["Pricing", "RTL"]);
  });
});

describe("buildMeetingContext", () => {
  it("matches the golden meeting.context shape", () => {
    const ctx = buildMeetingContext(baseForm);
    expect(ctx).toEqual(goldenContext.data);
  });

  it("omits empty roles but keeps the name row", () => {
    const ctx = buildMeetingContext(baseForm);
    expect(ctx.roles).toEqual([{ name: "Layla", role: "Engineering lead" }, { name: "Omar" }]);
  });

  it("drops rows with a blank name", () => {
    const ctx = buildMeetingContext({ ...baseForm, rows: [{ name: "  ", role: "boss" }] });
    expect(ctx.roles).toEqual([]);
  });

  it("omits project_id when the project field is blank", () => {
    const ctx = buildMeetingContext({ ...baseForm, projectId: "   " });
    expect(ctx).not.toHaveProperty("project_id");
  });

  it("accepts the Arabic viewer language", () => {
    const ctx = buildMeetingContext({ ...baseForm, viewerLang: "ar" });
    expect(ctx.viewer_lang).toBe("ar");
  });
});

describe("mergeTileNames", () => {
  it("prefills a row per new tile name", () => {
    const rows: RoleRow[] = [];
    expect(mergeTileNames(rows, ["Layla", "Omar"])).toEqual([
      { name: "Layla", role: "" },
      { name: "Omar", role: "" },
    ]);
  });

  it("keeps free-text rows typed before anyone joins, matched by exact name", () => {
    const rows: RoleRow[] = [{ name: "Layla", role: "Engineering lead" }];
    expect(mergeTileNames(rows, ["Layla", "Omar"])).toEqual([
      { name: "Layla", role: "Engineering lead" },
      { name: "Omar", role: "" },
    ]);
  });

  it("never drops rows when tiles leave", () => {
    const rows: RoleRow[] = [
      { name: "Layla", role: "Engineering lead" },
      { name: "Omar", role: "" },
    ];
    expect(mergeTileNames(rows, ["Layla"])).toEqual(rows);
  });
});
