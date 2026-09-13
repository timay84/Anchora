import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Clock3, Hash, History, Leaf, Menu, Play, Plus, Settings, Sparkles, SquareCheckBig, X } from 'lucide-react';
import { defaultData, AppData } from './types';
import { loadData, saveData } from './storage';

type Page = 'today' | 'history' | 'settings';
const today = () => new Date().toISOString().slice(0, 10);

export function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [page, setPage] = useState<Page>('today');
  const [tag, setTag] = useState('全部');
  const [remaining, setRemaining] = useState(0);
  const [reminding, setReminding] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [menu, setMenu] = useState(false);
  useEffect(() => saveData(data), [data]);
  useEffect(() => { if (!remaining) return; const timer = window.setInterval(() => setRemaining(v => Math.max(0, v - 1)), 1000); return () => clearInterval(timer); }, [remaining]);
  useEffect(() => { if (remaining > 0 && remaining <= data.settings.warningMinutes * 60) setReminding(true); }, [remaining, data.settings.warningMinutes]);
  const tags = useMemo(() => ['全部', ...new Set(data.moments.flatMap(m => m.tags))], [data.moments]);
  const visibleMoments = data.moments.filter(m => tag === '全部' || m.tags.includes(tag));
  const update = (patch: Partial<AppData>) => setData(current => ({ ...current, ...patch }));
  const addMoment = () => { if (!data.draft.trim()) return; const tagsFound = data.draft.match(/#[\w\u4e00-\u9fff-]+/g)?.map(v => v.slice(1)) || []; update({ moments: [{ id: crypto.randomUUID(), text: data.draft.trim(), tags: tagsFound, createdAt: new Date().toISOString() }, ...data.moments], draft: '' }); };
  const addTask = () => { if (!taskText.trim()) return; update({ tasks: [{ id: crypto.randomUUID(), text: taskText.trim(), done: false, createdAt: new Date().toISOString() }, ...data.tasks] }); setTaskText(''); };
  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const startFocus = () => { setReminding(false); setRemaining(data.settings.focusMinutes * 60); void invoke('show_focus_overlay').catch(() => undefined); };

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Leaf size={18} /></span><span>anchora</span></div>
      <p className="eyebrow">你的专注港湾</p>
      <nav>{([['today', Sparkles, '今日'], ['history', History, '时间轴'], ['settings', Settings, '设置']] as const).map(([id, Icon, label]) => <button key={id} className={page === id ? 'nav-active' : ''} onClick={() => { setPage(id); setMenu(false); }}><Icon size={17} />{label}</button>)}</nav>
      <div className="focus-card"><p>下一次觉察</p><strong>{remaining ? formatTime(remaining) : '未安排'}</strong><button onClick={remaining ? () => setRemaining(0) : startFocus}>{remaining ? '结束专注' : <><Play size={14} fill="currentColor" />开始 20 分钟</>}</button></div>
      <p className="sidebar-footer">本地存储 · 私密安全</p>
    </aside>
    <main><header><button className="menu-button" onClick={() => setMenu(v => !v)}><Menu size={20} /></button><div><p className="date-label">{new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>{page === 'today' ? '在场，胜过完成。' : page === 'history' ? '回望你的轨迹。' : '调整你的节奏。'}</h1></div><div className="header-status"><span className="status-dot" />自动保存中</div></header>
      {page === 'today' && <section className="content-grid"><div className="main-column"><section className="panel diary-panel"><div className="section-heading"><div><span className="kicker">正念微日记</span><h2>今天，哪一个瞬间让你感到纯粹的充实、专注或者快乐？</h2></div><Sparkles size={21} className="muted-icon" /></div><textarea value={data.draft} onChange={e => update({ draft: e.target.value })} placeholder="记下这个瞬间，不必修饰……&#10;&#10;试试添加 #工作 #灵感 这样的标签" /><div className="composer-footer"><span><Hash size={14} /> {data.draft.match(/#[\w\u4e00-\u9fff-]+/g)?.length || 0} 个标签</span><button className="primary-button" onClick={addMoment}>收录瞬间 <Plus size={16} /></button></div></section><section className="panel task-panel"><div className="section-heading"><div><span className="kicker">日常事务</span><h2>今天完成了什么？</h2></div><SquareCheckBig size={21} className="muted-icon" /></div><div className="task-input"><input value={taskText} onChange={e => setTaskText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()} placeholder="添加一件小事……" /><button onClick={addTask}><Plus size={18} /></button></div><div className="task-list">{data.tasks.length === 0 && <p className="empty">从一件小事开始。</p>}{data.tasks.map(task => <label className={`task-row ${task.done ? 'task-done' : ''}`} key={task.id}><input type="checkbox" checked={task.done} onChange={() => update({ tasks: data.tasks.map(item => item.id === task.id ? { ...item, done: !item.done } : item) })} /><span>{task.text}</span><Check size={15} /></label>)}</div></section></div><aside className="right-column"><section className="panel timer-panel"><div className="timer-orbit"><Clock3 size={25} /><span>{remaining ? formatTime(remaining) : `${data.settings.focusMinutes}:00`}</span></div><p className="kicker">沉浸式觉察</p><h2>给自己一点<br /><em>不被打扰的时间。</em></h2><button className="dark-button" onClick={remaining ? () => setRemaining(0) : startFocus}>{remaining ? '结束本次专注' : '开始专注'} <span>→</span></button><p className="tiny">预警将在最后 {data.settings.warningMinutes} 分钟出现</p></section><section className="quote-card"><span>“</span><p>你不需要把每件事都做完，先好好在这里。</p></section></aside></section>}
      {page === 'history' && <section className="panel history-panel"><div className="filter-row">{tags.map(item => <button className={tag === item ? 'filter-active' : ''} onClick={() => setTag(item)} key={item}>{item === '全部' ? item : `#${item}`}</button>)}</div>{visibleMoments.length === 0 ? <p className="empty large-empty">还没有记录，今天就是很好的开始。</p> : visibleMoments.map(moment => <article className="moment-card" key={moment.id}><time>{new Date(moment.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</time><p className={data.settings.privacyLock ? 'blurred' : ''}>{moment.text}</p><div>{moment.tags.map(item => <span key={item}>#{item}</span>)}</div></article>)}</section>}
      {page === 'settings' && <SettingsPanel data={data} update={update} />}
    </main>
    {reminding && <div className="reminder-overlay"><div className="crack crack-one" /><div className="crack crack-two" /><button className="close-reminder" onClick={() => setReminding(false)}><X /></button><div className="reminder-content"><span className="kicker">觉察时刻 · {formatTime(remaining)}</span><h2>请总结已经完成的事<br />和还没完成的事。</h2><textarea placeholder="此刻，你注意到了什么？" autoFocus /><div><button className="snooze-button" onClick={() => { setRemaining(300); setReminding(false); }}>稍后处理 · 5 分钟</button><button className="primary-button" onClick={() => { setRemaining(0); setReminding(false); }}>结束本次专注</button></div></div></div>}
  </div>;
}

function SettingsPanel({ data, update }: { data: AppData; update: (patch: Partial<AppData>) => void }) {
  const settings = data.settings;
  const change = (patch: Partial<typeof settings>) => update({ settings: { ...settings, ...patch } });
  return <section className="panel settings-panel"><span className="kicker">偏好设置</span><h2>让 Anchora 适合你的节奏。</h2><div className="setting-group"><label>专注时长 <output>{settings.focusMinutes} 分钟</output></label><input type="range" min="5" max="90" step="5" value={settings.focusMinutes} onChange={e => change({ focusMinutes: +e.target.value })} /></div><div className="setting-group"><label>提前预警 <output>{settings.warningMinutes} 分钟</output></label><input type="range" min="1" max="10" value={settings.warningMinutes} onChange={e => change({ warningMinutes: +e.target.value })} /></div><div className="setting-row"><div><strong>提醒声音</strong><p>觉察时刻播放温和提示音</p></div><input type="checkbox" checked={settings.sound} onChange={e => change({ sound: e.target.checked })} /></div><div className="setting-row"><div><strong>隐藏敏感内容</strong><p>历史回顾中的文字将保持模糊</p></div><input type="checkbox" checked={settings.privacyLock} onChange={e => change({ privacyLock: e.target.checked })} /></div><button className="export-button" onClick={() => void invoke('export_data', { format: 'markdown', data: JSON.stringify(data) }).catch(() => undefined)}>导出我的数据 · Markdown</button></section>;
}
