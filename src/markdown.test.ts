import { describe, expect, it } from "vitest";
import { dailyFileName, formatDailyNote, parseDailyNote } from "./markdown";

describe("daily Markdown vault format", () => {
  it("uses the weekday in the daily filename", () => {
    expect(dailyFileName("2026-09-13")).toBe("2026-09-13(星期日).md");
  });

  it("writes the two Obsidian sections and task checkboxes", () => {
    const markdown = formatDailyNote(
      "2026-09-13",
      [
        {
          id: "m1",
          text: "完成了一次深度工作",
          done: false,
          createdAt: "2026-09-13T08:00:00.000Z",
        },
      ],
      [
        {
          id: "t1",
          text: "整理邮件",
          done: true,
          createdAt: "2026-09-13T09:00:00.000Z",
        },
      ],
      [
        {
          id: "c1",
          completed: "写完方案",
          pending: "补充数据",
          done: false,
          createdAt: "2026-09-13T10:00:00.000Z",
        },
      ],
    );
    expect(markdown).not.toContain("# 2026-09-13(星期日)");
    expect(markdown).not.toContain("date: 2026-09-13");
    expect(markdown).toContain(
      "## 今天，哪一个瞬间让我感到纯粹的充实、专注或者快乐？",
    );
    expect(markdown).toContain("## 今天完成了什么日常事务？");
    expect(markdown).toContain("- [x] 整理邮件");
    expect(markdown).toContain("## 工作缓存区");
    expect(markdown).toContain("补充数据");
  });

  it("reads moments and task status back from Markdown", () => {
    const parsed = parseDailyNote({
      date: "2026-09-13",
      path: "2026-09-13.md",
      content: formatDailyNote(
        "2026-09-13",
        [
          {
            id: "m1",
            text: "散步后很清醒",
            done: true,
            createdAt: "2026-09-13T08:00:00.000Z",
          },
        ],
        [
          {
            id: "t1",
            text: "散步",
            done: false,
            createdAt: "2026-09-13T09:00:00.000Z",
          },
        ],
        [
          {
            id: "c1",
            completed: "整理资料",
            pending: "联系客户",
            done: true,
            sentTo: "task",
            sentAt: "2026-09-13T11:00:00.000Z",
            createdAt: "2026-09-13T10:00:00.000Z",
          },
        ],
      ),
    });
    expect(parsed.moments[0].done).toBe(true);
    expect(parsed.tasks[0].done).toBe(false);
    expect(parsed.workCache[0].pending).toBe("联系客户");
    expect(parsed.workCache[0].sentTo).toBe("task");
  });
});
