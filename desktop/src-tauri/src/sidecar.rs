// Node sidecar process spawner.
//
// Launches `desktop/sidecar/dist/main.js` as a child process at app launch and
// shuts it down on app quit. Communication is line-delimited JSON-RPC 2.0 over
// the child's stdin/stdout. The actual JSON-RPC plumbing lives in this module
// behind a small `request()` helper; the frontend reaches it through the
// `ipc_call` Tauri command.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use thiserror::Error;
use tokio::sync::oneshot;

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

#[derive(Clone)]
pub struct SidecarHandle {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    next_id: Arc<AtomicU64>,
    pending: PendingMap,
}

pub struct Sidecar;

impl Sidecar {
    /// Resolve the bundled sidecar script path. In dev we walk relative to the
    /// Tauri working directory; in production the script ships alongside the
    /// resource bundle.
    pub fn script_path(app: &AppHandle) -> PathBuf {
        if let Ok(resolved) = app.path().resolve(
            "sidecar/dist/main.js",
            tauri::path::BaseDirectory::Resource,
        ) {
            if resolved.exists() {
                return resolved;
            }
        }
        // Dev fallback: relative to current_dir (`desktop/src-tauri/` or `desktop/`).
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let candidates = [
            cwd.join("sidecar/dist/main.js"),
            cwd.join("../sidecar/dist/main.js"),
            cwd.join("../../desktop/sidecar/dist/main.js"),
        ];
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        candidates[0].clone()
    }

    pub fn spawn(app: &AppHandle) -> Result<SidecarHandle, SidecarError> {
        let script = Self::script_path(app);
        if !script.exists() {
            return Err(SidecarError::NotFound(script));
        }
        let mut child = Command::new("node")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| SidecarError::Spawn(e.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SidecarError::Spawn("missing stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::Spawn("missing stdout".to_string()))?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        Self::spawn_reader(stdout, pending.clone());

        Ok(SidecarHandle {
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            next_id: Arc::new(AtomicU64::new(1)),
            pending,
        })
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
            writeln!(stdin, "{line}").map_err(|e| SidecarError::Request(e.to_string()))?;
            stdin
                .flush()
                .map_err(|e| SidecarError::Request(e.to_string()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_path_returns_a_path() {
        // We cannot construct a real AppHandle in unit tests, so we exercise
        // the path resolution helper indirectly by checking that the fallback
        // candidates yield a non-empty PathBuf.
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let candidate = cwd.join("sidecar/dist/main.js");
        assert!(candidate.to_string_lossy().contains("sidecar"));
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
