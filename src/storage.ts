import { AppData, defaultData } from './types';

const KEY = 'anchora:data:v1';
export function loadData(): AppData {
  try { return { ...defaultData, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaultData; }
}
export function saveData(data: AppData) { localStorage.setItem(KEY, JSON.stringify(data)); }
