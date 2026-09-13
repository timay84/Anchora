use serde::Serialize;
use std::fs;
use tauri::{menu::{MenuBuilder, MenuItemBuilder}, tray::TrayIconBuilder, AppHandle, Manager};

#[derive(Serialize)]
struct MonitorInfo { name: Option<String>, width: u32, height: u32, x: i32, y: i32 }

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
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn export_data(format: String, data: String, app: AppHandle) -> Result<String, String> {
    let directory = dirs::document_dir().ok_or("无法找到文档目录")?.join("Anchora");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let extension = if format == "csv" { "csv" } else { "md" };
    let path = directory.join(format!("anchora-export.{}", extension));
    fs::write(&path, data).map_err(|e| e.to_string())?;
    let _ = app; // Keep the command signature ready for a native save dialog.
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_monitors, show_focus_overlay, export_data])
        .setup(|app| {
            let show = MenuItemBuilder::with_id("show", "显示 Anchora").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            TrayIconBuilder::new().menu(&menu).tooltip("Anchora").on_menu_event(|app, event| match event.id.as_ref() {
                "show" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } }
                "quit" => app.exit(0),
                _ => {}
            }).build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Anchora");
}
