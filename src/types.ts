export type RecordStatus = "Idle" | "Focusing" | "Paused";

export type Task = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  status: RecordStatus;
  timeBlockId?: string;
  sentTo?: "moment" | "task";
  sentAt?: string;
};
export type Moment = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  status: RecordStatus;
  timeBlockId?: string;
  sentTo?: "moment" | "task";
  sentAt?: string;
};
export type WorkCache = {
  id: string;
  completed: string;
  pending: string;
  done: boolean;
  sentTo?: "moment" | "task";
  sentAt?: string;
  createdAt: string;
};
export type Settings = {
  focusMinutes: number;
  reflectionMinutes: number;
  lockMinutes: number;
  sound: boolean;
  volume: number;
  vaultPath: string;
};
export type FocusPhase = "focusing" | "paused" | "reflecting" | "locked";
export type FocusSession = {
  projectId: string;
  phase: FocusPhase;
  startedAt: string;
  endsAt: string;
  pausedRemainingMs?: number;
  extensionUsed?: boolean;
  focusEndsAt?: string;
  reflectionStartsAt?: string;
  reflectionEndsAt?: string;
};
export type AppData = {
  tasks: Task[];
  moments: Moment[];
  workCache: WorkCache[];
  draft: string;
  settings: Settings;
  focusSession: FocusSession | null;
  timeBlocks: import("./markdown").MarkdownTimeBlock[];
  timeBlocksDate: string;
};

export const defaultData: AppData = {
  tasks: [],
  moments: [],
  workCache: [],
  draft: "",
  focusSession: null,
  timeBlocks: [],
  timeBlocksDate: "",
  settings: {
    focusMinutes: 20,
    reflectionMinutes: 3,
    lockMinutes: 3,
    sound: true,
    volume: 55,
    vaultPath: "",
  },
};
