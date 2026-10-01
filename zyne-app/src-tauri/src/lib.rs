mod companion;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(companion::Companion::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            companion::companion_load, companion::companion_save,
            companion::ai_status, companion::ai_configure, companion::ai_chat,
            companion::lan_start, companion::lan_stop, companion::lan_poll,
            companion::lan_publish, companion::lan_request
        ])
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
