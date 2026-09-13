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
import { AppData, FocusPhase, Moment, Task, WorkCache } from "./types";
import {
  dateKey,
  DailyMarkdownRecord,
  formatDailyNote,
  mergeParsedRecords,
} from "./markdown";
import { loadData, saveData } from "./storage";

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

export function App() {
  const isReflectionWindow =
    typeof window !== "undefined" &&
    Boolean(
      (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    ) &&
    getCurrentWindow().label === "reflection";
  if (isReflectionWindow) return <ReflectionWindow />;
  const [data, setData] = useState<AppData>(loadData);
  const [page, setPage] = useState<Page>("today");
  const [taskText, setTaskText] = useState("");
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(Date.now());
  const syncTimer = useRef<number | undefined>(undefined);
  const skipNextVaultRead = useRef(false);
  const update = (patch: Partial<AppData>) =>
    setData((current) => ({ ...current, ...patch }));
  const session = data.focusSession;
  const phase = session?.phase;
  const displayEndsAt =
    session?.phase === "focusing"
      ? Date.parse(session.focusEndsAt || session.endsAt)
      : session
        ? Date.parse(
            session.phase === "reflecting"
              ? session.reflectionEndsAt || session.endsAt
              : session.endsAt,
          )
        : 0;
  const remaining = session
    ? Math.max(0, Math.ceil((displayEndsAt - now) / 1000))
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
        if (notes.length)
          setData((current) => ({ ...current, ...mergeParsedRecords(notes) }));
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
    if (!session || now < Date.parse(session.endsAt)) return;
    if (session.phase === "focusing") {
      const endsAt =
        session.reflectionEndsAt ||
        new Date(
          Date.parse(session.reflectionStartsAt || session.endsAt) +
            data.settings.reflectionMinutes * 60_000,
        ).toISOString();
      setData((current) =>
        current.focusSession
          ? {
              ...current,
              focusSession: {
                ...current.focusSession,
                phase: "reflecting",
                endsAt,
                reflectionEndsAt: endsAt,
              },
            }
          : current,
      );
      void invoke("show_reflection_overlay", { endsAt }).catch(() => undefined);
    } else if (session.phase === "reflecting") {
      setData((current) =>
        current.focusSession
          ? {
              ...current,
              focusSession: {
                ...current.focusSession,
                phase: "locked",
                endsAt: new Date(
                  Date.now() + current.settings.lockMinutes * 60_000,
                ).toISOString(),
              },
            }
          : current,
      );
    } else {
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
          content: formatDailyNote(
            date,
            next.moments,
            next.tasks,
            next.workCache,
          ),
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
                createdAt,
              },
              ...data.moments,
            ]
          : data.moments,
      tasks:
        target === "task"
          ? [
              { id: crypto.randomUUID(), text, done: false, createdAt },
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
    const copiedItem = {
      id: crypto.randomUUID(),
      text: item.text,
      done: false,
      createdAt,
    };
    const moments =
      source === "moment"
        ? data.moments.map((record) =>
            record.id === item.id
              ? { ...record, done: true, sentTo: target, sentAt }
              : record,
          )
        : data.moments;
    const tasks =
      source === "task"
        ? data.tasks.map((record) =>
            record.id === item.id
              ? { ...record, done: true, sentTo: target, sentAt }
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
          ? [{ id: crypto.randomUUID(), text, done: false, createdAt }, ...data.moments]
          : data.moments,
      tasks:
        kind === "task"
          ? [{ id: crypto.randomUUID(), text, done: false, createdAt }, ...data.tasks]
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
  const startFocus = () => {
    const start = new Date();
    const focusMinutes = Math.max(
      data.settings.focusMinutes,
      data.settings.reflectionMinutes,
    );
    const focusEndsAt = new Date(
      start.getTime() +
        (focusMinutes - data.settings.reflectionMinutes) * 60_000,
    ).toISOString();
    const reflectionStartsAt = focusEndsAt;
    const reflectionEndsAt = new Date(
      Date.parse(reflectionStartsAt) + data.settings.reflectionMinutes * 60_000,
    ).toISOString();
    update({
      focusSession: {
        phase: "focusing",
        startedAt: start.toISOString(),
        endsAt: focusEndsAt,
        focusEndsAt,
        reflectionStartsAt,
        reflectionEndsAt,
      },
    });
    setNow(Date.now());
    void invoke("show_focus_overlay").catch(() => undefined);
  };

  const testReflection = () => {
    const now = new Date();
    const reflectionStartsAt = now.toISOString();
    const reflectionEndsAt = new Date(
      now.getTime() + data.settings.reflectionMinutes * 60_000,
    ).toISOString();
    update({
      focusSession: {
        phase: "reflecting",
        startedAt: reflectionStartsAt,
        endsAt: reflectionEndsAt,
        focusEndsAt: reflectionStartsAt,
        reflectionStartsAt,
        reflectionEndsAt,
      },
    });
    void invoke("show_reflection_overlay", { endsAt: reflectionEndsAt }).catch(
      () => undefined,
    );
  };

  const testLock = () => {
    const now = new Date();
    const lockEndsAt = new Date(
      now.getTime() + data.settings.lockMinutes * 60_000,
    ).toISOString();
    update({
      focusSession: {
        phase: "locked",
        startedAt: now.toISOString(),
        endsAt: lockEndsAt,
      },
    });
    void invoke("enter_focus_lock").catch(() => undefined);
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let lastPayload: { key: string; at: number } | undefined;
    void listen<ReflectionCompleted>("reflection_completed", ({ payload }) => {
      const key = `${payload.completed}\u0000${payload.pending}`;
      const now = Date.now();
      if (lastPayload?.key === key && now - lastPayload.at < 1_000) return;
      lastPayload = { key, at: now };
      setData((current) => {
        const next =
          payload.completed.trim() || payload.pending.trim()
            ? {
                ...current,
                workCache: [
                  {
                    id: crypto.randomUUID(),
                    completed: payload.completed.trim(),
                    pending: payload.pending.trim(),
                    done: false,
                    createdAt: new Date().toISOString(),
                  },
                  ...current.workCache,
                ],
              }
            : current;
        const locked = next.focusSession
          ? {
              ...next,
              focusSession: {
                ...next.focusSession,
                phase: "locked" as const,
                endsAt: new Date(
                  Date.now() + next.settings.lockMinutes * 60_000,
                ).toISOString(),
              },
            }
          : next;
        syncDates(locked.settings.vaultPath, locked, [dateKey()]);
        void invoke("enter_focus_lock").catch(() => undefined);
        return locked;
      });
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
          startFocus={startFocus}
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
          {page === "today" && (
            <div className="mobile-focus-control">
              <FocusControl
                phase={phase}
                remaining={remaining}
                focusMinutes={data.settings.focusMinutes}
                startFocus={startFocus}
                formatTime={formatTime}
              />
            </div>
          )}
        </header>
        {page === "today" && (
          <TodayPage
            data={data}
            updateDraft={(draft) => update({ draft })}
            taskText={taskText}
            setTaskText={setTaskText}
            addMoment={addMoment}
            addTask={addTask}
            changeMoment={changeMoment}
            changeTask={changeTask}
            deleteMoment={deleteMoment}
            deleteTask={deleteTask}
            changeCache={changeCache}
            deleteCache={deleteCache}
            sendCache={sendCache}
            sendRecord={sendRecord}
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
    </div>
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
  startFocus,
  formatTime,
}: {
  phase?: FocusPhase;
  remaining: number;
  focusMinutes: number;
  startFocus: () => void;
  formatTime: (seconds: number) => string;
}) {
  return (
    <section className="focus-control">
      <div className="focus-control-time">
        <Clock3 size={17} />
        <strong>{remaining ? formatTime(remaining) : `${focusMinutes}:00`}</strong>
      </div>
      <button className="dark-button" disabled={Boolean(phase)} onClick={startFocus}>
        {phase === "focusing"
          ? "专注进行中"
          : phase === "reflecting"
            ? "总结进行中"
            : phase === "locked"
              ? "锁定中"
              : "开始专注"}
      </button>
    </section>
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
