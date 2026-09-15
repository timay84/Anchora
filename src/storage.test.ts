import { beforeEach, describe, expect, it } from "vitest";
import { defaultData } from "./types";
import { loadData, saveData } from "./storage";

describe("Anchora local persistence", () => {
  beforeEach(() => localStorage.clear());

  it("returns safe defaults when no draft exists", () => {
    expect(loadData()).toEqual(defaultData);
    expect(loadData().workCache).toEqual([]);
  });

  it("round-trips draft and settings without losing other defaults", () => {
    saveData({
      ...defaultData,
      draft: "一个值得记住的瞬间",
      workCache: [
        {
          id: "c1",
          completed: "已完成",
          pending: "待继续",
          done: false,
          createdAt: "2026-09-13T09:00:00.000Z",
        },
      ],
      settings: { ...defaultData.settings, focusMinutes: 35 },
    });
    const result = loadData();
    expect(result.draft).toBe("一个值得记住的瞬间");
    expect(result.settings.focusMinutes).toBe(35);
    expect(result.settings.sound).toBe(true);
    expect(result.workCache[0].pending).toBe("待继续");
  });

  it("recovers from malformed local data", () => {
    localStorage.setItem("anchora:data:v1", "{bad json");
    expect(loadData()).toEqual(defaultData);
  });

  it("preserves an active focus session for recovery", () => {
    saveData({
      ...defaultData,
      focusSession: {
        projectId: "legacy-focus",
        phase: "locked",
        startedAt: "2026-09-13T09:00:00.000Z",
        endsAt: "2026-09-13T09:03:00.000Z",
      },
    });
    expect(loadData().focusSession?.phase).toBe("locked");
    expect(loadData().focusSession?.endsAt).toBe("2026-09-13T09:03:00.000Z");
  });
});
