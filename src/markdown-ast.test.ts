import { describe, expect, it } from "vitest";
import {
  addTimeBlockItem,
  createDailyMarkdownAst,
  parseDailyMarkdown,
  parseTimeBlockHeader,
  removeTimeBlock,
  serializeDailyMarkdown,
  updateTimeBlock,
} from "./markdown";
import { DEFAULT_TIME_BLOCKS } from "./time-blocks";

describe("time block Markdown AST", () => {
  it("parses the time block header and its category metadata", () => {
    expect(parseTimeBlockHeader("### [14:30~15:30] 留白上半场 (属性: 美好瞬间/日常事务)"))
      .toEqual({
        startTime: "14:30",
        endTime: "15:30",
        title: "留白上半场",
        categories: ["美好瞬间", "日常事务"],
      });
  });

  it("round trips blocks, checklist items, and the work cache", () => {
    const source = `# 2026-09-15\n\n### [6:45~8:10] 清晨美好瞬间 (属性: 美好瞬间)\n- [ ] 晨间散步\n- [x] 写日记（用时18分钟完成）\n\n### 工作缓存区\n- [ ] 等待明天补充的数据\n`;
    const document = parseDailyMarkdown({
      date: "2026-09-15",
      path: "2026-09-15(星期二).md",
      content: source,
    });

    expect(document.timeBlocks[0].items).toEqual([
      expect.objectContaining({ text: "晨间散步", done: false }),
      expect.objectContaining({ text: "写日记（用时18分钟完成）", done: true }),
    ]);
    expect(document.workCache[0].text).toBe("等待明天补充的数据");
    expect(serializeDailyMarkdown(document)).toBe(source);
  });

  it("keeps templates independent from daily instances and supports CRUD", () => {
    const document = createDailyMarkdownAst("2026-09-15", DEFAULT_TIME_BLOCKS);
    const updated = updateTimeBlock(document, "morning-joy", {
      title: "改过的今日标题",
    });
    const withItem = addTimeBlockItem(updated, "morning-joy", {
      text: "今日项目",
      done: false,
    });
    const removed = removeTimeBlock(withItem, "morning-joy");

    expect(DEFAULT_TIME_BLOCKS[0].title).toBe("清晨美好瞬间");
    expect(withItem.timeBlocks).toHaveLength(7);
    expect(withItem.timeBlocks.find((block) => block.id === "morning-joy")?.items)
      .toHaveLength(1);
    expect(removed.timeBlocks).toHaveLength(6);
  });
});
