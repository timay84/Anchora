import { AppData, defaultData } from "./types";

const KEY = "anchora:data:v1";
export function loadData(): AppData {
  try {
    const stored = JSON.parse(
      localStorage.getItem(KEY) || "{}",
    ) as Partial<AppData>;
    return {
      ...defaultData,
      ...stored,
      moments: Array.isArray(stored.moments)
        ? stored.moments.map((moment) => {
            const { tags: _tags, ...cleanMoment } = moment as typeof moment & {
              tags?: string[];
            };
            return { ...cleanMoment, done: moment.done ?? false };
          })
        : [],
      tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
      workCache: Array.isArray(stored.workCache)
        ? stored.workCache.map((item) => ({
            ...item,
            done: item.done ?? Boolean(item.sentTo),
          }))
        : [],
      focusSession: stored.focusSession || null,
      settings: (() => {
        const { privacyLock: _privacyLock, ...cleanSettings } = (stored.settings || {}) as typeof defaultData.settings & {
          privacyLock?: boolean;
        };
        const settings = { ...defaultData.settings, ...cleanSettings };
        return {
          ...settings,
          focusMinutes: Math.max(settings.focusMinutes, settings.reflectionMinutes),
        };
      })(),
    };
  } catch {
    return defaultData;
  }
}
export function saveData(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}
