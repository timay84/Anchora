export type Task = { id: string; text: string; done: boolean; createdAt: string };
export type Moment = { id: string; text: string; tags: string[]; createdAt: string };
export type Settings = { focusMinutes: number; warningMinutes: number; finalSeconds: number; sound: boolean; volume: number; privacyLock: boolean };
export type AppData = { tasks: Task[]; moments: Moment[]; draft: string; settings: Settings };

export const defaultData: AppData = {
  tasks: [], moments: [], draft: '',
  settings: { focusMinutes: 20, warningMinutes: 2, finalSeconds: 10, sound: true, volume: 55, privacyLock: false },
};
