// Node sidecar process spawner.
//
// Launches `desktop/sidecar/dist/main.js` as a child process at app launch and
// shuts it down on app quit. Communication is line-delimited JSON-RPC 2.0 over
// the child's stdin/stdout. The actual JSON-RPC plumbing lives in this module
// behind a small `request()` helper; the frontend reaches it through the
// `ipc_call` Tauri command.
//
// v2.2.0 Phase 1 (1.2): the spawner no longer depends on a system `node` on
// PATH. Node resolution walks an explicit chain (NEXUS_NODE_PATH -> the
// installer-written ~/.nexus/runtime.json -> the per-OS provisioned runtime
// path -> PATH `node` as a dev fallback), the child's stderr is drained into a
// bounded ring buffer (an undrained pipe eventually blocks the child), and the
// spawn outcome is captured in a serializable `SidecarStatus` the frontend can
// query via the `sidecar_status` command.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tokio::sync::oneshot;

/// Max stderr lines retained for diagnostics.
const STDERR_TAIL_LINES: usize = 50;
/// Lines included in the installer `--healthcheck` verdict JSON.
pub const HEALTHCHECK_STDERR_LINES: usize = 20;
/// Wait this long for the child to either print a ready line or stay alive.
const LIVENESS_WAIT: Duration = Duration::from_millis(500);
const LIVENESS_POLL: Duration = Duration::from_millis(25);
/// Sidecar prints this on stderr after stdin is wired (v2.2.1).
const READY_MARKER: &str = "[nexus-sidecar] ready";

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("sidecar binary not found at {0}")]
    NotFound(PathBuf),
    #[error("sidecar spawn failed: {0}")]
    Spawn(String),
    #[error("sidecar request error: {0}")]
    Request(String),
    #[error("sidecar response timeout")]
    Timeout,
    /// Child started then exited before (or instead of) answering RPC.
    /// Display is `sidecar-exited:<code>` so the Complete page can print it
    /// without wrapping a Windows 232 broken-pipe error around a dead stdin.
    #[error("sidecar-exited:{code}")]
    Exited {
        code: i32,
        stderr_tail: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'a str,
    id: u64,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i32,
    message: String,
}

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;
type StderrTail = Arc<Mutex<VecDeque<String>>>;

/// How the node executable was chosen. Serialized into `SidecarStatus`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NodeSource {
    EnvOverride,
    RuntimeConfig,
    ProvisionedDefault,
    PathFallback,
}

/// Outcome of the node resolution chain.
#[derive(Debug, Clone)]
pub struct NodeResolution {
    pub path: PathBuf,
    pub source: NodeSource,
    /// Candidates that were considered but rejected, with the reason.
    pub rejected: Vec<String>,
}

/// Serializable spawn/runtime status for the `sidecar_status` command and the
/// installer's `--healthcheck` verdict.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    pub node_path: Option<String>,
    pub node_source: Option<String>,
    pub script_path: Option<String>,
    pub failure: Option<String>,
    pub stderr_tail: Vec<String>,
    pub candidates_rejected: Vec<String>,
    /// Set when the child has already exited. `None` while it is still running.
    pub exit_code: Option<i32>,
}

/// The subset of `~/.nexus/runtime.json` the shell reads (installer contract,
/// v2.2.0 Phase 1). Unknown fields are ignored so the installer can extend it.
#[derive(Debug, Deserialize)]
struct RuntimeConfig {
    #[serde(rename = "nodePath")]
    node_path: Option<String>,
}

/// `~/.nexus/runtime.json` -- the installer-written runtime contract.
pub fn runtime_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".nexus").join("runtime.json"))
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Per-OS path the installer's node_provisioner writes the portable Node to.
/// Mirrors `scripts/installer/src/nexus_installer/engine/node_provisioner.py`.
pub fn provisioned_node_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(home_dir)
            .map(|base| base.join("Nexus").join("runtime").join("node").join("node.exe"))
    }
    #[cfg(target_os = "macos")]
    {
        home_dir().map(|h| {
            h.join("Library")
                .join("Application Support")
                .join("Nexus")
                .join("runtime")
                .join("node")
                .join("bin")
                .join("node")
        })
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        home_dir().map(|h| {
            h.join(".local")
                .join("share")
                .join("nexus")
                .join("runtime")
                .join("node")
                .join("bin")
                .join("node")
        })
    }
}

