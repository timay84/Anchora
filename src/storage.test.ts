import { beforeEach, describe, expect, it } from 'vitest';
import { defaultData } from './types';
import { loadData, saveData } from './storage';

describe('Anchora local persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns safe defaults when no draft exists', () => {
    expect(loadData()).toEqual(defaultData);
  });

  it('round-trips draft and settings without losing other defaults', () => {
    saveData({ ...defaultData, draft: '一个值得记住的瞬间', settings: { ...defaultData.settings, focusMinutes: 35 } });
    const result = loadData();
    expect(result.draft).toBe('一个值得记住的瞬间');
    expect(result.settings.focusMinutes).toBe(35);
    expect(result.settings.sound).toBe(true);
  });

  it('recovers from malformed local data', () => {
    localStorage.setItem('anchora:data:v1', '{bad json');
    expect(loadData()).toEqual(defaultData);
  });
});
