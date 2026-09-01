// Nexus shell library entry point. Wires the Tauri builder, registers the
// `ipc_call` / `sidecar_status` / `sidecar_restart` commands, and manages the
// Node sidecar lifecycle.
//
// v2.2.0 Phase 1: spawn failures are captured in a queryable `SidecarStatus`
// (1.2), and a `--healthcheck` CLI mode spawns the sidecar headless, issues
// real RPCs, prints a single JSON verdict to stdout, and exits nonzero on
// failure so the installer can prove the app actually works (1.4).

pub mod sidecar;

use serde_json::{json, Value};
use sidecar::{
    last_stderr_lines, resolve_node, runtime_config_path, Sidecar, SidecarError, SidecarHandle,
    SidecarStatus, HEALTHCHECK_STDERR_LINES,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

pub struct AppState {
    pub sidecar: Mutex<Option<SidecarHandle>>,
    pub status: Mutex<SidecarStatus>,
    pub restarting: AtomicBool,
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

/// Refresh liveness + stderr tail into the stored status, then return it.
fn refreshed_status(state: &AppState) -> SidecarStatus {
    let handle = state.sidecar.lock().ok().and_then(|guard| guard.clone());
    let mut status = state.status.lock().map(|s| s.clone()).unwrap_or_default();
    if let Some(handle) = handle {
        status.stderr_tail = handle.stderr_tail();
        match handle.try_exit_code() {
            Ok(None) => status.running = true,
            Ok(Some(code)) => {
                status.running = false;
                status.exit_code = Some(code);
                status.failure = Some(format!("sidecar-exited:{code}"));
            }
            Err(e) => {
                status.running = false;
                status.failure = Some(format!("sidecar-unprobeable: {e}"));
            }
        }
    } else {
        status.running = false;
        if status.failure.is_none() {
            status.failure = Some("sidecar-not-running".to_string());
        }
    }
    if let Ok(mut stored) = state.status.lock() {
        *stored = status.clone();
    }
    status
}

#[tauri::command]
fn sidecar_status(state: tauri::State<'_, AppState>) -> SidecarStatus {
    refreshed_status(&state)
}

/// Restart the sidecar (single-flight: concurrent calls beyond the first get
/// `restart-in-progress`). Used by the frontend's sidecar-down banner.
#[tauri::command]
fn sidecar_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SidecarStatus, String> {
    if state
        .restarting
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("restart-in-progress".to_string());
    }
    let result = restart_sidecar_locked(&app, &state);
    state.restarting.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn canonicalize_workspace_roots(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > 32 {
        return Err("select between 1 and 32 workspace directories".to_string());
    }
    let mut canonical = Vec::with_capacity(paths.len());
    let mut seen = std::collections::HashSet::new();
    for raw in paths {
        let candidate = std::path::PathBuf::from(&raw);
        if !candidate.is_absolute() {
            return Err(format!("workspace directory must be absolute: {raw}"));
        }
        let resolved = std::fs::canonicalize(&candidate)
            .map_err(|error| format!("workspace directory is unavailable ({raw}): {error}"))?;
        if !resolved.is_dir() {
            return Err(format!("workspace path is not a directory: {raw}"));
        }
        let display = native_display_path(&resolved);
        let key = if cfg!(windows) {
            display.to_lowercase()
        } else {
            display.clone()
        };
        if seen.insert(key) {
            canonical.push(display);
        }
    }
    Ok(canonical)
}

#[tauri::command]
fn default_workspace_root() -> Result<String, String> {
    let raw = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or_else(|| "the operating-system home directory is unavailable".to_string())?;
    let resolved = std::fs::canonicalize(std::path::PathBuf::from(raw))
        .map_err(|error| format!("the operating-system home directory is unavailable: {error}"))?;
    if !resolved.is_dir() {
        return Err("the operating-system home path is not a directory".to_string());
    }
    Ok(native_display_path(&resolved))
}

fn native_display_path(path: &std::path::Path) -> String {
    let value = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return local.to_string();
        }
    }
    value
}