/// Resolve the Node executable. Chain (first hit wins):
/// 1. `NEXUS_NODE_PATH` env override (must exist).
/// 2. `nodePath` from the installer-written runtime config (must exist).
/// 3. The per-OS provisioned runtime path (must exist).
/// 4. Bare `node` from PATH (dev fallback; existence checked at spawn).
pub fn resolve_node(runtime_config: Option<&Path>) -> NodeResolution {
    let mut rejected: Vec<String> = Vec::new();

    if let Some(raw) = std::env::var_os("NEXUS_NODE_PATH") {
        let p = PathBuf::from(&raw);
        if p.is_file() {
            return NodeResolution {
                path: p,
                source: NodeSource::EnvOverride,
                rejected,
            };
        }
        rejected.push(format!("NEXUS_NODE_PATH not a file: {}", p.display()));
    }

    if let Some(cfg_path) = runtime_config {
        match std::fs::read_to_string(cfg_path) {
            Ok(body) => match serde_json::from_str::<RuntimeConfig>(&body) {
                Ok(cfg) => {
                    if let Some(node) = cfg.node_path {
                        let p = PathBuf::from(&node);
                        if p.is_file() {
                            return NodeResolution {
                                path: p,
                                source: NodeSource::RuntimeConfig,
                                rejected,
                            };
                        }
                        rejected.push(format!(
                            "runtime.json nodePath not a file: {}",
                            p.display()
                        ));
                    } else {
                        rejected.push("runtime.json has no nodePath".to_string());
                    }
                }
                Err(e) => rejected.push(format!("runtime.json parse error: {e}")),
            },
            Err(_) => rejected.push(format!("runtime.json not readable: {}", cfg_path.display())),
        }
    } else {
        rejected.push("no home dir; runtime.json unresolvable".to_string());
    }

    if let Some(p) = provisioned_node_path() {
        if p.is_file() {
            return NodeResolution {
                path: p,
                source: NodeSource::ProvisionedDefault,
                rejected,
            };
        }
        rejected.push(format!("provisioned node not found: {}", p.display()));
    }

    NodeResolution {
        path: PathBuf::from("node"),
        source: NodeSource::PathFallback,
        rejected,
    }
}

#[derive(Clone)]
pub struct SidecarHandle {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    next_id: Arc<AtomicU64>,
    pending: PendingMap,
    stderr_tail: StderrTail,
}

impl SidecarHandle {
    /// Last captured stderr lines (bounded ring buffer).
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr_tail
            .lock()
            .map(|d| d.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Non-blocking liveness probe. Returns `Ok(None)` while running, the exit
    /// code once the child has died, and an error string when unprobeable.
    pub fn try_exit_code(&self) -> Result<Option<i32>, String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        let Some(child) = guard.as_mut() else {
            return Err("child-already-taken".to_string());
        };
        match child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.code().unwrap_or(-1))),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

pub struct Sidecar;

impl Sidecar {
    /// Resolve the bundled sidecar script path. In production the script ships
    /// in the resource bundle (`bundle.resources` maps `../sidecar/dist` to
    /// `sidecar/dist`); in dev we walk relative to the working directory.
    pub fn script_path(app: &AppHandle) -> PathBuf {
        if let Ok(resolved) = app.path().resolve(
            "sidecar/dist/main.js",
            tauri::path::BaseDirectory::Resource,
        ) {
            if resolved.exists() {
                return resolved;
            }
        }
        Self::script_path_without_app()
    }

