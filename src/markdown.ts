import { Moment, Task, WorkCache } from "./types";

export type DailyMarkdownRecord = {
  date: string;
  content: string;
  path: string;
};
export type ParsedDailyRecords = {
  moments: Moment[];
  tasks: Task[];
  workCache: WorkCache[];
};

export function dateKey(value: string | Date = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function savedAt(value: string) {
  const date = new Date(value);
  return `${dateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sentRecordSuffix(sentTo?: "moment" | "task", sentAt?: string) {
  if (!sentTo || !sentAt) return "";
  return `（已转为${sentTo === "moment" ? "美好瞬间" : "日常事务"}，发送于 ${savedAt(sentAt)}）`;
}

export function dailyFileName(date: string) {
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ];
  return `${date}(星期${weekday}).md`;
}

function checklistText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function formatDailyNote(
  date: string,
  moments: Moment[],
  tasks: Task[],
  workCache: WorkCache[] = [],
) {
  const dayMoments = moments.filter(
    (moment) => dateKey(moment.createdAt) === date,
  );
  const dayTasks = tasks.filter((task) => dateKey(task.createdAt) === date);
  const dayCache = workCache.filter((item) => dateKey(item.createdAt) === date);
  const momentText = dayMoments.length
    ? dayMoments
        .map(
          (moment) =>
          `- [${moment.done ? "x" : " "}] ${checklistText(moment.text)}（保存于 ${savedAt(moment.createdAt)}）${sentRecordSuffix(moment.sentTo, moment.sentAt)}`,
        )
        .join("\n")
    : "- [ ] 尚未记录。";
  const taskText = dayTasks.length
    ? dayTasks
        .map(
          (task) =>
          `- [${task.done ? "x" : " "}] ${checklistText(task.text)}（保存于 ${savedAt(task.createdAt)}）${sentRecordSuffix(task.sentTo, task.sentAt)}`,
        )
        .join("\n")
    : "- [ ] 尚未记录。";
  const cacheText = dayCache.length
    ? dayCache
        .map(
          (item) =>
            `- [${item.done ? "x" : " "}] 已完成：${checklistText(item.completed) || "暂无记录"}；待完成：${checklistText(item.pending) || "暂无记录"}（保存于 ${savedAt(item.createdAt)}）${item.sentTo ? `\n  - 已发送至${item.sentTo === "moment" ? "美好瞬间" : "日常事务"}，发送于 ${savedAt(item.sentAt || item.createdAt)}` : ""}`,
        )
        .join("\n")
    : "- [ ] 尚未记录。";
  return `## 今天，哪一个瞬间让我感到纯粹的充实、专注或者快乐？\n\n${momentText}\n\n## 今天完成了什么日常事务？\n\n${taskText}\n\n## 工作缓存区\n\n${cacheText}\n`;
}

export function parseDailyNote(
  record: DailyMarkdownRecord,
): ParsedDailyRecords {
  const momentSection =
    record.content
      .split("## 今天，哪一个瞬间让我感到纯粹的充实、专注或者快乐？")[1]
      ?.split("## 今天完成了什么日常事务？")[0] || "";
  const taskSection =
    record.content
      .split("## 今天完成了什么日常事务？")[1]
      ?.split("## 工作缓存区")[0] || "";
  const cacheSection = record.content.split("## 工作缓存区")[1] || "";
  const parseItem = (line: string) =>
    line.match(
      /^- \[([ xX])\] (.+?)(?:（保存于 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})）)?(?:（已转为(美好瞬间|日常事务)，发送于 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})）)?$/,
    );
  const createdAt = (value?: string) => {
    const localValue = value || `${record.date} 12:00`;
    const parsed = new Date(`${localValue.replace(" ", "T")}:00`);
    return Number.isNaN(parsed.getTime())
      ? new Date().toISOString()
      : parsed.toISOString();
  };
  const moments = momentSection
    .split("\n")
    .map((line, index) => {
      const match = parseItem(line.trim());
      if (!match || match[2] === "尚未记录。") return null;
      return {
        id: `md-${record.date}-moment-${index}`,
        text: match[2],
        done: match[1].toLowerCase() === "x",
        createdAt: createdAt(match[3]),
        ...(match[4]
          ? {
              sentTo: match[4] === "美好瞬间" ? ("moment" as const) : ("task" as const),
              sentAt: createdAt(match[5]),
            }
          : {}),
      };
    })
    .filter((moment): moment is Moment => moment !== null);
  const tasks = taskSection
    .split("\n")
    .map((line, index) => {
      const match = parseItem(line.trim());
      if (!match || match[2] === "尚未记录。") return null;
      return {
        id: `md-${record.date}-task-${index}`,
        text: match[2],
        done: match[1].toLowerCase() === "x",
        createdAt: createdAt(match[3]),
        ...(match[4]
          ? {
              sentTo: match[4] === "美好瞬间" ? ("moment" as const) : ("task" as const),
              sentAt: createdAt(match[5]),
            }
          : {}),
      };
    })
    .filter((task): task is Task => task !== null);
  const workCache = cacheSection
    .split("\n")
    .map((line, index, lines) => {
      const match = parseItem(line.trim());
      if (!match || !match[2].startsWith("已完成：")) return null;
      const content = match[2].replace(/（保存于 .*$/, "");
      const separator = content.indexOf("；待完成：");
      const sentLine = lines[index + 1]?.trim() || "";
      const sent = sentLine.match(
        /^[- ]+已发送至(美好瞬间|日常事务)，发送于 (.+)$/,
      );
      return {
        id: `md-${record.date}-cache-${index}`,
        completed: content.slice(4, separator),
        pending: content.slice(separator + 5),
        done: match[1].toLowerCase() === "x",
        createdAt: createdAt(match[3]),
        ...(sent
          ? {
              sentTo:
                sent[1] === "美好瞬间"
                  ? ("moment" as const)
                  : ("task" as const),
              sentAt: createdAt(sent[2]),
            }
          : {}),
      };
    })
    .filter((item): item is WorkCache => item !== null);
  return { moments, tasks, workCache };
}

export function mergeParsedRecords(
  records: DailyMarkdownRecord[],
): ParsedDailyRecords {
  return records.reduce<ParsedDailyRecords>(
    (all, record) => {
      const parsed = parseDailyNote(record);
      return {
        moments: [...all.moments, ...parsed.moments],
        tasks: [...all.tasks, ...parsed.tasks],
        workCache: [...all.workCache, ...parsed.workCache],
      };
    },
    { moments: [], tasks: [], workCache: [] },
  );
}
