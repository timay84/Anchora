export type Task = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  sentTo?: "moment" | "task";
  sentAt?: string;
};
export type Moment = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
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
export type FocusPhase = "focusing" | "reflecting" | "locked";
export type FocusSession = {
  phase: FocusPhase;
  startedAt: string;
  endsAt: string;
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
};

export const defaultData: AppData = {
  tasks: [],
  moments: [],
  workCache: [],
  draft: "",
  focusSession: null,
  settings: {
    focusMinutes: 17,
    reflectionMinutes: 3,
    lockMinutes: 3,
    sound: true,
    volume: 55,
    vaultPath: "",
  },
};