    /// Script resolution that needs no `AppHandle` -- used by the
    /// `--healthcheck` mode, which runs before any Tauri window exists. Checks
    /// next to the exe (where the NSIS/`.app` resource dir lands), then the dev
    /// working-directory fallbacks.
    pub fn script_path_without_app() -> PathBuf {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("sidecar/dist/main.js"));
                // macOS .app layout: Contents/MacOS/<exe> with resources in
                // Contents/Resources.
                candidates.push(dir.join("../Resources/sidecar/dist/main.js"));
            }
        }
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        candidates.push(cwd.join("sidecar/dist/main.js"));
        candidates.push(cwd.join("../sidecar/dist/main.js"));
        candidates.push(cwd.join("../../desktop/sidecar/dist/main.js"));
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        candidates
            .first()
            .cloned()
            .unwrap_or_else(|| PathBuf::from("sidecar/dist/main.js"))
    }

    pub fn spawn(app: &AppHandle) -> Result<(SidecarHandle, SidecarStatus), SidecarError> {
        let script = Self::script_path(app);
        Self::spawn_with(&script, &resolve_node(runtime_config_path().as_deref()))
    }

    /// Spawn against an explicit script + node resolution. Shared by the app
    /// setup path and the `--healthcheck` mode.
    pub fn spawn_with(
        script: &Path,
        node: &NodeResolution,
    ) -> Result<(SidecarHandle, SidecarStatus), SidecarError> {
        let mut status = SidecarStatus {
            running: false,
            node_path: Some(node.path.display().to_string()),
            node_source: Some(
                serde_json::to_value(&node.source)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default(),
            ),
            script_path: Some(script.display().to_string()),
            failure: None,
            stderr_tail: Vec::new(),
            candidates_rejected: node.rejected.clone(),
            exit_code: None,
        };
        if !script.exists() {
            status.failure = Some(format!("script-not-found: {}", script.display()));
            return Err(SidecarError::NotFound(script.to_path_buf()));
        }
        // v2.2.1: native addons (better-sqlite3) resolve from cwd + the
        // script directory. A Windows GUI parent often has cwd = System32,
        // so Node started then died at `require('better-sqlite3')` and the
        // next JSON-RPC write hit a closed pipe (ERROR_NO_DATA 232).
        // v2.2.2: CREATE_NO_WINDOW so console-subsystem node.exe does not
        // allocate a CMD the user can close (STATUS_CONTROL_C_EXIT).
        let mut command = sidecar_command(&node.path, script);
        let mut child = command
            .spawn()
            .map_err(|e| SidecarError::Spawn(format!("{} ({})", e, node.path.display())))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SidecarError::Spawn("missing stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::Spawn("missing stdout".to_string()))?;

        let stderr_tail: StderrTail = Arc::new(Mutex::new(VecDeque::new()));
        if let Some(stderr) = child.stderr.take() {
            let tail = stderr_tail.clone();
            // Drain stderr continuously: an undrained pipe fills its OS buffer
            // and blocks the sidecar's writes (a silent production deadlock).
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if let Ok(mut deque) = tail.lock() {
                        if deque.len() >= STDERR_TAIL_LINES {
                            deque.pop_front();
                        }
                        deque.push_back(line);
                    }
                }
            });
        }

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        Self::spawn_reader(stdout, pending.clone());

        status.running = true;
        let handle = SidecarHandle {
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            next_id: Arc::new(AtomicU64::new(1)),
            pending,
            stderr_tail,
        };
        if let Err(err) = wait_until_ready(&handle, LIVENESS_WAIT) {
            status.running = false;
            status.failure = Some(err.to_string());
            status.stderr_tail = handle.stderr_tail();
            if let SidecarError::Exited { code, .. } = &err {
                status.exit_code = Some(*code);
            }
            Sidecar::shutdown(handle);
            return Err(err);
        }
        status.stderr_tail = handle.stderr_tail();
        Ok((handle, status))
    }

    fn spawn_reader(stdout: ChildStdout, pending: PendingMap) {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { continue };
                if line.trim().is_empty() {
                    continue;
                }
                let parsed: Result<JsonRpcResponse, _> = serde_json::from_str(&line);
                let Ok(resp) = parsed else { continue };
                let Some(id) = resp.id else { continue };
                let sender = {
                    let mut map = match pending.lock() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    map.remove(&id)
                };
                if let Some(sender) = sender {
                    let payload = match resp.error {
                        Some(err) => Err(err.message),
                        None => Ok(resp.result.unwrap_or(Value::Null)),
                    };
                    let _ = sender.send(payload);
                }
            }
        });
    }

    pub async fn request(
        handle: &SidecarHandle,
        method: &str,
        params: Value,
    ) -> Result<Value, SidecarError> {
        // Never write JSON-RPC to a child that has already exited: that is
        // the 2026-08-22 Complete-page 232 (ERROR_NO_DATA on a closed pipe).
        match handle.try_exit_code() {
            Ok(Some(code)) => {
                return Err(SidecarError::Exited {
                    code,
                    stderr_tail: handle.stderr_tail(),
                });
            }
            Ok(None) => {}
            Err(e) => return Err(SidecarError::Request(e)),
        }
        let id = handle.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = handle
                .pending
                .lock()
                .map_err(|e| SidecarError::Request(e.to_string()))?;
            map.insert(id, tx);
        }
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let line = serde_json::to_string(&req)
            .map_err(|e| SidecarError::Request(e.to_string()))?;
        {
            let mut guard = handle
                .stdin
                .lock()
                .map_err(|e| SidecarError::Request(e.to_string()))?;
            let Some(stdin) = guard.as_mut() else {
                return Err(SidecarError::Request("stdin-closed".to_string()));
            };
            writeln!(stdin, "{line}").map_err(|e| {
                match handle.try_exit_code() {
                    Ok(Some(code)) => SidecarError::Exited {
                        code,
                        stderr_tail: handle.stderr_tail(),
                    },
                    _ => SidecarError::Request(e.to_string()),
                }
            })?;
            stdin.flush().map_err(|e| {
                match handle.try_exit_code() {
                    Ok(Some(code)) => SidecarError::Exited {
                        code,
                        stderr_tail: handle.stderr_tail(),
                    },
                    _ => SidecarError::Request(e.to_string()),
                }
            })?;
        }

        match tokio::time::timeout(Duration::from_secs(15), rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(msg))) => Err(SidecarError::Request(msg)),
            Ok(Err(_)) => Err(SidecarError::Request("channel-dropped".to_string())),
            Err(_) => {
                if let Ok(mut map) = handle.pending.lock() {
                    map.remove(&id);
                }
                Err(SidecarError::Timeout)
            }
        }
    }

    pub fn shutdown(handle: SidecarHandle) {
        if let Ok(mut guard) = handle.stdin.lock() {
            guard.take();
        }
        if let Ok(mut guard) = handle.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Working directory for the Node child: the directory that contains `main.js`
/// (and `node_modules/better-sqlite3`).
pub fn spawn_cwd(script: &Path) -> Option<PathBuf> {
    script.parent().map(|p| p.to_path_buf())
}

/// Windows CREATE_NO_WINDOW. Hides the Node console. Never combine with
/// DETACHED_PROCESS (0x00000008); that breaks piped stdin/stdout JSON-RPC.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Process creation flags for the sidecar child. `None` on non-Windows.
pub fn sidecar_windows_creation_flags() -> Option<u32> {
    #[cfg(windows)]
    {
        Some(CREATE_NO_WINDOW)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Shared Command builder for app spawn, restart, and `--healthcheck`.
pub fn sidecar_command(node: &Path, script: &Path) -> Command {
    let mut command = Command::new(node);
    command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = spawn_cwd(script) {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Last `n` stderr lines for a healthcheck verdict (empty fragments kept so
/// the installer can skip them; the formatter must not join blanks with `" / "`).
pub fn last_stderr_lines(lines: &[String], n: usize) -> Vec<String> {
    if lines.len() <= n {
        return lines.to_vec();
    }
    lines[lines.len() - n..].to_vec()
}

/// After spawn: the child must still be running (or have printed ready) before
/// anyone writes JSON-RPC. A death during import (native addon, catalog) is
/// `sidecar-exited:<code>` plus the stderr tail, never a 232 broken pipe.
fn wait_until_ready(handle: &SidecarHandle, timeout: Duration) -> Result<(), SidecarError> {
    let deadline = Instant::now() + timeout;
    loop {
        match handle.try_exit_code() {
            Ok(Some(code)) => {
                // Let the drain thread copy the last stack lines.
                thread::sleep(Duration::from_millis(50));
                return Err(SidecarError::Exited {
                    code,
                    stderr_tail: handle.stderr_tail(),
                });
            }
            Ok(None) => {
                if handle
                    .stderr_tail()
                    .iter()
                    .any(|l| l.contains(READY_MARKER))
                {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Ok(());
                }
            }
            Err(e) => return Err(SidecarError::Spawn(e)),
        }
        thread::sleep(LIVENESS_POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Tests below mutate the process-wide NEXUS_NODE_PATH; serialize them.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct EnvGuard(&'static str, Option<std::ffi::OsString>);
    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let prev = std::env::var_os(key);
            std::env::set_var(key, value);
            EnvGuard(key, prev)
        }
        fn unset(key: &'static str) -> Self {
            let prev = std::env::var_os(key);
            std::env::remove_var(key);
            EnvGuard(key, prev)
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    #[test]
    fn resolve_node_prefers_env_override_when_file_exists() {
        let _lock = env_lock();
        let dir = std::env::temp_dir().join("nexus-test-node-env");
        fs::create_dir_all(&dir).unwrap();
        let fake_node = dir.join("node.exe");
        fs::write(&fake_node, b"stub").unwrap();
        let _g = EnvGuard::set("NEXUS_NODE_PATH", &fake_node);
        let res = resolve_node(None);
        assert_eq!(res.source, NodeSource::EnvOverride);
        assert_eq!(res.path, fake_node);
    }

    #[test]
    fn resolve_node_uses_runtime_config_node_path() {
        let _lock = env_lock();
        let _g = EnvGuard::unset("NEXUS_NODE_PATH");
        let dir = std::env::temp_dir().join("nexus-test-node-cfg");
        fs::create_dir_all(&dir).unwrap();
        let fake_node = dir.join("node-from-config.exe");
        fs::write(&fake_node, b"stub").unwrap();
        let cfg = dir.join("runtime.json");
        fs::write(
            &cfg,
            serde_json::to_string(&serde_json::json!({
                "schemaVersion": 1,
                "nodePath": fake_node.to_string_lossy(),
            }))
            .unwrap(),
        )
        .unwrap();
        let res = resolve_node(Some(&cfg));
        assert_eq!(res.source, NodeSource::RuntimeConfig);
        assert_eq!(res.path, fake_node);
    }

    #[test]
    fn resolve_node_reports_stale_runtime_config_and_falls_through() {
        let _lock = env_lock();
        let _g = EnvGuard::unset("NEXUS_NODE_PATH");
        let dir = std::env::temp_dir().join("nexus-test-node-stale");
        fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("runtime.json");
        fs::write(
            &cfg,
            r#"{"schemaVersion":1,"nodePath":"Z:/definitely/not/here/node.exe"}"#,
        )
        .unwrap();
        let res = resolve_node(Some(&cfg));
        // Falls through to provisioned-default or PATH depending on machine;
        // either way the stale config is recorded as rejected.
        assert!(res
            .rejected
            .iter()
            .any(|r| r.contains("nodePath not a file")));
        assert_ne!(res.source, NodeSource::RuntimeConfig);
    }

    #[test]
    fn resolve_node_handles_corrupt_runtime_config() {
        let _lock = env_lock();
        let _g = EnvGuard::unset("NEXUS_NODE_PATH");
        let dir = std::env::temp_dir().join("nexus-test-node-corrupt");
        fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("runtime.json");
        fs::write(&cfg, b"{not json").unwrap();
        let res = resolve_node(Some(&cfg));
        assert!(res.rejected.iter().any(|r| r.contains("parse error")));
        assert_ne!(res.source, NodeSource::RuntimeConfig);
    }

    #[test]
    fn resolve_node_path_fallback_is_bare_node() {
        let _lock = env_lock();
        let _g = EnvGuard::unset("NEXUS_NODE_PATH");
        let dir = std::env::temp_dir().join("nexus-test-node-missingcfg");
        fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("does-not-exist.json");
        let res = resolve_node(Some(&cfg));
        if res.source == NodeSource::PathFallback {
            assert_eq!(res.path, PathBuf::from("node"));
            assert!(!res.rejected.is_empty());
        }
        // On a machine with a provisioned Node the chain legitimately stops
        // earlier; the assertion above only pins the fallback branch.
    }

    #[test]
    fn spawn_with_missing_script_reports_not_found() {
        let node = NodeResolution {
            path: PathBuf::from("node"),
            source: NodeSource::PathFallback,
            rejected: vec![],
        };
        let missing = std::env::temp_dir().join("nexus-test-missing/main.js");
        match Sidecar::spawn_with(&missing, &node) {
            Err(SidecarError::NotFound(p)) => assert_eq!(p, missing),
            Err(other) => panic!("expected NotFound, got {other:?}"),
            Ok(_) => panic!("expected NotFound, got Ok"),
        }
    }

    #[test]
    fn sidecar_status_serializes_camel_case() {
        let status = SidecarStatus {
            running: false,
            node_path: Some("node".into()),
            node_source: Some("path-fallback".into()),
            script_path: None,
            failure: Some("script-not-found: x".into()),
            stderr_tail: vec!["boom".into()],
            candidates_rejected: vec![],
            exit_code: Some(1),
        };
        let s = serde_json::to_string(&status).unwrap();
        assert!(s.contains("\"nodePath\""));
        assert!(s.contains("\"stderrTail\""));
        assert!(s.contains("\"exitCode\":1"));
        assert!(s.contains("script-not-found"));
    }

    #[test]
    fn spawn_cwd_is_the_script_parent() {
        let script = PathBuf::from("C:/Nexus/sidecar/dist/main.js");
        let cwd = spawn_cwd(&script).expect("parent");
        assert_eq!(cwd, PathBuf::from("C:/Nexus/sidecar/dist"));
    }

    #[test]
    fn spawn_helper_applies_create_no_window_on_windows() {
        // DETACHED_PROCESS would break JSON-RPC pipes; CREATE_NO_WINDOW is the
        // only extra Windows flag the spawn helper is allowed to set.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let flags = sidecar_windows_creation_flags();
        #[cfg(windows)]
        {
            assert_eq!(flags, Some(0x0800_0000));
            assert_eq!(flags.unwrap() & DETACHED_PROCESS, 0);
            assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(flags, None);
        }
        let cmd = sidecar_command(
            Path::new("node"),
            Path::new("C:/Nexus/sidecar/dist/main.js"),
        );
        let _ = cmd;
    }

    #[test]
    fn last_stderr_lines_keeps_the_tail() {
        let lines: Vec<String> = (0..30).map(|i| format!("line-{i}")).collect();
        let tail = last_stderr_lines(&lines, HEALTHCHECK_STDERR_LINES);
        assert_eq!(tail.len(), 20);
        assert_eq!(tail[0], "line-10");
        assert_eq!(tail[19], "line-29");
    }

    #[test]
    fn spawn_with_dead_child_reports_exit_not_a_pipe_error() {
        let dir = std::env::temp_dir().join("nexus-test-dead-child");
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("main.js");
        fs::write(
            &script,
            b"process.stderr.write(\"Cannot find module 'better-sqlite3'\\n\"); process.exit(7);\n",
        )
        .unwrap();
        let node = NodeResolution {
            path: PathBuf::from("node"),
            source: NodeSource::PathFallback,
            rejected: vec![],
        };
        match Sidecar::spawn_with(&script, &node) {
            Err(SidecarError::Exited { code, stderr_tail }) => {
                assert_eq!(code, 7);
                assert!(
                    stderr_tail.iter().any(|l| l.contains("better-sqlite3")),
                    "stderr was {stderr_tail:?}"
                );
            }
            Err(SidecarError::Spawn(_)) => {
                // PATH has no node in this environment; the contract is still
                // encoded in Exited vs Request("pipe").
            }
            Err(other) => panic!("expected Exited or Spawn, got {other}"),
            Ok(_) => panic!("dead child must not report running"),
        }
    }

    #[test]
    fn spawn_with_sets_cwd_to_script_dir() {
        let dir = std::env::temp_dir().join("nexus-test-spawn-cwd");
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("main.js");
        // Stay alive until stdin closes; print cwd so we can assert spawn cwd.
        fs::write(
            &script,
            b"process.stderr.write('[nexus-sidecar] ready\\n'); process.stderr.write('cwd=' + process.cwd() + '\\n'); require('readline').createInterface({input:process.stdin}).on('close', () => process.exit(0));\n",
        )
        .unwrap();
        let node = NodeResolution {
            path: PathBuf::from("node"),
            source: NodeSource::PathFallback,
            rejected: vec![],
        };
        match Sidecar::spawn_with(&script, &node) {
            Ok((handle, status)) => {
                assert!(status.running);
                let tail = handle.stderr_tail();
                let cwd_line = tail.iter().find(|l| l.starts_with("cwd="));
                if let Some(line) = cwd_line {
                    let reported = line.trim_start_matches("cwd=");
                    let expected = fs::canonicalize(&dir).unwrap_or(dir.clone());
                    let reported_canon = fs::canonicalize(reported).unwrap_or_else(|_| PathBuf::from(reported));
                    assert_eq!(reported_canon, expected, "spawn cwd was {reported}");
                }
                Sidecar::shutdown(handle);
            }
            Err(SidecarError::Spawn(_)) => {}
            Err(other) => panic!("unexpected spawn error: {other}"),
        }
    }

    #[test]
    fn jsonrpc_request_serializes() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "ping",
            params: Value::Object(Default::default()),
        };
        let s = serde_json::to_string(&req).unwrap();
        assert!(s.contains("\"method\":\"ping\""));
        assert!(s.contains("\"id\":1"));
        assert!(s.contains("\"jsonrpc\":\"2.0\""));
    }

    #[test]
    fn jsonrpc_response_parses_result() {
        let raw = r#"{"jsonrpc":"2.0","id":7,"result":{"ok":true,"pid":1234}}"#;
        let parsed: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.id, Some(7));
        assert!(parsed.error.is_none());
        let result = parsed.result.unwrap();
        assert_eq!(result["ok"], serde_json::json!(true));
    }

    #[test]
    fn jsonrpc_response_parses_error() {
        let raw = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"NotImplemented"}}"#;
        let parsed: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.id, Some(2));
        let err = parsed.error.unwrap();
        assert_eq!(err.message, "NotImplemented");
    }
}
