import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Check,
  Clock3,
  History,
  Leaf,
  Menu,
  Plus,
  Send,
  Settings,
  Sparkles,
  SquareCheckBig,
  Trash2,
} from "lucide-react";
import { AppData, FocusPhase, Moment, RecordStatus, Task, WorkCache } from "./types";
import {
  createDailyMarkdownAst,
  dateKey,
  DailyMarkdownRecord,
  formatDailyNote,
  mergeParsedRecords,
  parseDailyMarkdown,
  serializeDailyMarkdown,
} from "./markdown";
import { loadData, saveData } from "./storage";
import { DEFAULT_TIME_BLOCKS } from "./time-blocks";

type Page = "today" | "history" | "settings";
type SendTarget = "moment" | "task";
type ReflectionCompleted = { completed: string; pending: string };
type SendableRecord = Moment | Task;
type SelectedRecord = { item: SendableRecord; source: SendTarget };
type NewRecordKind = "moment" | "task" | "cache";
type EditSelection =
  | { kind: "moment"; item: Moment }
  | { kind: "task"; item: Task }
  | { kind: "cache"; item: WorkCache };

function localDateTimeIso(date: string, source = new Date()) {
  const time = `${String(source.getHours()).padStart(2, "0")}:${String(
    source.getMinutes(),
  ).padStart(2, "0")}:${String(source.getSeconds()).padStart(2, "0")}`;
  return new Date(`${date}T${time}`).toISOString();
}

function sentStatus(target?: SendTarget, sentAt?: string) {
  if (!target || !sentAt) return "已发送";
  return `已转为${target === "moment" ? "美好瞬间" : "日常事务"}，发送于 ${new Date(sentAt).toLocaleString("zh-CN")}`;
}

function defaultTimeBlocks(date: string) {
  return createDailyMarkdownAst(date, DEFAULT_TIME_BLOCKS).timeBlocks;
}

function recordsFromTimeBlocks(date: string, blocks: AppData["timeBlocks"]) {
  const moments: Moment[] = [];
  const tasks: Task[] = [];
  blocks.forEach((block) => {
    const defaultKind: "moment" | "task" = block.categories.includes("美好瞬间")
      ? "moment"
      : "task";
    block.items.forEach((item) => {
      const kind = item.kind || defaultKind;
      const record = {
        id: item.id,
        text: item.text,
        done: item.done,
        status: "Idle" as const,
        timeBlockId: block.id,
        createdAt: new Date(`${date}T12:00:00`).toISOString(),
      };
      if (kind === "moment") moments.push(record);
      else tasks.push(record);
    });
  });
  return { moments, tasks };
}

function mergeRecordsIntoTimeBlocks(
  date: string,
  blocks: AppData["timeBlocks"],
  moments: Moment[],
  tasks: Task[],
) {
  const next = blocks.map((block) => ({ ...block, items: [...block.items] }));
  [...moments.map((item) => ({ ...item, kind: "moment" as const })), ...tasks.map((item) => ({ ...item, kind: "task" as const }))]
    .filter((item) => dateKey(item.createdAt) === date)
    .forEach((record) => {
      if (next.some((block) => block.items.some((item) => item.id === record.id))) return;
      const hour = new Date(record.createdAt).getHours() * 60 + new Date(record.createdAt).getMinutes();
      const target = next.find((block) => {
        const start = Number(block.startTime.slice(0, 2)) * 60 + Number(block.startTime.slice(3));
        const end = Number(block.endTime.slice(0, 2)) * 60 + Number(block.endTime.slice(3));
        return hour >= start && hour < end && block.categories.includes(record.kind === "moment" ? "美好瞬间" : "日常事务");
      }) || next.find((block) => block.categories.includes(record.kind === "moment" ? "美好瞬间" : "日常事务")) || next[0];
      if (target) target.items.push({ id: record.id, text: record.text, done: record.done, kind: record.kind });
    });
  return next;
}

