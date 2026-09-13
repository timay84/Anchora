use serde::Serialize;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct LockState(Mutex<bool>);

struct OverlayState { ends_at: Mutex<Option<String>> }

#[derive(Serialize)]
struct MonitorInfo { name: Option<String>, width: u32, height: u32, x: i32, y: i32 }

#[derive(Serialize)]
struct DailyNote { date: String, content: String, path: String }

fn daily_directory(vault_path: &str) -> PathBuf {
    PathBuf::from(vault_path).join("Anchora").join("Daily")
}

fn weekday(date: &str) -> &'static str {
    let parts = date.split('-').filter_map(|part| part.parse::<i32>().ok()).collect::<Vec<_>>();
    if parts.len() != 3 { return "日"; }
    let (mut year, month, day) = (parts[0], parts[1], parts[2]);
    let month = if month < 3 { year -= 1; month + 12 } else { month };
    let k = year % 100;
    let j = year / 100;
    let h = (day + (13 * (month + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
    ["六", "日", "一", "二", "三", "四", "五"][h as usize]
}

fn daily_file_name(date: &str) -> String { format!("{}(星期{}).md", date, weekday(date)) }

#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    app.available_monitors().map_err(|e| e.to_string()).map(|monitors| monitors.into_iter().map(|monitor| {
        let size = monitor.size();
        let position = monitor.position();
        MonitorInfo { name: monitor.name().map(|name| name.to_string()), width: size.width, height: size.height, x: position.x, y: position.y }
    }).collect())
}

#[tauri::command]
fn show_focus_overlay(app: AppHandle) -> Result<(), String> {
    // The first vertical slice uses one overlay; monitor enumeration is exposed for the multi-window phase.
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    if let Some(reflection) = window.app_handle().get_webview_window("reflection") {
        let _ = reflection.hide();
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_reflection_overlay(app: AppHandle, state: State<'_, OverlayState>, ends_at: String) -> Result<(), String> {
    let window = app.get_webview_window("reflection").ok_or("总结窗口不存在")?;
    *state.ends_at.lock().map_err(|_| "总结状态不可用")? = Some(ends_at.clone());
    // Keep the small transparent window interactive. The window only covers the
    // reflection content, so the surrounding desktop remains unaffected.
    window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("reflection", "reflection_started", serde_json::json!({ "endsAt": ends_at })).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_reflection_ends_at(state: State<'_, OverlayState>) -> Result<String, String> {
    state.ends_at.lock().map_err(|_| "总结状态不可用")?.clone().ok_or_else(|| "总结窗口尚未启动".to_string())
}

#[tauri::command]
fn complete_reflection(
    app: AppHandle,
    completed: String,
    pending: String,
    state: State<'_, OverlayState>,
    lock_state: State<'_, LockState>,
) -> Result<(), String> {
    *state.ends_at.lock().map_err(|_| "总结状态不可用")? = None;
    let window = app.get_webview_window("reflection").ok_or("总结窗口不存在")?;
    window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    // Lock immediately so this still works when the hidden main WebView is throttled.
    enter_focus_lock(app.clone(), lock_state)?;
    app.emit_to("main", "reflection_completed", serde_json::json!({ "completed": completed, "pending": pending })).map_err(|e| e.to_string())
}

#[tauri::command]
fn enter_focus_lock(app: AppHandle, state: State<'_, LockState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "锁定状态不可用")? = true;
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    if let Some(overlay) = window.app_handle().try_state::<OverlayState>() {
        if let Ok(mut ends_at) = overlay.ends_at.lock() { *ends_at = None; }
    }
    let _ = window.set_ignore_cursor_events(false);
    if let Some(reflection) = window.app_handle().get_webview_window("reflection") {
        let _ = reflection.hide();
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_focus_lock(app: AppHandle, state: State<'_, LockState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "锁定状态不可用")? = false;
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    if let Some(overlay) = window.app_handle().try_state::<OverlayState>() {
        if let Ok(mut ends_at) = overlay.ends_at.lock() { *ends_at = None; }
    }
    let _ = window.set_ignore_cursor_events(false);
    if let Some(reflection) = window.app_handle().get_webview_window("reflection") {
        let _ = reflection.hide();
    }
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_daily_notes(vault_path: String) -> Result<Vec<DailyNote>, String> {
    let directory = daily_directory(&vault_path);
    if !directory.exists() { return Ok(Vec::new()); }
    let mut notes = fs::read_dir(&directory).map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|extension| extension.to_str()) == Some("md"))
        .filter_map(|entry| {
            let path = entry.path();
            let date = path.file_stem()?.to_str()?.get(..10)?.to_owned();
            let content = fs::read_to_string(&path).ok()?;
            Some(DailyNote { date, content, path: path.to_string_lossy().into_owned() })
        })
        .collect::<Vec<_>>();
    notes.sort_by(|left, right| right.date.cmp(&left.date));
    Ok(notes)
}

#[tauri::command]
async fn write_daily_note(vault_path: String, date: String, content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = daily_directory(&vault_path);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let file_name = daily_file_name(&date);
        let path = directory.join(&file_name);
        fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _shortcut, event| {
            let locked = app.state::<LockState>().0.lock().map(|value| *value).unwrap_or(false);
            if locked && event.state == ShortcutState::Pressed {
                let _ = app.emit("emergency_exit", ());
            }
        }).build())
        .manage(LockState(Mutex::new(false)))
        .manage(OverlayState { ends_at: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![list_monitors, show_focus_overlay, show_reflection_overlay, get_reflection_ends_at, complete_reflection, enter_focus_lock, exit_focus_lock, read_daily_notes, write_daily_note])
        .setup(|app| {
            let emergency_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::F12);
            app.global_shortcut().register(emergency_shortcut)?;
            let show = MenuItemBuilder::with_id("show", "显示 Anchora").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let icon = app.default_window_icon().cloned().ok_or("应用图标未配置")?;
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Anchora")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if tray.app_handle().state::<LockState>().0.lock().map(|locked| *locked).unwrap_or(false) { return; }
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } }
                    "quit" => { if !app.state::<LockState>().0.lock().map(|locked| *locked).unwrap_or(false) { app.exit(0); } }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let locked = window.app_handle().state::<LockState>().0.lock().map(|value| *value).unwrap_or(false);
                if !locked { let _ = window.hide(); }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Anchora");
}