/// The restart body, factored out so the single-flight flag reset in
/// `sidecar_restart` wraps exactly one call.
fn restart_sidecar_locked(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<SidecarStatus, String> {
    // Tear down the old child first so we never run two sidecars.
    if let Ok(mut guard) = state.sidecar.lock() {
        if let Some(old) = guard.take() {
            Sidecar::shutdown(old);
        }
    }
    match Sidecar::spawn(app) {
        Ok((handle, status)) => {
            if let Ok(mut guard) = state.sidecar.lock() {
                *guard = Some(handle);
            }
            if let Ok(mut stored) = state.status.lock() {
                *stored = status.clone();
            }
            Ok(status)
        }
        Err(err) => {
            let mut status = state.status.lock().map(|s| s.clone()).unwrap_or_default();
            status.running = false;
            status.failure = Some(err.to_string());
            if let SidecarError::Exited { code, .. } = &err {
                status.exit_code = Some(*code);
            }
            if let Ok(mut stored) = state.status.lock() {
                *stored = status.clone();
            }
            Err(err.to_string())
        }
    }
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
            let set_preferred_app_mode: extern "system" fn(i32) -> i32 = std::mem::transmute(func);
            let _ = set_preferred_app_mode(2);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn force_dark_app_mode() {}

/// `--healthcheck` mode (v2.2.0 Phase 1, 1.4): spawn the sidecar exactly as the
/// app would (same script + node resolution), issue `models.list` and
/// `skills.status` with retry/backoff inside `budget_secs`, print ONE JSON
/// verdict line to stdout, and return the process exit code. No window opens.
pub fn run_healthcheck(budget_secs: u64) -> i32 {
    let script = Sidecar::script_path_without_app();
    let node = resolve_node(runtime_config_path().as_deref());
    let spawned = Sidecar::spawn_with(&script, &node);
    let (handle, status) = match spawned {
        Ok(pair) => pair,
        Err(err) => {
            let (exit_code, stderr_tail) = match &err {
                SidecarError::Exited { code, stderr_tail } => (
                    Some(*code),
                    last_stderr_lines(stderr_tail, HEALTHCHECK_STDERR_LINES),
                ),
                _ => (None, Vec::new()),
            };
            let verdict = json!({
                "sidecar": format!("fail: {err}"),
                "exitCode": exit_code,
                "nodePath": node.path.display().to_string(),
                "scriptPath": script.display().to_string(),
                "candidatesRejected": node.rejected,
                "stderrTail": stderr_tail,
                "catalogRows": 0,
                "hubCatalog": "unknown",
            });
            println!("{verdict}");
            return 1;
        }
    };

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            println!(
                "{}",
                json!({ "sidecar": format!("fail: tokio runtime: {e}"), "catalogRows": 0 })
            );
            return 1;
        }
    };

    let outcome = rt.block_on(async {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(budget_secs);
        let mut backoff = std::time::Duration::from_millis(500);
        loop {
            let attempt_err = match Sidecar::request(&handle, "models.list", json!({})).await {
                Ok(models_reply) => {
                    let catalog_rows = models_reply
                        .get("models")
                        .and_then(|m| m.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    let catalog_status = models_reply
                        .get("catalogStatus")
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let hub = match Sidecar::request(&handle, "skills.status", json!({})).await {
                        Ok(reply) => {
                            if reply
                                .get("catalogPresent")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false)
                            {
                                "present".to_string()
                            } else {
                                "absent".to_string()
                            }
                        }
                        Err(e) => format!("unknown ({e})"),
                    };
                    return Ok((catalog_rows, catalog_status, hub));
                }
                Err(e) => e.to_string(),
            };
            if std::time::Instant::now() >= deadline {
                return Err(attempt_err);
            }
            // A dead child will never answer; do not retry into a closed pipe.
            if handle.try_exit_code().ok().flatten().is_some() {
                return Err(attempt_err);
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(std::time::Duration::from_secs(4));
        }
    });

    let stderr_tail = last_stderr_lines(&handle.stderr_tail(), HEALTHCHECK_STDERR_LINES);
    let exit_code = handle.try_exit_code().ok().flatten();
    let (verdict, code) = match outcome {
        Ok((catalog_rows, catalog_status, hub)) => (
            json!({
                "sidecar": "ok",
                "exitCode": exit_code,
                "nodePath": status.node_path,
                "scriptPath": status.script_path,
                "stderrTail": stderr_tail,
                "catalogRows": catalog_rows,
                "catalogStatus": catalog_status,
                "hubCatalog": hub,
            }),
            0,
        ),
        Err(reason) => (
            json!({
                "sidecar": format!("fail: {reason}"),
                "exitCode": exit_code,
                "nodePath": status.node_path,
                "scriptPath": status.script_path,
                "stderrTail": stderr_tail,
                "catalogRows": 0,
                "hubCatalog": "unknown",
            }),
            1,
        ),
    };
    println!("{verdict}");
    Sidecar::shutdown(handle);
    code
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless health check: never build a window, print a verdict, exit.
    if std::env::args().any(|a| a == "--healthcheck") {
        std::process::exit(run_healthcheck(25));
    }

    force_dark_app_mode();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            sidecar: Mutex::new(None),
            status: Mutex::new(SidecarStatus::default()),
            restarting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            ipc_call,
            sidecar_status,
            sidecar_restart,
            canonicalize_workspace_roots,
            default_workspace_root
        ])
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
            // Spawn the Node sidecar; failure is captured in AppState.status so
            // the frontend can render the reason (never only a stderr line).
            match Sidecar::spawn(app.handle()) {
                Ok((handle, status)) => {
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Ok(mut guard) = state.sidecar.lock() {
                            *guard = Some(handle);
                        }
                        if let Ok(mut stored) = state.status.lock() {
                            *stored = status;
                        }
                    }
                }
                Err(err) => {
                    eprintln!("[nexus-shell] sidecar failed to spawn: {err}");
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Ok(mut stored) = state.status.lock() {
                            stored.running = false;
                            stored.failure = Some(err.to_string());
                        }
                    }
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

#[cfg(test)]
mod workspace_tests {
    use super::default_workspace_root;

    #[test]
    fn default_workspace_root_is_an_existing_absolute_directory() {
        let root = default_workspace_root().expect("home directory should resolve");
        let path = std::path::PathBuf::from(root);
        assert!(path.is_absolute());
        assert!(path.is_dir());
    }
}