export function App() {
  const isLockOverlay =
    typeof window !== "undefined" &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) &&
    getCurrentWindow().label.startsWith("lock-overlay");
  const isReflectionWindow =
    typeof window !== "undefined" &&
    Boolean(
      (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    ) &&
    getCurrentWindow().label === "reflection";
  if (isLockOverlay) return <div className="lock-overlay-window" aria-label="锁屏遮罩" />;
  if (isReflectionWindow) return <ReflectionWindow />;
  const [data, setData] = useState<AppData>(() => {
    const loaded = loadData();
    if (loaded.timeBlocksDate === dateKey()) return loaded;
    return {
      ...loaded,
      timeBlocks: mergeRecordsIntoTimeBlocks(dateKey(), defaultTimeBlocks(dateKey()), loaded.moments, loaded.tasks),
      timeBlocksDate: dateKey(),
    };
  });
  const [page, setPage] = useState<Page>("today");
  const [taskText, setTaskText] = useState("");
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reflectionDraft, setReflectionDraft] = useState({ completed: "", pending: "" });
  const syncTimer = useRef<number | undefined>(undefined);
  const skipNextVaultRead = useRef(false);
  const update = (patch: Partial<AppData>) =>
    setData((current) => ({ ...current, ...patch }));
  const session = data.focusSession;
  const phase = session?.phase;
  const displayEndsAt =
    session?.phase === "focusing"
      ? Date.parse(session.focusEndsAt || session.endsAt)
      : session?.phase === "paused"
        ? now + (session.pausedRemainingMs || 0)
      : session
        ? Date.parse(
            session.phase === "reflecting"
              ? session.reflectionEndsAt || session.endsAt
              : session.endsAt,
          )
        : 0;
  const remaining = session
    ? session.phase === "paused"
      ? Math.max(0, Math.ceil((session.pausedRemainingMs || 0) / 1000))
      : Math.max(0, Math.ceil((displayEndsAt - now) / 1000))
    : 0;
  const formatTime = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  useEffect(() => saveData(data), [data]);
  useEffect(() => {
    if (!data.settings.vaultPath) return;
    if (skipNextVaultRead.current) {
      skipNextVaultRead.current = false;
      return;
    }
    void invoke<DailyMarkdownRecord[]>("read_daily_notes", {
      vaultPath: data.settings.vaultPath,
    })
      .then((notes) => {
        const currentNote = notes.find((note) => note.date === dateKey());
        const ast = currentNote
          ? parseDailyMarkdown(currentNote)
          : createDailyMarkdownAst(dateKey(), DEFAULT_TIME_BLOCKS);
        const imported = mergeParsedRecords(notes);
        const fromBlocks = recordsFromTimeBlocks(dateKey(), ast.timeBlocks);
        setData((current) => {
          const moments = [
            ...current.moments,
            ...imported.moments,
            ...fromBlocks.moments.filter((item) => !current.moments.some((existing) => existing.id === item.id)),
          ];
          const tasks = [
            ...current.tasks,
            ...imported.tasks,
            ...fromBlocks.tasks.filter((item) => !current.tasks.some((existing) => existing.id === item.id)),
          ];
          return {
            ...current,
            moments,
            tasks,
            timeBlocks: mergeRecordsIntoTimeBlocks(
              dateKey(),
              ast.timeBlocks.length ? ast.timeBlocks : defaultTimeBlocks(dateKey()),
              moments,
              tasks,
            ),
            timeBlocksDate: dateKey(),
          };
        });
      })
      .catch(() => undefined);
  }, [data.settings.vaultPath]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (session?.phase === "locked") {
      void invoke("enter_focus_lock")
        .catch((err) => console.error("Error invoking enter_focus_lock:", err));
    } else if (session?.phase !== "reflecting") {
      void invoke("exit_focus_lock")
        .catch((err) => console.error("Error invoking exit_focus_lock:", err));
    }
  }, [session?.phase]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen("emergency_exit", () => {
      if (disposed) return;
      setData((current) => ({ ...current, focusSession: null }));
      void invoke("exit_focus_lock").catch(() => undefined);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (!session || session.phase === "paused" || now < Date.parse(session.endsAt)) return;
    if (session.phase === "focusing") {
      const endsAt = new Date(Date.now() + data.settings.reflectionMinutes * 60_000).toISOString();
      setReflectionDraft({ completed: "", pending: "" });
      setData((current) =>
        current.focusSession
          ? {
              ...current,
              focusSession: {
                ...current.focusSession,
                phase: "reflecting",
                endsAt,
                reflectionStartsAt: new Date().toISOString(),
                reflectionEndsAt: endsAt,
              },
            }
          : current,
      );
    } else if (session.phase === "locked") {
      update({ focusSession: null });
      void invoke("exit_focus_lock").catch(() => undefined);
    }
  }, [now, session]);

  const syncDates = (vaultPath: string, next: AppData, dates: string[]) => {
    if (!vaultPath) return;
    [...new Set(dates)].forEach(
      (date) =>
        void invoke("write_daily_note", {
          vaultPath,
          date,
          content:
            date === next.timeBlocksDate
              ? serializeDailyMarkdown({
                  date,
                  preamble: "",
                  timeBlocks: next.timeBlocks,
                  workCache: next.workCache.map((item) => ({
                    id: item.id,
                    text: `已完成：${item.completed || "暂无记录"}；待完成：${item.pending || "暂无记录"}`,
                    done: item.done,
                  })),
                })
              : formatDailyNote(date, next.moments, next.tasks, next.workCache),
        }).catch(() => undefined),
    );
  };
  const queueSync = (next: AppData, dates: string[]) => {
    if (!next.settings.vaultPath) return;
    if (syncTimer.current !== undefined) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncDates(next.settings.vaultPath, next, dates);
      syncTimer.current = undefined;
    }, 250);
  };
  const replaceData = (next: AppData, dates = [dateKey()]) => {
    setData(next);
    queueSync(next, dates);
  };
  const addMoment = () => {
    if (!data.draft.trim()) return;
    replaceData({
      ...data,
      moments: [
        {
          id: crypto.randomUUID(),
          text: data.draft.trim(),
          done: false,
          status: "Idle",
          createdAt: new Date().toISOString(),
        },
        ...data.moments,
      ],
      draft: "",
    });
  };
  const addTask = () => {
    if (!taskText.trim()) return;
    replaceData({
      ...data,
      tasks: [
        {
          id: crypto.randomUUID(),
          text: taskText.trim(),
          done: false,
          status: "Idle",
          createdAt: new Date().toISOString(),
        },
        ...data.tasks,
      ],
    });
    setTaskText("");
  };
  const changeMoment = (id: string, patch: Partial<Moment>) =>
    replaceData({
      ...data,
      moments: data.moments.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const changeTask = (id: string, patch: Partial<Task>) =>
    replaceData({
      ...data,
      tasks: data.tasks.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const addTimeBlockItem = (blockId: string, text: string, kind: "moment" | "task") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const block = data.timeBlocks.find((item) => item.id === blockId);
    if (!block) return;
    const id = crypto.randomUUID();
    const item = { id, text: trimmed, done: false, kind };
    const record = { id, text: trimmed, done: false, status: "Idle" as const, timeBlockId: blockId, createdAt: new Date().toISOString() };
    replaceData({
      ...data,
      timeBlocks: data.timeBlocks.map((current) => current.id === blockId ? { ...current, items: [...current.items, item] } : current),
      moments: kind === "moment" ? [record, ...data.moments] : data.moments,
      tasks: kind === "task" ? [record, ...data.tasks] : data.tasks,
    });
  };
  const toggleTimeBlockItem = (blockId: string, itemId: string) => {
    const block = data.timeBlocks.find((item) => item.id === blockId);
    const item = block?.items.find((candidate) => candidate.id === itemId);
    const record = [...data.moments, ...data.tasks].find((candidate) => candidate.id === itemId);
    if (!item || !record || record.status && record.status !== "Idle") return;
    const done = !item.done;
    replaceData({
      ...data,
      timeBlocks: data.timeBlocks.map((current) => current.id === blockId ? { ...current, items: current.items.map((candidate) => candidate.id === itemId ? { ...candidate, done } : candidate) } : current),
      moments: data.moments.map((candidate) => candidate.id === itemId ? { ...candidate, done } : candidate),
      tasks: data.tasks.map((candidate) => candidate.id === itemId ? { ...candidate, done } : candidate),
    });
  };
  const deleteTimeBlockItem = (blockId: string, itemId: string) => {
    replaceData({
      ...data,
      timeBlocks: data.timeBlocks.map((block) => block.id === blockId ? { ...block, items: block.items.filter((item) => item.id !== itemId) } : block),
      moments: data.moments.filter((item) => item.id !== itemId),
      tasks: data.tasks.filter((item) => item.id !== itemId),
    });
  };
  const moveTimeBlockItem = (itemId: string, targetBlockId: string, targetIndex?: number) => {
    const source = data.timeBlocks.find((block) => block.items.some((item) => item.id === itemId));
    const item = source?.items.find((candidate) => candidate.id === itemId);
    const record = [...data.moments, ...data.tasks].find((candidate) => candidate.id === itemId);
    if (!source || !item || !record || (record.status && record.status !== "Idle")) return;
    const target = data.timeBlocks.find((block) => block.id === targetBlockId);
    if (!target) return;
    const nextBlocks = data.timeBlocks.map((block) => ({ ...block, items: block.items.filter((candidate) => candidate.id !== itemId) }));
    const targetItems = nextBlocks.find((block) => block.id === targetBlockId)?.items || [];
    const insertAt = targetIndex === undefined ? targetItems.length : Math.max(0, Math.min(targetIndex, targetItems.length));
    targetItems.splice(insertAt, 0, item);
    replaceData({
      ...data,
      timeBlocks: nextBlocks,
      moments: data.moments.map((candidate) => candidate.id === itemId ? { ...candidate, timeBlockId: targetBlockId } : candidate),
      tasks: data.tasks.map((candidate) => candidate.id === itemId ? { ...candidate, timeBlockId: targetBlockId } : candidate),
    });
  };
  const deleteMoment = (id: string) => {
    const item = data.moments.find((moment) => moment.id === id);
    if (!item) return;
    replaceData(
      {
        ...data,
        moments: data.moments.filter((moment) => moment.id !== id),
      },
      [dateKey(item.createdAt)],
    );
  };
  const deleteTask = (id: string) => {
    const item = data.tasks.find((task) => task.id === id);
    if (!item) return;
    replaceData(
      {
        ...data,
        tasks: data.tasks.filter((task) => task.id !== id),
      },
      [dateKey(item.createdAt)],
    );
  };
  const deleteCache = (id: string) => {
    const item = data.workCache.find((cache) => cache.id === id);
    if (!item) return;
    replaceData(
      {
        ...data,
        workCache: data.workCache.filter((cache) => cache.id !== id),
      },
      [dateKey(item.createdAt)],
    );
  };
  const changeCache = (id: string, patch: Partial<WorkCache>) =>
    replaceData({
      ...data,
      workCache: data.workCache.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const sendCache = (
    item: WorkCache,
    target: SendTarget,
    targetDate: string,
  ) => {
    if (item.sentTo) return;
    const sentDate = new Date();
    const sentAt = sentDate.toISOString();
    const localTime = `${String(sentDate.getHours()).padStart(2, "0")}:${String(sentDate.getMinutes()).padStart(2, "0")}:${String(sentDate.getSeconds()).padStart(2, "0")}`;
    const createdAt = new Date(`${targetDate}T${localTime}`).toISOString();
    const text = `已完成：${item.completed || "暂无记录"}；待完成：${item.pending || "暂无记录"}`;
    const next = {
      ...data,
      moments:
        target === "moment"
          ? [
              {
                id: crypto.randomUUID(),
                text,
                done: false,
                status: "Idle" as const,
                createdAt,
              },
              ...data.moments,
            ]
          : data.moments,
      tasks:
        target === "task"
          ? [
              { id: crypto.randomUUID(), text, done: false, status: "Idle" as const, createdAt },
              ...data.tasks,
            ]
          : data.tasks,
      workCache: data.workCache.map((cache) =>
        cache.id === item.id
          ? { ...cache, done: true, sentTo: target, sentAt }
          : cache,
      ),
    };
    replaceData(next, [dateKey(item.createdAt), targetDate]);
  };
  const sendRecord = (
    item: SendableRecord,
    source: SendTarget,
    target: SendTarget,
    targetDate: string,
  ) => {
    if (item.sentTo) return;
    const sentAt = new Date().toISOString();
    const createdAt = localDateTimeIso(targetDate);
    const forwardedText = `${item.text}（未完成。已转为${target === "moment" ? "美好瞬间" : "日常事务"}，发送于 ${new Date(sentAt).toLocaleString("zh-CN")}）`;
    const copiedItem = {
      id: crypto.randomUUID(),
      text: item.text,
      done: false,
      status: "Idle" as const,
      createdAt,
    };
    const moments =
      source === "moment"
        ? data.moments.map((record) =>
            record.id === item.id
              ? { ...record, text: forwardedText, done: true, sentTo: target, sentAt, status: "Idle" as const }
              : record,
          )
        : data.moments;
    const tasks =
      source === "task"
        ? data.tasks.map((record) =>
            record.id === item.id
              ? { ...record, text: forwardedText, done: true, sentTo: target, sentAt, status: "Idle" as const }
              : record,
          )
        : data.tasks;
    const next = {
      ...data,
      moments:
        target === "moment"
          ? [copiedItem, ...moments]
          : moments,
      tasks:
        target === "task"
          ? [copiedItem, ...tasks]
          : tasks,
      timeBlocks: data.timeBlocks.map((block) => ({
        ...block,
        items: block.items.map((blockItem) => blockItem.id === item.id
          ? { ...blockItem, text: forwardedText, done: true }
          : blockItem),
      })),
    };
    replaceData(next, [dateKey(item.createdAt), targetDate]);
  };
  const addTimelineRecord = (
    kind: NewRecordKind,
    targetDate: string,
    text: string,
    pending = "",
  ) => {
    const createdAt = localDateTimeIso(targetDate);
    const next = {
      ...data,
      moments:
        kind === "moment"
           ? [{ id: crypto.randomUUID(), text, done: false, status: "Idle" as const, createdAt }, ...data.moments]
          : data.moments,
      tasks:
        kind === "task"
           ? [{ id: crypto.randomUUID(), text, done: false, status: "Idle" as const, createdAt }, ...data.tasks]
          : data.tasks,
      workCache:
        kind === "cache"
          ? [
              {
                id: crypto.randomUUID(),
                completed: text,
                pending,
                done: false,
                createdAt,
              },
              ...data.workCache,
            ]
          : data.workCache,
    };
    replaceData(next, [targetDate]);
  };
  const chooseVault = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择 Obsidian Vault 文件夹",
    });
    if (typeof selected !== "string") return;
    try {
      const notes = await invoke<DailyMarkdownRecord[]>("read_daily_notes", {
        vaultPath: selected,
      });
      const imported = mergeParsedRecords(notes);
      const next = {
        ...data,
        moments: [...data.moments, ...imported.moments],
        tasks: [...data.tasks, ...imported.tasks],
        workCache: [...data.workCache, ...imported.workCache],
        settings: { ...data.settings, vaultPath: selected },
      };
      skipNextVaultRead.current = true;
      setData(next);
      syncDates(selected, next, [dateKey()]);
    } catch {
      // Do not switch Vault or overwrite its files when the initial read fails.
    }
  };
  const patchProject = (current: AppData, projectId: string, patch: Partial<Pick<SendableRecord, "text" | "done" | "status">>) => ({
    ...current,
    moments: current.moments.map((item) => item.id === projectId ? { ...item, ...patch } : item),
    tasks: current.tasks.map((item) => item.id === projectId ? { ...item, ...patch } : item),
    timeBlocks: current.timeBlocks.map((block) => ({
      ...block,
      items: block.items.map((item) => item.id === projectId ? { ...item, ...patch } : item),
    })),
  });

  const startFocus = (projectId: string) => {
    if (data.focusSession) return;
    const record = [...data.moments, ...data.tasks].find((item) => item.id === projectId);
    if (!record || record.done || record.status !== "Idle") return;
    const start = new Date();
    const endsAt = new Date(start.getTime() + data.settings.focusMinutes * 60_000).toISOString();
    const next = patchProject(data, projectId, { status: "Focusing" });
    replaceData({
      ...next,
      focusSession: {
        projectId,
        phase: "focusing",
        startedAt: start.toISOString(),
        endsAt,
        focusEndsAt: endsAt,
        extensionUsed: false,
      },
    });
    setNow(Date.now());
  };

  const pauseFocus = () => {
    if (!session || session.phase !== "focusing") return;
    const remainingMs = Math.max(0, Date.parse(session.endsAt) - Date.now());
    replaceData({
      ...patchProject(data, session.projectId, { status: "Paused" }),
      focusSession: { ...session, phase: "paused", pausedRemainingMs: remainingMs },
    });
  };

  const resumeFocus = () => {
    if (!session || session.phase !== "paused") return;
    const endsAt = new Date(Date.now() + (session.pausedRemainingMs || 0)).toISOString();
    replaceData({
      ...patchProject(data, session.projectId, { status: "Focusing" }),
      focusSession: { ...session, phase: "focusing", endsAt, pausedRemainingMs: undefined },
    });
  };

  const endFocus = () => {
    if (!session || (session.phase !== "focusing" && session.phase !== "paused")) return;
    const record = [...data.moments, ...data.tasks].find((item) => item.id === session.projectId);
    if (!record) return;
    const elapsed = session.phase === "paused"
      ? Math.max(1, Math.round((data.settings.focusMinutes * 60_000 - (session.pausedRemainingMs || 0)) / 60_000))
      : Math.max(1, Math.round((Date.now() - Date.parse(session.startedAt)) / 60_000));
    const next = patchProject(data, session.projectId, {
      text: `${record.text}（用时${elapsed}分钟完成）`,
      done: true,
      status: "Idle",
    });
    replaceData({
      ...next,
      focusSession: {
        ...session,
        phase: "locked",
        endsAt: new Date(Date.now() + data.settings.lockMinutes * 60_000).toISOString(),
      },
    });
  };

  const extendFocus = () => {
    if (!session || session.phase !== "reflecting" || session.extensionUsed) return;
    const endsAt = new Date(Date.now() + 5 * 60_000).toISOString();
    replaceData({
      ...patchProject(data, session.projectId, { status: "Focusing" }),
      focusSession: { ...session, phase: "focusing", endsAt, extensionUsed: true },
    });
  };

  const finishReflection = (completed: string, pending: string) => {
    if (!session || session.phase !== "reflecting") return;
    const record = [...data.moments, ...data.tasks].find((item) => item.id === session.projectId);
    const text = record ? `${record.text}（未完成，已存缓存区）` : "未完成项目（已存缓存区）";
    const next = patchProject(data, session.projectId, { text, done: true, status: "Idle" });
    replaceData({
      ...next,
      workCache: [
        {
          id: crypto.randomUUID(),
          completed: completed.trim(),
          pending: pending.trim(),
          done: false,
          createdAt: new Date().toISOString(),
        },
        ...data.workCache,
      ],
      focusSession: {
        ...session,
        phase: "locked",
        endsAt: new Date(Date.now() + data.settings.lockMinutes * 60_000).toISOString(),
      },
    });
    setReflectionDraft({ completed: "", pending: "" });
  };

  const testReflection = () => {
    const now = new Date();
    const reflectionStartsAt = now.toISOString();
    const reflectionEndsAt = new Date(
      now.getTime() + data.settings.reflectionMinutes * 60_000,
    ).toISOString();
    update({
      focusSession: {
        projectId: [...data.moments, ...data.tasks][0]?.id || "test-project",
        phase: "reflecting",
        startedAt: reflectionStartsAt,
        endsAt: reflectionEndsAt,
        focusEndsAt: reflectionStartsAt,
        reflectionStartsAt,
        reflectionEndsAt,
      },
    });
  };

  const testLock = () => {
    const now = new Date();
    const lockEndsAt = new Date(
      now.getTime() + data.settings.lockMinutes * 60_000,
    ).toISOString();
    update({
      focusSession: {
        projectId: [...data.moments, ...data.tasks][0]?.id || "test-project",
        phase: "locked",
        startedAt: now.toISOString(),
        endsAt: lockEndsAt,
      },
    });
    void invoke("enter_focus_lock").catch(() => undefined);
  };

  useEffect(() => {
    if (session?.phase === "reflecting" && remaining === 0) {
      finishReflection(reflectionDraft.completed, reflectionDraft.pending);
    }
  }, [session?.phase, remaining, reflectionDraft]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Leaf size={18} />
          </span>
          <span>anchora</span>
        </div>
        <p className="eyebrow">你的专注港湾</p>
        <nav>
          {(
            [
              ["today", Sparkles, "今日"],
              ["history", History, "时间轴"],
              ["settings", Settings, "设置"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={page === id ? "nav-active" : ""}
              onClick={() => {
                setPage(id);
                setMenu(false);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <FocusControl
          phase={phase}
          remaining={remaining}
          focusMinutes={data.settings.focusMinutes}
          pauseFocus={pauseFocus}
          resumeFocus={resumeFocus}
          endFocus={endFocus}
          formatTime={formatTime}
        />
        <div className="test-controls">
          <button type="button" onClick={testReflection}>
            测试总结页面
          </button>
          <button type="button" onClick={testLock}>
            测试锁定
          </button>
        </div>
        <p className="sidebar-footer">本地存储 · 私密安全</p>
      </aside>
      <main>
        <header>
          <button
            className="menu-button"
            onClick={() => setMenu((value) => !value)}
          >
            <Menu size={20} />
          </button>
          <div>
            <p className="date-label">
              {new Date().toLocaleDateString("zh-CN", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <h1>
              {page === "today"
                ? "在场，胜过完成。"
                : page === "history"
                  ? "回望你的轨迹。"
                  : "调整你的节奏。"}
            </h1>
          </div>
          <div className="header-status">
            <span className="status-dot" />
            自动保存中
          </div>
        </header>
        {page === "today" && (
          <TimeBlockTodayPage
            data={data}
            onAddTimeBlockItem={addTimeBlockItem}
            onToggleTimeBlockItem={toggleTimeBlockItem}
              onDeleteTimeBlockItem={deleteTimeBlockItem}
              onMoveTimeBlockItem={moveTimeBlockItem}
              onStartFocus={startFocus}
            />
        )}
        {page === "history" && (
          <TimelinePanel
            data={data}
            sendRecord={sendRecord}
            sendCache={sendCache}
            deleteMoment={deleteMoment}
            deleteTask={deleteTask}
            deleteCache={deleteCache}
            changeMoment={changeMoment}
            changeTask={changeTask}
            changeCache={changeCache}
            addTimelineRecord={addTimelineRecord}
          />
        )}
        {page === "settings" && (
          <SettingsPanel
            data={data}
            update={update}
            chooseVault={chooseVault}
          />
        )}
      </main>
      {phase === "locked" && (
        <div className="lock-status">
          <span>强制专注模式</span>
          <strong>{formatTime(remaining)}</strong>
           <small>紧急退出：Ctrl + Alt + Shift + F12</small>
        </div>
      )}
      {phase === "reflecting" && (
        <ReflectionDialog
          remaining={remaining}
          completed={reflectionDraft.completed}
          pending={reflectionDraft.pending}
          extensionUsed={Boolean(session?.extensionUsed)}
          onChangeCompleted={(completed) => setReflectionDraft((current) => ({ ...current, completed }))}
          onChangePending={(pending) => setReflectionDraft((current) => ({ ...current, pending }))}
          onExtend={extendFocus}
          onSave={() => finishReflection(reflectionDraft.completed, reflectionDraft.pending)}
        />
      )}
    </div>
  );
}

function TimeBlockTodayPage({
  data,
  onAddTimeBlockItem,
  onToggleTimeBlockItem,
  onDeleteTimeBlockItem,
  onMoveTimeBlockItem,
  onStartFocus,
}: {
  data: AppData;
  onAddTimeBlockItem: (blockId: string, text: string, kind: "moment" | "task") => void;
  onToggleTimeBlockItem: (blockId: string, itemId: string) => void;
  onDeleteTimeBlockItem: (blockId: string, itemId: string) => void;
  onMoveTimeBlockItem: (itemId: string, blockId: string, index?: number) => void;
  onStartFocus: (itemId: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, "moment" | "task">>({});
  const setDraft = (blockId: string, value: string) =>
    setDrafts((current) => ({ ...current, [blockId]: value }));
  const submit = (blockId: string) => {
    onAddTimeBlockItem(blockId, drafts[blockId] || "", kinds[blockId] || "task");
    setDraft(blockId, "");
  };
  const recordFor = (itemId: string) =>
    [...data.moments, ...data.tasks].find((record) => record.id === itemId);
  const dragStart = (event: React.DragEvent, itemId: string) => {
    const record = recordFor(itemId);
    if (!record || (record.status && record.status !== "Idle")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", itemId);
    event.dataTransfer.effectAllowed = "move";
  };
  const drop = (event: React.DragEvent, blockId: string, index?: number) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain");
    if (itemId) onMoveTimeBlockItem(itemId, blockId, index);
  };
  return (
    <section className="time-block-grid" aria-label="今日时间块">
      {data.timeBlocks.map((block) => {
        const kind = kinds[block.id] || (block.categories.includes("美好瞬间") ? "moment" : "task");
        return (
          <article
            className="time-block-card"
            key={block.id}
            style={{ backgroundImage: `linear-gradient(180deg, rgba(28, 48, 40, .12), rgba(28, 48, 40, .9)), url(${block.background || ""})` }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, block.id)}
          >
            <header className="time-block-card-header">
              <div>
                <span className="time-block-time">{block.startTime} - {block.endTime}</span>
                <h2>{block.title}</h2>
              </div>
              <span className="time-block-category">{block.categories.join(" / ")}</span>
            </header>
            <div className="time-block-items">
              {block.items.map((item, index) => {
                const record = recordFor(item.id);
                const status: RecordStatus = record?.status || "Idle";
                const locked = status === "Focusing" || status === "Paused";
                return (
                  <div
                    className={`time-block-item ${item.done ? "item-done" : ""} ${locked ? "item-locked" : ""}`}
                    key={item.id}
                    draggable={!locked}
                    onDragStart={(event) => dragStart(event, item.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, block.id, index)}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={locked}
                      onChange={() => onToggleTimeBlockItem(block.id, item.id)}
                      aria-label={`完成${item.text}`}
                    />
                    <span className="time-block-item-text">{item.text}</span>
                    {locked && <small className="item-status">{status}</small>}
                    {!item.done && status === "Idle" && (
                      <button type="button" className="start-focus-button" disabled={Boolean(data.focusSession)} onClick={() => onStartFocus(item.id)}>
                        开始专注
                      </button>
                    )}
                    <button type="button" onClick={() => onDeleteTimeBlockItem(block.id, item.id)} aria-label={`删除${item.text}`}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="time-block-composer">
              <input
                value={drafts[block.id] || ""}
                onChange={(event) => setDraft(block.id, event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") submit(block.id); }}
                placeholder="添加项目..."
              />
              {block.categories.length > 1 && (
                <select value={kind} onChange={(event) => setKinds((current) => ({ ...current, [block.id]: event.target.value as "moment" | "task" }))}>
                  <option value="moment">瞬间</option>
                  <option value="task">事务</option>
                </select>
              )}
              <button type="button" onClick={() => submit(block.id)}><Plus size={15} /></button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function TodayPage(props: {
  data: AppData;
  updateDraft: (value: string) => void;
  taskText: string;
  setTaskText: (value: string) => void;
  addMoment: () => void;
  addTask: () => void;
  changeMoment: (id: string, patch: Partial<Moment>) => void;
  changeTask: (id: string, patch: Partial<Task>) => void;
  deleteMoment: (id: string) => void;
  deleteTask: (id: string) => void;
  changeCache: (id: string, patch: Partial<WorkCache>) => void;
  deleteCache: (id: string) => void;
  sendCache: (item: WorkCache, target: SendTarget, date: string) => void;
  sendRecord: (
    item: SendableRecord,
    source: SendTarget,
    target: SendTarget,
    date: string,
  ) => void;
}) {
  const {
    data,
    updateDraft,
    taskText,
    setTaskText,
    addMoment,
    addTask,
    changeMoment,
    changeTask,
    deleteMoment,
    deleteTask,
    changeCache,
    deleteCache,
    sendCache,
    sendRecord,
  } = props;
  const [selectedRecord, setSelectedRecord] = useState<SelectedRecord | null>(
    null,
  );
  const [selectedEdit, setSelectedEdit] = useState<EditSelection | null>(null);
  const today = dateKey();
  return (
    <section className="content-grid today-grid">
      <div className="main-column">
        <section className="panel diary-panel">
          <div className="section-heading">
             <div><h2>瞬间</h2></div>
            <Sparkles size={21} className="muted-icon" />
          </div>
          <textarea
            value={data.draft}
            onChange={(event) => updateDraft(event.target.value)}
            placeholder="记下一个瞬间……"
            />
            <div className="composer-footer">
              <span />
            <button className="primary-button" onClick={addMoment}>
              收录瞬间 <Plus size={16} />
            </button>
          </div>
          <div className="task-list">
            {data.moments
              .filter((item) => dateKey(item.createdAt) === today)
              .map((moment) => (
                <div
                  className={`task-row ${moment.done ? "task-done" : ""}`}
                  key={moment.id}
                >
                  <input
                    type="checkbox"
                    checked={moment.done}
                    disabled={Boolean(moment.sentTo)}
                    onChange={() =>
                      changeMoment(moment.id, { done: !moment.done })
                    }
                  />
                  <span>
                    {moment.text}
                    {moment.sentTo && (
                      <small className="sent-label">
                        {sentStatus(moment.sentTo, moment.sentAt)}
                      </small>
                    )}
                  </span>
                  {!moment.done && (
                    <button
                      className="record-edit-button"
                      onClick={() => setSelectedEdit({ kind: "moment", item: moment })}
                    >
                      编辑
                    </button>
                  )}
                  <button
                    className="record-send-button"
                    disabled={Boolean(moment.sentTo)}
                    onClick={() =>
                      setSelectedRecord({ item: moment, source: "moment" })
                    }
                  >
                    发送
                  </button>
                  <button
                    className="icon-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => deleteMoment(moment.id)}
                    aria-label="删除瞬间"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </div>
        </section>
        <section className="panel task-panel">
          <div className="section-heading">
             <div><h2>日常事务</h2></div>
            <SquareCheckBig size={21} className="muted-icon" />
          </div>
          <div className="task-input">
            <input
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addTask()}
              placeholder="添加一件小事……"
            />
            <button onClick={addTask}>
              <Plus size={18} />
            </button>
          </div>
          <div className="task-list">
            {data.tasks
              .filter((item) => dateKey(item.createdAt) === today)
              .map((task) => (
                <div
                  className={`task-row ${task.done ? "task-done" : ""}`}
                  key={task.id}
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={Boolean(task.sentTo)}
                    onChange={() => changeTask(task.id, { done: !task.done })}
                  />
                  <span>
                    {task.text}
                    {task.sentTo && (
                      <small className="sent-label">
                        {sentStatus(task.sentTo, task.sentAt)}
                      </small>
                    )}
                  </span>
                  {!task.done && (
                    <button
                      className="record-edit-button"
                      onClick={() => setSelectedEdit({ kind: "task", item: task })}
                    >
                      编辑
                    </button>
                  )}
                  <button
                    className="record-send-button"
                    disabled={Boolean(task.sentTo)}
                    onClick={() =>
                      setSelectedRecord({ item: task, source: "task" })
                    }
                  >
                    发送
                  </button>
                  <button
                    className="icon-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => deleteTask(task.id)}
                    aria-label="删除日常事务"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </div>
        </section>
        <WorkCachePanel
          workCache={data.workCache}
          onToggle={(id) =>
            changeCache(id, {
              done: !data.workCache.find((item) => item.id === id)?.done,
            })
          }
          onDelete={deleteCache}
          onSend={sendCache}
        />
        {selectedRecord && (
          <RecordSendDialog
            selection={selectedRecord}
            onClose={() => setSelectedRecord(null)}
            onSend={(target, date) => {
              sendRecord(
                selectedRecord.item,
                selectedRecord.source,
                target,
                date,
              );
              setSelectedRecord(null);
            }}
          />
        )}
        {selectedEdit && (
          <EditRecordDialog
            selection={selectedEdit}
            onClose={() => setSelectedEdit(null)}
            onSave={(patch) => {
              if (selectedEdit.kind === "moment") {
                changeMoment(selectedEdit.item.id, patch as Partial<Moment>);
              } else if (selectedEdit.kind === "task") {
                changeTask(selectedEdit.item.id, patch as Partial<Task>);
              } else {
                changeCache(selectedEdit.item.id, patch as Partial<WorkCache>);
              }
              setSelectedEdit(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

function RecordSendDialog({
  selection,
  onClose,
  onSend,
}: {
  selection: SelectedRecord;
  onClose: () => void;
  onSend: (target: SendTarget, date: string) => void;
}) {
  const [target, setTarget] = useState<SendTarget>(selection.source);
  const [date, setDate] = useState(() => dateKey(selection.item.createdAt));
  return (
    <div className="send-dialog-backdrop">
      <div className="send-dialog" role="dialog" aria-modal="true">
        <h3>发送记录</h3>
        <label>
          发送至
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value as SendTarget)}
          >
            <option value="moment">美好瞬间</option>
            <option value="task">日常事务</option>
          </select>
        </label>
        <label>
          选择日期
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <div>
          <button className="snooze-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!date}
            onClick={() => onSend(target, date)}
          >
            确认发送
          </button>
        </div>
      </div>
    </div>
  );
}

function CacheSendDialog({
  item,
  onClose,
  onSend,
}: {
  item: WorkCache;
  onClose: () => void;
  onSend: (target: SendTarget, date: string) => void;
}) {
  const [target, setTarget] = useState<SendTarget>("task");
  const [date, setDate] = useState(() => dateKey(item.createdAt));
  return (
    <div className="send-dialog-backdrop">
      <div className="send-dialog" role="dialog" aria-modal="true">
        <h3>发送工作缓存</h3>
        <label>
          发送至
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value as SendTarget)}
          >
            <option value="task">日常事务</option>
            <option value="moment">美好瞬间</option>
          </select>
        </label>
        <label>
          选择日期
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <div>
          <button className="snooze-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!date}
            onClick={() => onSend(target, date)}
          >
            确认发送
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRecordDialog({
  selection,
  onClose,
  onSave,
}: {
  selection: EditSelection;
  onClose: () => void;
  onSave: (patch: Partial<Moment> | Partial<Task> | Partial<WorkCache>) => void;
}) {
  const isCache = selection.kind === "cache";
  const [text, setText] = useState(
    isCache ? selection.item.completed : selection.item.text,
  );
  const [pending, setPending] = useState(
    isCache ? selection.item.pending : "",
  );
  return (
    <div className="send-dialog-backdrop">
      <div className="send-dialog edit-dialog" role="dialog" aria-modal="true">
        <h3>编辑{isCache ? "工作缓存" : selection.kind === "moment" ? "美好瞬间" : "日常事务"}</h3>
        <label>
          {isCache ? "已完成" : "内容"}
          <textarea value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {isCache && (
          <label>
            待完成
            <textarea value={pending} onChange={(event) => setPending(event.target.value)} />
          </label>
        )}
        <div>
          <button className="snooze-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!text.trim() && !pending.trim()}
            onClick={() =>
              onSave(
                isCache
                  ? { completed: text.trim(), pending: pending.trim() }
                  : { text: text.trim() },
              )
            }
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function AddTimelineRecordDialog({
  kind,
  date,
  onClose,
  onSave,
}: {
  kind: NewRecordKind;
  date: string;
  onClose: () => void;
  onSave: (text: string, pending: string) => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState("");
  const title =
    kind === "moment"
      ? "美好瞬间"
      : kind === "task"
        ? "日常事务"
        : "工作缓存";
  return (
    <div className="send-dialog-backdrop">
      <div className="send-dialog edit-dialog" role="dialog" aria-modal="true">
        <h3>添加{title}</h3>
        <label>
          {kind === "cache" ? "已完成" : "内容"}
          <textarea
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {kind === "cache" && (
          <label>
            待完成
            <textarea
              value={pending}
              onChange={(event) => setPending(event.target.value)}
            />
          </label>
        )}
        <small>记录日期：{date}</small>
        <div>
          <button className="snooze-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={!text.trim() && !pending.trim()}
            onClick={() => onSave(text.trim(), pending.trim())}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

function FocusControl({
  phase,
  remaining,
  focusMinutes,
  pauseFocus,
  resumeFocus,
  endFocus,
  formatTime,
}: {
  phase?: FocusPhase;
  remaining: number;
  focusMinutes: number;
  pauseFocus: () => void;
  resumeFocus: () => void;
  endFocus: () => void;
  formatTime: (seconds: number) => string;
}) {
  return (
    <section className="focus-control">
      <div className="focus-control-time">
        <Clock3 size={17} />
        <strong>{remaining ? formatTime(remaining) : `${focusMinutes}:00`}</strong>
      </div>
      {phase === "focusing" && <button className="dark-button" onClick={pauseFocus}>暂停</button>}
      {phase === "paused" && <button className="dark-button" onClick={resumeFocus}>继续</button>}
      {(phase === "focusing" || phase === "paused") && <button className="focus-end-button" onClick={endFocus}>结束专注</button>}
      {phase === "reflecting" && <span className="focus-phase-label">总结中</span>}
      {phase === "locked" && <span className="focus-phase-label">锁定中</span>}
      {!phase && <span className="focus-phase-label">选择项目开始专注</span>}
    </section>
  );
}

function ReflectionDialog({
  remaining,
  completed,
  pending,
  extensionUsed,
  onChangeCompleted,
  onChangePending,
  onExtend,
  onSave,
}: {
  remaining: number;
  completed: string;
  pending: string;
  extensionUsed: boolean;
  onChangeCompleted: (value: string) => void;
  onChangePending: (value: string) => void;
  onExtend: () => void;
  onSave: () => void;
}) {
  return (
    <div className="reflection-dialog-backdrop">
      <div className="reflection-dialog" role="dialog" aria-modal="true">
        <div className="reflection-dialog-heading">
          <div>
            <span className="kicker">专注已结束</span>
            <h2>把未完成的事情安放好。</h2>
          </div>
          <strong>{remaining}s</strong>
        </div>
        <label>
          已完成
          <textarea value={completed} onChange={(event) => onChangeCompleted(event.target.value)} autoFocus />
        </label>
        <label>
          未完成 / 下一步
          <textarea value={pending} onChange={(event) => onChangePending(event.target.value)} />
        </label>
        <div className="reflection-dialog-actions">
          <button className="snooze-button" disabled={extensionUsed} onClick={onExtend}>
            {extensionUsed ? "已延时 5 分钟" : "再延 5 分钟"}
          </button>
          <button className="primary-button" onClick={onSave}>保存并锁屏</button>
        </div>
      </div>
    </div>
  );
}

function WorkCachePanel({
  workCache,
  onToggle,
  onDelete,
  onSend,
}: {
  workCache: WorkCache[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onSend: (item: WorkCache, target: SendTarget, date: string) => void;
}) {
  const [selected, setSelected] = useState<WorkCache | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<SendTarget>("task");
  const [date, setDate] = useState("");
  const choose = (item: WorkCache) => {
    setSelected(item);
    setTarget("task");
    setDate(dateKey(item.createdAt));
  };
  return (
    <section className="panel work-cache-panel">
      <div className="section-heading">
        <div><h2>工作缓存{workCache.length ? ` · ${workCache.length}` : ""}</h2></div>
        <Clock3 size={21} className="muted-icon" />
      </div>
      {workCache.length === 0 ? (
        <p className="empty">总结时记录下来的工作，会出现在这里。</p>
      ) : (
        <>
          <button
            className="cache-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "收起" : "查看缓存"}
          </button>
          {expanded && <div className="work-cache-list">
          {workCache.map((item) => (
            <article
              className={`work-cache-card ${item.done ? "task-done" : ""}`}
              key={item.id}
            >
              <div className="cache-card-header">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={Boolean(item.sentTo)}
                  onChange={() => onToggle(item.id)}
                  aria-label="完成工作缓存"
                />
                <time>
                  保存于 {new Date(item.createdAt).toLocaleString("zh-CN")}
                </time>
                <button
                  className="icon-button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onDelete(item.id)}
                  aria-label="删除工作缓存"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <p>
                <strong>已完成：</strong>
                {item.completed || "暂无记录。"}；<strong>待完成：</strong>
                {item.pending || "暂无记录。"}
              </p>
              {item.sentTo && (
                <small>
                  已转为{item.sentTo === "moment" ? "美好瞬间" : "日常事务"}
                  ，发送于{" "}
                  {new Date(item.sentAt || item.createdAt).toLocaleString(
                    "zh-CN",
                  )}
                </small>
              )}
              {!item.sentTo && (
                <button className="export-button" onClick={() => choose(item)}>
                  <Send size={14} /> 发送至清单
                </button>
              )}
            </article>
          ))}
          </div>}
        </>
      )}
      {selected && (
        <div className="send-dialog-backdrop">
          <div className="send-dialog" role="dialog" aria-modal="true">
            <h3>发送工作缓存</h3>
            <label>
              发送至
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as SendTarget)
                }
              >
                <option value="task">日常事务</option>
                <option value="moment">美好瞬间</option>
              </select>
            </label>
            <label>
              选择日期
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <div>
              <button
                className="snooze-button"
                onClick={() => setSelected(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={!date}
                onClick={() => {
                  onSend(selected, target, date);
                  setSelected(null);
                }}
              >
                确认发送
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ReflectionWindow() {
  const draftKey = "anchora:reflection-draft:v1";
  const [endsAt, setEndsAt] = useState("");
  const [now, setNow] = useState(Date.now());
  const [completed, setCompleted] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "{}").completed || "";
    } catch {
      return "";
    }
  });
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "{}").pending || "";
    } catch {
      return "";
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [timerReady, setTimerReady] = useState(false);
  const parsedEndsAt = Date.parse(endsAt);
  const remaining = Number.isFinite(parsedEndsAt)
    ? Math.max(0, Math.ceil((parsedEndsAt - now) / 1000))
    : 0;
  useEffect(() => {
    document.documentElement.classList.add("reflection-document");
    return () => document.documentElement.classList.remove("reflection-document");
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let disposed = false;
    const syncEndsAt = () => {
      void invoke<string>("get_reflection_ends_at")
        .then((value) => {
          const receivedEndsAt = Date.parse(value);
          if (
            disposed ||
            !Number.isFinite(receivedEndsAt) ||
            receivedEndsAt <= Date.now()
          ) {
            return;
          }
          setEndsAt(value);
          setTimerReady(true);
        })
        .catch(() => undefined);
    };
    syncEndsAt();
    const timer = window.setInterval(syncEndsAt, 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem(draftKey, JSON.stringify({ completed, pending }));
  }, [completed, pending]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen("reflection_started", () => {
      setSubmitting(false);
      void invoke<string>("get_reflection_ends_at")
        .then((value) => {
          if (disposed) return;
          setEndsAt(value);
          setTimerReady(true);
        })
        .catch(() => undefined);
    })
      .then((value) => {
        if (disposed) value();
        else stop = value;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  const finish = async (save: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await invoke("complete_reflection", {
        completed: save ? completed : "",
        pending: save ? pending : "",
      });
      localStorage.removeItem(draftKey);
    } catch {
      await getCurrentWindow()
        .hide()
        .catch(() => undefined);
      }
  };
  useEffect(() => {
    if (timerReady && remaining === 0 && !submitting) void finish(true);
  }, [remaining, submitting, timerReady]);
  return (
    <div className="reflection-window">
      <div className="reminder-overlay">
        <div className="reminder-content" data-overlay-hit>
          <div className="final-countdown">{remaining}</div>
          <div className="work-cache-inputs">
            <textarea
              value={completed}
              onChange={(event) => setCompleted(event.target.value)}
              placeholder="已完成"
              autoFocus
              disabled={submitting}
            />
            <textarea
              value={pending}
              onChange={(event) => setPending(event.target.value)}
              placeholder="待完成"
              disabled={submitting}
            />
          </div>
          <div>
            <button
              className="snooze-button"
              onClick={() => void finish(false)}
              disabled={submitting}
            >
              跳过
            </button>
            <button
              className="primary-button"
              onClick={() => void finish(true)}
              disabled={submitting}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelinePanel({
  data,
  sendRecord,
  sendCache,
  deleteMoment,
  deleteTask,
  deleteCache,
  changeMoment,
  changeTask,
  changeCache,
  addTimelineRecord,
}: {
  data: AppData;
  sendRecord: (
    item: SendableRecord,
    source: SendTarget,
    target: SendTarget,
    date: string,
  ) => void;
  sendCache: (item: WorkCache, target: SendTarget, date: string) => void;
  deleteMoment: (id: string) => void;
  deleteTask: (id: string) => void;
  deleteCache: (id: string) => void;
  changeMoment: (id: string, patch: Partial<Moment>) => void;
  changeTask: (id: string, patch: Partial<Task>) => void;
  changeCache: (id: string, patch: Partial<WorkCache>) => void;
  addTimelineRecord: (
    kind: NewRecordKind,
    date: string,
    text: string,
    pending?: string,
  ) => void;
}) {
  const [date, setDate] = useState(dateKey());
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [selectedRecord, setSelectedRecord] = useState<SelectedRecord | null>(
    null,
  );
  const [selectedCache, setSelectedCache] = useState<WorkCache | null>(null);
  const [selectedEdit, setSelectedEdit] = useState<EditSelection | null>(null);
  const [newRecordKind, setNewRecordKind] = useState<NewRecordKind | null>(null);
  const targetDate = date === "全部" ? dateKey() : date;
  const recordDates = new Set(
    [...data.moments, ...data.tasks, ...data.workCache].map((item) =>
      dateKey(item.createdAt),
    ),
  );
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const firstWeekday = monthDate.getUTCDay();
  const calendarDays = [
    ...Array(firstWeekday).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
  const moveMonth = (offset: number) => {
    const next = new Date(
      Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + offset, 1),
    );
    setMonth(
      `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  };
  const selectDate = (value: string) => {
    setDate(value);
    setMonth(value.slice(0, 7));
  };
  const moments = data.moments.filter(
    (moment) =>
      (date === "全部" || dateKey(moment.createdAt) === date),
  );
  const tasks = data.tasks.filter(
    (task) => date === "全部" || dateKey(task.createdAt) === date,
  );
  const workCache = data.workCache.filter(
    (item) => date === "全部" || dateKey(item.createdAt) === date,
  );
  return (
    <section className="panel history-panel">
      <div className="timeline-calendar">
        <button
          className={date === "全部" ? "filter-active calendar-all-top" : "calendar-all-top"}
          onClick={() => setDate("全部")}
        >
          全部记录
        </button>
        <div className="calendar-header">
          <button onClick={() => moveMonth(-1)} aria-label="上个月">
            ‹
          </button>
          <strong>{month.replace("-", "年")}月</strong>
          <button onClick={() => moveMonth(1)} aria-label="下个月">
            ›
          </button>
        </div>
        <div className="calendar-weekdays">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {calendarDays.map((value, index) =>
            value ? (
              <button
                key={value}
                className={`${date === value ? "calendar-selected " : ""}${recordDates.has(value) ? "calendar-has-record" : ""}`}
                onClick={() => selectDate(value)}
              >
                {Number(value.slice(-2))}
                {recordDates.has(value) && <i />}
              </button>
            ) : (
              <span key={`blank-${index}`} />
            ),
          )}
        </div>
      </div>
      <div className="timeline-add-actions">
        <button onClick={() => setNewRecordKind("moment")}>添加美好瞬间</button>
        <button onClick={() => setNewRecordKind("task")}>添加日常事务</button>
        <button onClick={() => setNewRecordKind("cache")}>添加工作缓存</button>
      </div>
      
      {moments.length > 0 && (
        <article className="moment-card timeline-tasks">
          <time>美好瞬间</time>
          {moments.map((moment) => (
            <p className={moment.done ? "task-done" : ""} key={moment.id}>
              {moment.done ? "✓" : "○"} {moment.text}{" "}
              <small>{new Date(moment.createdAt).toLocaleString("zh-CN")}</small>
              {moment.sentTo && (
                <small className="sent-label">
                  {sentStatus(moment.sentTo, moment.sentAt)}
                </small>
              )}
              {!moment.done && (
                <button
                  className="record-edit-button"
                  onClick={() => setSelectedEdit({ kind: "moment", item: moment })}
                >
                  编辑
                </button>
              )}
              <button
                className="record-send-button"
                disabled={Boolean(moment.sentTo)}
                onClick={() =>
                  setSelectedRecord({ item: moment, source: "moment" })
                }
              >
                发送
              </button>
              <button
                className="icon-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => deleteMoment(moment.id)}
                aria-label="删除美好瞬间"
              >
                <Trash2 size={15} />
              </button>
            </p>
          ))}
        </article>
      )}
      {tasks.length > 0 && (
        <article className="moment-card timeline-tasks">
          <time>日常事务</time>
          {tasks.map((task) => (
            <p className={task.done ? "task-done" : ""} key={task.id}>
              {task.done ? "✓" : "○"} {task.text}{" "}
              <small>{new Date(task.createdAt).toLocaleString("zh-CN")}</small>
              {task.sentTo && (
                <small className="sent-label">
                  {sentStatus(task.sentTo, task.sentAt)}
                </small>
              )}
              {!task.done && (
                <button
                  className="record-edit-button"
                  onClick={() => setSelectedEdit({ kind: "task", item: task })}
                >
                  编辑
                </button>
              )}
              <button
                className="record-send-button"
                disabled={Boolean(task.sentTo)}
                onClick={() => setSelectedRecord({ item: task, source: "task" })}
              >
                发送
              </button>
              <button
                className="icon-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => deleteTask(task.id)}
                aria-label="删除日常事务"
              >
                <Trash2 size={15} />
              </button>
            </p>
          ))}
        </article>
      )}
      {workCache.length > 0 && (
        <article className="moment-card timeline-tasks">
          <time>工作缓存</time>
          {workCache.map((item) => (
            <p className={item.done ? "task-done" : ""} key={item.id}>
              {item.done ? "✓" : "○"} 已完成：{item.completed || "暂无记录"}
              ；待完成：{item.pending || "暂无记录"}{" "}
              <small>
                保存于 {new Date(item.createdAt).toLocaleString("zh-CN")}
              </small>
              {item.sentTo && (
                <small className="sent-label">
                  {sentStatus(item.sentTo, item.sentAt)}
                </small>
              )}
              {!item.done && (
                <button
                  className="record-edit-button"
                  onClick={() => setSelectedEdit({ kind: "cache", item })}
                >
                  编辑
                </button>
              )}
              {!item.sentTo && (
                <button
                  className="record-send-button"
                  onClick={() => setSelectedCache(item)}
                >
                  发送
                </button>
              )}
              <button
                className="icon-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => deleteCache(item.id)}
                aria-label="删除工作缓存"
              >
                <Trash2 size={15} />
              </button>
            </p>
          ))}
        </article>
      )}
      {moments.length === 0 && tasks.length === 0 && workCache.length === 0 && (
        <p className="empty large-empty">这一天还没有记录。</p>
      )}
      {selectedRecord && (
        <RecordSendDialog
          selection={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onSend={(target, targetDate) => {
            sendRecord(
              selectedRecord.item,
              selectedRecord.source,
              target,
              targetDate,
            );
            setSelectedRecord(null);
          }}
        />
      )}
      {selectedCache && (
        <CacheSendDialog
          item={selectedCache}
          onClose={() => setSelectedCache(null)}
          onSend={(target, targetDate) => {
            sendCache(selectedCache, target, targetDate);
            setSelectedCache(null);
          }}
        />
      )}
      {selectedEdit && (
        <EditRecordDialog
          selection={selectedEdit}
          onClose={() => setSelectedEdit(null)}
          onSave={(patch) => {
            if (selectedEdit.kind === "moment") {
              changeMoment(selectedEdit.item.id, patch as Partial<Moment>);
            } else if (selectedEdit.kind === "task") {
              changeTask(selectedEdit.item.id, patch as Partial<Task>);
            } else {
              changeCache(selectedEdit.item.id, patch as Partial<WorkCache>);
            }
            setSelectedEdit(null);
          }}
        />
      )}
      {newRecordKind && (
        <AddTimelineRecordDialog
          kind={newRecordKind}
          date={targetDate}
          onClose={() => setNewRecordKind(null)}
          onSave={(text, pending) => {
            addTimelineRecord(newRecordKind, targetDate, text, pending);
            setNewRecordKind(null);
          }}
        />
      )}
    </section>
  );
}

function SettingsPanel({
  data,
  update,
  chooseVault,
}: {
  data: AppData;
  update: (patch: Partial<AppData>) => void;
  chooseVault: () => Promise<void>;
}) {
  const settings = data.settings;
  const change = (patch: Partial<typeof settings>) =>
    update({ settings: { ...settings, ...patch } });
  return (
    <section className="panel settings-panel">
      <span className="kicker">偏好设置</span>
      <h2>让 Anchora 适合你的节奏。</h2>
      <div className="setting-group">
        <label>
          专注时长 <output>{settings.focusMinutes} 分钟</output>
        </label>
        <input
          type="range"
          min={settings.reflectionMinutes}
          max="90"
          value={settings.focusMinutes}
          onChange={(event) =>
            change({
              focusMinutes: Math.max(
                settings.reflectionMinutes,
                +event.target.value,
              ),
            })
          }
        />
      </div>
      <div className="setting-group">
        <label>
          总结时长 <output>{settings.reflectionMinutes} 分钟</output>
        </label>
        <input
          type="range"
          min="1"
          max={settings.focusMinutes}
          value={settings.reflectionMinutes}
          onChange={(event) =>
            change({ reflectionMinutes: +event.target.value })
          }
        />
      </div>
      <div className="setting-group">
        <label>
          锁定时长 <output>{settings.lockMinutes} 分钟</output>
        </label>
        <input
          type="range"
          min="1"
          max="10"
          value={settings.lockMinutes}
          onChange={(event) => change({ lockMinutes: +event.target.value })}
        />
      </div>
      <div className="vault-setting">
        <div>
          <strong>Obsidian Vault</strong>
          <p>{settings.vaultPath || "尚未连接共享 Markdown 库"}</p>
        </div>
        <button className="export-button" onClick={() => void chooseVault()}>
          选择文件夹
        </button>
        <button
          className="export-button vault-disconnect-button"
          disabled={!settings.vaultPath}
          onClick={() => update({ settings: { ...settings, vaultPath: "" } })}
        >
          断开 Vault
        </button>
      </div>
    </section>
  );
}
