// Nexus shell library entry point. Wires the Tauri builder, registers the
// `ipc_call` command, and manages the Node sidecar lifecycle.

pub mod sidecar;

use serde_json::Value;
use sidecar::{Sidecar, SidecarHandle};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

pub struct AppState {
    pub sidecar: Mutex<Option<SidecarHandle>>,
}

#[tauri::command]
async fn ipc_call(
    state: tauri::State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let handle = {
        let guard = state.sidecar.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let Some(handle) = handle else {
        return Err("sidecar-not-running".to_string());
    };
    Sidecar::request(&handle, &method, params)
        .await
        .map_err(|e| e.to_string())
}

/// Force process-wide dark mode on Windows so native common dialogs (the file
/// pickers behind the Image/Video `<input type="file">`), context menus, and
/// scrollbars follow the app's dark theme -- consistent with the frameless dark
/// main window and the installer's dark chrome. A window's `set_theme(Dark)`
/// darkens only that window's title bar, not separate OS dialogs, hence this
/// app-level call at startup.
#[cfg(target_os = "windows")]
fn force_dark_app_mode() {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

    // uxtheme.dll ordinal 135 = SetPreferredAppMode (Windows 10 1809+); absent on
    // older builds, where GetProcAddress returns None and this no-ops.
    // PreferredAppMode::ForceDark = 2.
    unsafe {
        let module = LoadLibraryA(c"uxtheme.dll".as_ptr().cast());
        if module.is_null() {
            return;
        }
        if let Some(func) = GetProcAddress(module, 135 as *const u8) {
            let set_preferred_app_mode: extern "system" fn(i32) -> i32 =
                std::mem::transmute(func);
            let _ = set_preferred_app_mode(2);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn force_dark_app_mode() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    force_dark_app_mode();
    let builder = tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![ipc_call])
        .setup(|app| {
            // Window icon (title bar + taskbar): the transparent no-background
            // Nexus mark, deliberately distinct from the exe/Explorer icon
            // (the navy `nexus-ai-primary` embedded via bundle.icon). The
            // window icon defaults to the embedded exe icon, so we override it
            // here; the PNG is embedded at compile time (image-png feature).
            for window in app.webview_windows().values() {
                // Force-dark theme regardless of system preference.
                let _ = window.set_theme(Some(tauri::Theme::Dark));
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png"))
                {
                    let _ = window.set_icon(icon);
                }
            }
            // Spawn the Node sidecar; failure is non-fatal in dev (logged).
            match Sidecar::spawn(app.handle()) {
                Ok(handle) => {
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Ok(mut guard) = state.sidecar.lock() {
                            *guard = Some(handle);
                        }
                    }
                }
                Err(err) => {
                    eprintln!("[nexus-shell] sidecar failed to spawn: {err}");
                }
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("tauri context failed")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Ok(mut guard) = state.sidecar.lock() {
                        if let Some(handle) = guard.take() {
                            Sidecar::shutdown(handle);
                        }
                    }
                }
            }
        });
}
