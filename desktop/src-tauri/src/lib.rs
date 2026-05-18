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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![ipc_call])
        .setup(|app| {
            // Force-dark theme regardless of system preference.
            for window in app.webview_windows().values() {
                let _ = window.set_theme(Some(tauri::Theme::Dark));
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
