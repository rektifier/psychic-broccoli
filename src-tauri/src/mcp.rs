//! Embedded MCP (Model Context Protocol) server.
//!
//! Exposes the running app over a localhost-only HTTP/SSE endpoint so MCP
//! clients (e.g. Claude Code) can drive it. This module is the infrastructure
//! slice: server lifecycle, bearer-token auth, settings persistence, and the
//! legacy MCP HTTP+SSE transport with an empty tool list. Individual tools are
//! added in later slices.
//!
//! ## Transport
//!
//! This implements the MCP "HTTP+SSE" transport (protocol 2024-11-05):
//!
//! - The client opens `GET /sse`. The server replies with an SSE stream whose
//!   first event is an `endpoint` event carrying the relative URL the client
//!   must POST to (`/message?sessionId=<id>`).
//! - The client POSTs JSON-RPC requests to that endpoint. The server answers
//!   `202 Accepted` and delivers the JSON-RPC response back over the SSE stream
//!   as a `message` event.
//!
//! ## Security
//!
//! - The listener binds `127.0.0.1` only, never `0.0.0.0`.
//! - Every request must carry `Authorization: Bearer <token>`; the token is
//!   generated once on first run and persisted.

use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Router,
};
use futures_util::{stream, Stream};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Listener, Manager, State as TauriState};
use tokio::sync::{mpsc, oneshot, watch};

const DEFAULT_PORT: u16 = 3742;
const SERVER_NAME: &str = "psychic-broccoli";
const PROTOCOL_VERSION: &str = "2024-11-05";
/// Protocol versions this server can speak. `initialize` echoes the client's
/// version only when it is in this list; otherwise it answers with
/// [`PROTOCOL_VERSION`], per MCP version negotiation.
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[PROTOCOL_VERSION];
const SETTINGS_FILE: &str = "mcp.json";

/// Event the backend emits to ask the frontend for live app state.
const EVENT_BRIDGE_REQUEST: &str = "mcp:request";
/// Event the frontend emits back, carrying the result keyed by request id.
const EVENT_BRIDGE_RESPONSE: &str = "mcp:response";
/// How long a tool waits for the frontend to answer a bridge request.
const BRIDGE_TIMEOUT_SECS: u64 = 5;
/// A flow runs many HTTP requests in sequence, so it needs a far longer budget
/// than the single-shot bridge default before the bridge gives up waiting.
const FLOW_BRIDGE_TIMEOUT_SECS: u64 = 300;

/* ---------------------------------------------------------------- settings */

/// Persisted MCP server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct McpSettings {
    /// Whether the server should run (and auto-start on launch).
    pub enabled: bool,
    /// TCP port the server listens on (loopback only).
    pub port: u16,
    /// Static bearer token, generated once on first run.
    pub token: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            token: String::new(),
        }
    }
}

fn generate_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve config dir: {}", e))?;
    Ok(dir.join(SETTINGS_FILE))
}

/// Result of reading the settings file, distinguishing a missing file (fresh
/// install, safe to initialise) from an unreadable or corrupt one (user
/// configuration that must not be overwritten).
enum SettingsRead {
    Loaded(McpSettings),
    Missing,
    Corrupt(String),
}

fn read_settings_at(path: &Path) -> SettingsRead {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return SettingsRead::Missing,
        Err(e) => return SettingsRead::Corrupt(e.to_string()),
    };
    match serde_json::from_str(&content) {
        Ok(settings) => SettingsRead::Loaded(settings),
        Err(e) => SettingsRead::Corrupt(e.to_string()),
    }
}

fn write_settings(app: &AppHandle, settings: &McpSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    write_settings_at(&path, settings)
}

fn write_settings_at(path: &Path, settings: &McpSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // The file holds the bearer token, so restrict it to the owner on Unix.
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("Failed to write MCP settings: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write MCP settings: {}", e))?;
        // mode() only applies on create; tighten files created by older builds.
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, json).map_err(|e| format!("Failed to write MCP settings: {}", e))
    }
}

/// Load settings, generating and persisting a token on first run.
///
/// A corrupt settings file is left untouched on disk: the server runs with
/// in-memory defaults and the parse error is returned so the caller can
/// surface it. Overwriting would silently rotate the token and reset the
/// port, breaking every configured MCP client.
fn load_or_init_settings_at(path: &Path) -> (McpSettings, Option<String>) {
    match read_settings_at(path) {
        SettingsRead::Loaded(mut settings) => {
            if settings.token.is_empty() {
                settings.token = generate_token();
                let _ = write_settings_at(path, &settings);
            }
            (settings, None)
        }
        SettingsRead::Missing => {
            let settings = McpSettings {
                token: generate_token(),
                ..Default::default()
            };
            let _ = write_settings_at(path, &settings);
            (settings, None)
        }
        SettingsRead::Corrupt(err) => {
            let settings = McpSettings {
                token: generate_token(),
                ..Default::default()
            };
            (settings, Some(err))
        }
    }
}

fn load_or_init_settings(app: &AppHandle) -> McpSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("MCP settings unavailable: {}", e);
            return McpSettings {
                token: generate_token(),
                ..Default::default()
            };
        }
    };
    let (settings, error) = load_or_init_settings_at(&path);
    if let Some(err) = error {
        eprintln!(
            "MCP settings file is corrupt; running with defaults without overwriting it: {}",
            err
        );
        let _ = app.emit(
            "mcp:settings-error",
            format!("MCP settings file could not be parsed: {}", err),
        );
    }
    settings
}

/* --------------------------------------------------------- server lifecycle */

struct RunningServer {
    shutdown_tx: watch::Sender<bool>,
}

/// Pending bridge requests, keyed by request id, awaiting a frontend reply.
type PendingBridge = Arc<Mutex<HashMap<String, oneshot::Sender<BridgeResponse>>>>;

/// Managed Tauri state tracking the running server, if any.
#[derive(Default)]
pub struct McpServerState {
    inner: Mutex<Option<RunningServer>>,
    /// Shared with the running server and the global `mcp:response` listener so
    /// tool handlers can await frontend replies. Lives for the whole app run.
    pending: PendingBridge,
}

impl McpServerState {
    pub fn is_running(&self) -> bool {
        self.inner.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    fn set(&self, server: RunningServer) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(server);
        }
    }

    fn take(&self) -> Option<RunningServer> {
        self.inner.lock().ok().and_then(|mut g| g.take())
    }
}

/* ----------------------------------------------------------- HTTP/SSE state */

struct OutEvent {
    event: String,
    data: String,
}

type SharedSessions = Arc<Mutex<HashMap<String, mpsc::Sender<OutEvent>>>>;

#[derive(Clone)]
struct McpState {
    token: Arc<String>,
    sessions: SharedSessions,
    shutdown_rx: watch::Receiver<bool>,
    server_version: Arc<String>,
    /// Handle used to emit bridge requests to the frontend. `None` only in unit
    /// tests that exercise transport/auth without driving tools.
    app: Option<AppHandle>,
    /// Bridge requests awaiting a frontend reply (shared with `McpServerState`).
    pending: PendingBridge,
}

/// A reply from the frontend to a bridge request, routed back to the awaiting
/// tool handler by `id`.
#[derive(Debug, Deserialize)]
struct BridgeResponse {
    id: String,
    ok: bool,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

/// Removes a session from the registry when its SSE stream is dropped (client
/// disconnect or server shutdown), preventing leaked senders.
struct SessionGuard {
    id: String,
    sessions: SharedSessions,
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(&self.id);
        }
    }
}

/* ------------------------------------------------------------------- server */

fn start_server(
    app: &AppHandle,
    state: &McpServerState,
    settings: &McpSettings,
) -> Result<(), String> {
    if state.is_running() {
        return Ok(());
    }

    // Bind synchronously so a port conflict surfaces as an error the caller can
    // report. Loopback-only: never exposed on the network.
    let std_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, settings.port))
        .map_err(|e| format!("Failed to bind 127.0.0.1:{} - {}", settings.port, e))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to configure listener: {}", e))?;

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mcp_state = McpState {
        token: Arc::new(settings.token.clone()),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        shutdown_rx: shutdown_rx.clone(),
        server_version: Arc::new(app.package_info().version.to_string()),
        app: Some(app.clone()),
        pending: state.pending.clone(),
    };
    let router = build_router(mcp_state);

    let mut graceful_rx = shutdown_rx;
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("MCP listener init failed: {}", e);
                return;
            }
        };
        let shutdown = async move {
            while !*graceful_rx.borrow() {
                if graceful_rx.changed().await.is_err() {
                    break;
                }
            }
        };
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            eprintln!("MCP server error: {}", e);
        }
    });

    state.set(RunningServer { shutdown_tx });
    Ok(())
}

fn stop_server(state: &McpServerState) {
    if let Some(running) = state.take() {
        // Signals both the graceful-shutdown future and every open SSE stream
        // to end, so connections drain and the port is released.
        let _ = running.shutdown_tx.send(true);
    }
}

fn build_router(state: McpState) -> Router {
    Router::new()
        .route("/sse", get(sse_handler))
        .route("/message", post(message_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

/// Constant-time comparison to avoid leaking the token via response timing.
fn tokens_match(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// True when an Origin header value refers to this machine's loopback
/// (`http://localhost`, `http://127.0.0.1`, or `http://[::1]`, each with an
/// optional port).
fn is_localhost_origin(origin: &str) -> bool {
    let Some(host_port) = origin.strip_prefix("http://") else {
        return false;
    };
    let host = match host_port.rsplit_once(':') {
        Some((h, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => h,
        _ => host_port,
    };
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

async fn auth_middleware(State(state): State<McpState>, req: Request, next: Next) -> Response {
    // The MCP spec requires localhost HTTP servers to validate Origin against
    // DNS rebinding: a page in the victim's browser can otherwise reach
    // 127.0.0.1 directly. Non-browser MCP clients send no Origin header, which
    // is accepted; anything non-localhost is rejected regardless of token.
    let origin_ok = match req.headers().get(header::ORIGIN) {
        None => true,
        Some(value) => match value.to_str() {
            Ok(origin) => origin.is_empty() || is_localhost_origin(origin),
            Err(_) => false,
        },
    };
    if !origin_ok {
        return (StatusCode::FORBIDDEN, "Forbidden origin").into_response();
    }

    let provided = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "));

    match provided {
        Some(token) if tokens_match(token, &state.token) => next.run(req).await,
        _ => (StatusCode::UNAUTHORIZED, "Unauthorized").into_response(),
    }
}

async fn sse_handler(
    State(state): State<McpState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let session_id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = mpsc::channel::<OutEvent>(64);

    // The first SSE event tells the client where to POST its JSON-RPC messages.
    let endpoint = format!("/message?sessionId={}", session_id);
    let _ = tx
        .send(OutEvent {
            event: "endpoint".to_string(),
            data: endpoint,
        })
        .await;

    if let Ok(mut map) = state.sessions.lock() {
        map.insert(session_id.clone(), tx);
    }

    let guard = SessionGuard {
        id: session_id,
        sessions: state.sessions.clone(),
    };
    let shutdown_rx = state.shutdown_rx.clone();

    let body = stream::unfold(
        (rx, guard, shutdown_rx),
        |(mut rx, guard, mut shutdown_rx)| async move {
            if *shutdown_rx.borrow() {
                return None;
            }
            tokio::select! {
                maybe = rx.recv() => match maybe {
                    Some(ev) => {
                        let event = Event::default().event(ev.event).data(ev.data);
                        Some((Ok(event), (rx, guard, shutdown_rx)))
                    }
                    None => None,
                },
                _ = shutdown_rx.changed() => None,
            }
        },
    );

    Sse::new(body).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[derive(Deserialize)]
struct MessageQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

async fn message_handler(
    State(state): State<McpState>,
    Query(query): Query<MessageQuery>,
    body: String,
) -> Response {
    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(value) => value,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
    };

    let sender = match state.sessions.lock() {
        Ok(map) => map.get(&query.session_id).cloned(),
        Err(_) => None,
    };
    let sender = match sender {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, "Session not found").into_response(),
    };

    let messages = match parsed {
        serde_json::Value::Array(arr) => arr,
        other => vec![other],
    };

    for msg in &messages {
        // Tool calls need live frontend state and run async via the bridge;
        // every other method is handled synchronously.
        let response = match msg.get("method").and_then(|m| m.as_str()) {
            Some("tools/call") => handle_tool_call(msg, &state).await,
            _ => handle_rpc_message(msg, SERVER_NAME, &state.server_version),
        };
        if let Some(response) = response {
            let data = serde_json::to_string(&response).unwrap_or_default();
            let _ = sender
                .send(OutEvent {
                    event: "message".to_string(),
                    data,
                })
                .await;
        }
    }

    StatusCode::ACCEPTED.into_response()
}

/// Dispatch a single JSON-RPC message. Returns `Some(response)` for requests
/// and `None` for notifications (which get no reply).
fn handle_rpc_message(
    msg: &serde_json::Value,
    name: &str,
    version: &str,
) -> Option<serde_json::Value> {
    let method = msg.get("method")?.as_str()?;
    let has_id = msg.get("id").map(|v| !v.is_null()).unwrap_or(false);

    // Notifications carry no id and expect no response.
    if !has_id {
        return None;
    }
    let id = msg.get("id").cloned().unwrap_or(serde_json::Value::Null);

    let result: Result<serde_json::Value, (i64, String)> = match method {
        "initialize" => {
            let requested = msg
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str());
            // Echo the client's version only if we support it; otherwise
            // answer with ours and let the client decide whether to proceed.
            let proto = match requested {
                Some(v) if SUPPORTED_PROTOCOL_VERSIONS.contains(&v) => v,
                _ => PROTOCOL_VERSION,
            };
            Ok(json!({
                "protocolVersion": proto,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": name, "version": version }
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_schemas() })),
        other => Err((-32601, format!("Method not found: {}", other))),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}

/* ------------------------------------------------------- frontend bridge */

/// Ask the frontend for live app state and await its reply.
///
/// The MCP server runs in the Rust backend, but the app's live state (the open
/// workspace, responses, etc.) lives in Svelte stores on the frontend. This is
/// the bridge every tool uses to reach across that boundary:
///
/// 1. We mint a request `id`, register a oneshot sender under it, then emit an
///    `mcp:request` Tauri event carrying `{ id, kind, params }`.
/// 2. The frontend listens for `mcp:request`, does the work for `kind`, and
///    emits `mcp:response` carrying `{ id, ok, data?, error? }`.
/// 3. A single global listener (registered in [`init`]) matches the reply to the
///    pending `id` and fires the oneshot, which we await here with a timeout.
///
/// Returns the `data` payload on success, or an error string (frontend-reported
/// error, timeout, or transport failure) that the caller surfaces as a tool
/// error. `timeout_secs` bounds the wait: single-shot tools pass
/// [`BRIDGE_TIMEOUT_SECS`]; longer-running ones (e.g. flows) pass a larger value.
/// Subsequent tools should follow this same `kind`-dispatched pattern.
async fn bridge_request(
    app: &AppHandle,
    pending: &PendingBridge,
    kind: &str,
    params: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = oneshot::channel::<BridgeResponse>();

    match pending.lock() {
        Ok(mut map) => {
            map.insert(id.clone(), tx);
        }
        Err(_) => return Err("MCP bridge state is poisoned".to_string()),
    }

    let payload = json!({ "id": id, "kind": kind, "params": params });
    if let Err(e) = app.emit(EVENT_BRIDGE_REQUEST, payload) {
        if let Ok(mut map) = pending.lock() {
            map.remove(&id);
        }
        return Err(format!("Failed to emit bridge request: {}", e));
    }

    match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(resp)) if resp.ok => Ok(resp.data.unwrap_or(serde_json::Value::Null)),
        Ok(Ok(resp)) => Err(resp
            .error
            .unwrap_or_else(|| "Frontend reported an error".to_string())),
        Ok(Err(_)) => Err("Bridge response channel closed".to_string()),
        Err(_) => {
            // Timed out: drop the pending entry so a late reply is ignored.
            if let Ok(mut map) = pending.lock() {
                map.remove(&id);
            }
            Err(format!("Frontend did not respond within {}s", timeout_secs))
        }
    }
}

/* --------------------------------------------------------------- MCP tools */

/// JSON schemas advertised by `tools/list`.
fn tool_schemas() -> serde_json::Value {
    json!([
        {
            "name": "list_requests",
            "description": "Lists every HTTP request available in the open workspace by scanning all .http files. Use this tool when the user asks to see available requests, list requests, show what HTTP calls exist, or explore the workspace. Call this first to obtain valid filePath and requestIndex values before calling execute_request. Do not use this to run a request; use execute_request instead. Returns an empty array when no workspace folder is open in the app.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "execute_request",
            "description": "Executes a single HTTP request from the open workspace and returns its full response: status code, headers, body, timing, and the outcome of any pb assertions. Use this tool when the user asks to run, execute, send, or test a specific request. Call list_requests first to get a valid filePath and requestIndex if you do not already have them. Do not use this to run a sequence of requests; use execute_flow instead. Variables are resolved using the given environment; if omitted, the active environment is used. Runs silently: the app UI is not updated.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filePath": {
                        "type": "string",
                        "description": "Workspace-relative path to the .http file. Use the filePath value returned by list_requests."
                    },
                    "requestIndex": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Zero-based index of the request within the file. Use the requestIndex value returned by list_requests."
                    },
                    "environment": {
                        "type": "string",
                        "description": "Environment name used to resolve variables (e.g. 'Development', 'Production'). Omit to use the active environment."
                    }
                },
                "required": ["filePath", "requestIndex"],
                "additionalProperties": false
            }
        },
        {
            "name": "execute_flow",
            "description": "Runs an entire flow from the open workspace and returns its full run record: overall status, a passed/failed/skipped step summary, and per-step results including pb assertion outcomes. Use this tool when the user asks to run, execute, or trigger a flow or an ordered sequence of requests. Do not use this for a single request; use execute_request instead. Steps run in order with variable chaining and each step's continueOnFailure flag is respected. Variables are resolved using the given environment; if omitted, the active environment is used. Runs silently: the app's flow panel and run history are not updated.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "flowFilePath": {
                        "type": "string",
                        "description": "Workspace-relative path to the .pb-flow.json flow file (e.g. '.flows/login.pb-flow.json')."
                    },
                    "environment": {
                        "type": "string",
                        "description": "Environment name used to resolve variables (e.g. 'Development', 'Production'). Omit to use the active environment."
                    }
                },
                "required": ["flowFilePath"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_last_result",
            "description": "Returns the response from the user's most recent manually triggered request, without executing anything. Use this tool when the user asks about the last result, what the previous response was, or wants to inspect the most recent request outcome without re-running it. Do not use this when the user wants to run a request; use execute_request instead. Returns the same shape as execute_request (status, headers, body, timing, and pb assertion outcomes), or null if no request has been run yet in the current session. Reflects the state at call time: a later manual request changes what a subsequent call returns.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }
    ])
}

/// Dispatch a `tools/call` request to the matching tool handler.
async fn handle_tool_call(msg: &serde_json::Value, state: &McpState) -> Option<serde_json::Value> {
    if !msg.get("id").map(|v| !v.is_null()).unwrap_or(false) {
        return None;
    }
    let id = msg.get("id").cloned().unwrap_or(serde_json::Value::Null);

    let params = msg.get("params");
    let tool_name = params.and_then(|p| p.get("name")).and_then(|v| v.as_str());
    let arguments = params
        .and_then(|p| p.get("arguments"))
        .cloned()
        .unwrap_or_else(|| json!({}));

    let outcome = match tool_name {
        Some("list_requests") => tool_list_requests(state, arguments).await,
        Some("execute_request") => tool_execute_request(state, arguments).await,
        Some("execute_flow") => tool_execute_flow(state, arguments).await,
        Some("get_last_result") => tool_get_last_result(state, arguments).await,
        Some(other) => Err(format!("Unknown tool: {}", other)),
        None => Err("Missing tool name".to_string()),
    };

    Some(match outcome {
        Ok(value) => tool_result_ok(&id, &value),
        Err(message) => tool_result_error(&id, &message),
    })
}

/// Wrap a successful tool value as an MCP `tools/call` result with JSON text content.
fn tool_result_ok(id: &serde_json::Value, value: &serde_json::Value) -> serde_json::Value {
    let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "content": [{ "type": "text", "text": text }], "isError": false }
    })
}

/// Wrap a tool failure as an MCP `tools/call` result with `isError: true`.
fn tool_result_error(id: &serde_json::Value, message: &str) -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "content": [{ "type": "text", "text": message }], "isError": true }
    })
}

/// `list_requests`: returns every request in the open workspace via the bridge.
async fn tool_list_requests(
    state: &McpState,
    _arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app = state
        .app
        .as_ref()
        .ok_or_else(|| "MCP bridge unavailable".to_string())?;
    bridge_request(
        app,
        &state.pending,
        "list_requests",
        json!({}),
        BRIDGE_TIMEOUT_SECS,
    )
    .await
}

/// `execute_request`: fire one request silently and return its response.
///
/// Argument shape is validated here; locating the request, resolving variables,
/// sending it, and running pb assertions all happen on the frontend (which owns
/// the live workspace state) and come back through the bridge. The frontend
/// reports a missing file/index or a network failure as a bridge error, which
/// surfaces here as a tool error.
async fn tool_execute_request(
    state: &McpState,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let file_path = arguments
        .get("filePath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "execute_request requires a string 'filePath'".to_string())?;
    let request_index = arguments
        .get("requestIndex")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| {
            "execute_request requires a non-negative integer 'requestIndex'".to_string()
        })?;
    // `environment` is optional; reject a non-string if present rather than silently ignoring it.
    let environment = match arguments.get("environment") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(_) => return Err("'environment' must be a string when provided".to_string()),
    };

    let app = state
        .app
        .as_ref()
        .ok_or_else(|| "MCP bridge unavailable".to_string())?;

    let params = json!({
        "filePath": file_path,
        "requestIndex": request_index,
        "environment": environment,
    });
    bridge_request(
        app,
        &state.pending,
        "execute_request",
        params,
        BRIDGE_TIMEOUT_SECS,
    )
    .await
}

/// `execute_flow`: run a whole flow silently and return its structured run record.
///
/// Argument shape is validated here; loading the flow file, resolving variables,
/// executing every step in order (with chaining and pb assertions), respecting
/// each step's `continueOnFailure`, and computing the summary all happen on the
/// frontend (which owns the live workspace state) and come back through the
/// bridge. The frontend reports a missing or invalid flow file as a bridge error,
/// which surfaces here as a tool error. No UI stores or run history are touched.
async fn tool_execute_flow(
    state: &McpState,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let flow_file_path = arguments
        .get("flowFilePath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "execute_flow requires a string 'flowFilePath'".to_string())?;
    // `environment` is optional; reject a non-string if present rather than silently ignoring it.
    let environment = match arguments.get("environment") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(_) => return Err("'environment' must be a string when provided".to_string()),
    };

    let app = state
        .app
        .as_ref()
        .ok_or_else(|| "MCP bridge unavailable".to_string())?;

    let params = json!({
        "flowFilePath": flow_file_path,
        "environment": environment,
    });
    bridge_request(
        app,
        &state.pending,
        "execute_flow",
        params,
        FLOW_BRIDGE_TIMEOUT_SECS,
    )
    .await
}

/// `get_last_result`: read the user's most recent manual request result.
///
/// Takes no arguments and mutates nothing. The frontend snapshots the live
/// `currentResponse`/`pbAssertionResults` stores and returns them in the
/// `execute_request` shape, or JSON `null` if no request has run yet this
/// session. Because it reads at call time, a later manual request changes what
/// a subsequent call returns.
async fn tool_get_last_result(
    state: &McpState,
    _arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app = state
        .app
        .as_ref()
        .ok_or_else(|| "MCP bridge unavailable".to_string())?;
    bridge_request(
        app,
        &state.pending,
        "get_last_result",
        json!({}),
        BRIDGE_TIMEOUT_SECS,
    )
    .await
}

/* ------------------------------------------------------------- Tauri glue */

/// Initialise the MCP subsystem on app launch: ensure a token exists and
/// auto-start the server if it was enabled. Call from the Tauri `setup` hook.
pub fn init(app: &AppHandle) {
    let settings = load_or_init_settings(app);
    let state = app.state::<McpServerState>();

    // One global listener routes every `mcp:response` back to the tool handler
    // that is awaiting it (matched by request id). Registered once, for the app
    // lifetime, so it works whether the server is running now or started later.
    let pending = state.pending.clone();
    app.listen(EVENT_BRIDGE_RESPONSE, move |event| {
        if let Ok(resp) = serde_json::from_str::<BridgeResponse>(event.payload()) {
            if let Ok(mut map) = pending.lock() {
                if let Some(tx) = map.remove(&resp.id) {
                    let _ = tx.send(resp);
                }
            }
        }
    });

    if settings.enabled {
        if let Err(e) = start_server(app, &state, &settings) {
            eprintln!("Failed to auto-start MCP server: {}", e);
        }
    }
}

#[tauri::command]
pub fn mcp_get_settings(app: AppHandle) -> Result<McpSettings, String> {
    Ok(load_or_init_settings(&app))
}

#[tauri::command]
pub fn mcp_is_running(state: TauriState<'_, McpServerState>) -> bool {
    state.is_running()
}

#[tauri::command]
pub fn mcp_set_enabled(
    app: AppHandle,
    state: TauriState<'_, McpServerState>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_or_init_settings(&app);
    if enabled {
        match start_server(&app, &state, &settings) {
            Ok(()) => {
                settings.enabled = true;
                write_settings(&app, &settings)
            }
            Err(e) => {
                // Persist disabled so a failing config does not auto-start next launch.
                if settings.enabled {
                    settings.enabled = false;
                    let _ = write_settings(&app, &settings);
                }
                Err(e)
            }
        }
    } else {
        stop_server(&state);
        settings.enabled = false;
        write_settings(&app, &settings)
    }
}

#[tauri::command]
pub fn mcp_set_port(
    app: AppHandle,
    state: TauriState<'_, McpServerState>,
    port: u16,
) -> Result<(), String> {
    if state.is_running() {
        return Err("Stop the server before changing the port".to_string());
    }
    if port == 0 {
        return Err("Port must be between 1 and 65535".to_string());
    }
    let mut settings = load_or_init_settings(&app);
    settings.port = port;
    write_settings(&app, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_match_compares_correctly() {
        assert!(tokens_match("abc123", "abc123"));
        assert!(!tokens_match("abc123", "abc124"));
        assert!(!tokens_match("abc", "abcd"));
        assert!(!tokens_match("", "x"));
    }

    #[test]
    fn generate_token_is_nonempty_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert!(!a.is_empty());
        assert_ne!(a, b);
    }

    #[test]
    fn initialize_returns_server_info_and_capabilities() {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2024-11-05" }
        });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "0.4.2").unwrap();
        assert_eq!(resp["id"], json!(1));
        assert_eq!(resp["result"]["serverInfo"]["name"], json!(SERVER_NAME));
        assert_eq!(resp["result"]["serverInfo"]["version"], json!("0.4.2"));
        assert_eq!(resp["result"]["protocolVersion"], json!("2024-11-05"));
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn initialize_defaults_protocol_version_when_absent() {
        let msg = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "0.4.2").unwrap();
        assert_eq!(resp["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
    }

    #[test]
    fn initialize_replaces_unsupported_protocol_version() {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "9999-12-31" }
        });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "0.4.2").unwrap();
        assert_eq!(resp["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
    }

    #[test]
    fn is_localhost_origin_accepts_only_loopback_http() {
        assert!(is_localhost_origin("http://localhost"));
        assert!(is_localhost_origin("http://localhost:3742"));
        assert!(is_localhost_origin("http://127.0.0.1"));
        assert!(is_localhost_origin("http://127.0.0.1:8080"));
        assert!(is_localhost_origin("http://[::1]"));
        assert!(is_localhost_origin("http://[::1]:3742"));

        assert!(!is_localhost_origin("https://evil.example"));
        assert!(!is_localhost_origin("http://evil.example"));
        assert!(!is_localhost_origin("http://localhost.evil.example"));
        assert!(!is_localhost_origin("http://127.0.0.1.evil.example"));
        assert!(!is_localhost_origin("https://localhost"));
        assert!(!is_localhost_origin("null"));
        assert!(!is_localhost_origin(""));
    }

    #[test]
    fn corrupt_settings_file_is_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("pb-mcp-test-{}", generate_token()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, "{ not valid json").unwrap();

        let (settings, error) = load_or_init_settings_at(&path);

        assert!(error.is_some(), "corrupt file must be reported");
        assert!(!settings.enabled);
        assert_eq!(settings.port, DEFAULT_PORT);
        assert!(!settings.token.is_empty());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{ not valid json",
            "corrupt file must stay untouched on disk"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_settings_file_is_initialized_and_persisted() {
        let dir = std::env::temp_dir().join(format!("pb-mcp-test-{}", generate_token()));
        let path = dir.join(SETTINGS_FILE);

        let (settings, error) = load_or_init_settings_at(&path);

        assert!(error.is_none());
        assert!(!settings.token.is_empty());
        let persisted: McpSettings =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(persisted.token, settings.token);
        assert_eq!(persisted.port, DEFAULT_PORT);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tools_list_advertises_list_requests() {
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == json!("list_requests")));
        let lr = tools
            .iter()
            .find(|t| t["name"] == json!("list_requests"))
            .unwrap();
        assert_eq!(lr["inputSchema"]["type"], json!("object"));
    }

    #[test]
    fn tools_list_advertises_execute_request() {
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let er = tools
            .iter()
            .find(|t| t["name"] == json!("execute_request"))
            .expect("execute_request tool advertised");
        let schema = &er["inputSchema"];
        assert_eq!(schema["type"], json!("object"));
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("filePath")));
        assert!(required.contains(&json!("requestIndex")));
    }

    #[tokio::test]
    async fn execute_request_rejects_missing_arguments() {
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": { "name": "execute_request", "arguments": { "requestIndex": 0 } }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("filePath"));
    }

    #[test]
    fn tools_list_advertises_execute_flow() {
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let ef = tools
            .iter()
            .find(|t| t["name"] == json!("execute_flow"))
            .expect("execute_flow tool advertised");
        let schema = &ef["inputSchema"];
        assert_eq!(schema["type"], json!("object"));
        let required = schema["required"].as_array().unwrap();
        assert!(required.contains(&json!("flowFilePath")));
    }

    #[test]
    fn tools_list_advertises_get_last_result() {
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let glr = tools
            .iter()
            .find(|t| t["name"] == json!("get_last_result"))
            .expect("get_last_result tool advertised");
        let schema = &glr["inputSchema"];
        assert_eq!(schema["type"], json!("object"));
        assert_eq!(schema["additionalProperties"], json!(false));
        // Takes no input.
        assert!(schema.get("required").is_none());
    }

    #[tokio::test]
    async fn get_last_result_dispatches_via_bridge() {
        // No frontend listening and `app` is None, so the bridge cannot run: the
        // tool is reached (not "Unknown tool") and surfaces a bridge error.
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 14,
            "method": "tools/call",
            "params": { "name": "get_last_result", "arguments": {} }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
        let text = resp["result"]["content"][0]["text"].as_str().unwrap();
        assert!(!text.contains("Unknown tool"), "got: {}", text);
    }

    #[tokio::test]
    async fn execute_flow_rejects_missing_arguments() {
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "tools/call",
            "params": { "name": "execute_flow", "arguments": {} }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("flowFilePath"));
    }

    #[tokio::test]
    async fn execute_flow_rejects_non_string_environment() {
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {
                "name": "execute_flow",
                "arguments": { "flowFilePath": ".flows/x.pb-flow.json", "environment": 5 }
            }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("environment"));
    }

    #[test]
    fn tool_result_helpers_set_is_error_flag() {
        let ok = tool_result_ok(&json!(1), &json!([{ "url": "/x" }]));
        assert_eq!(ok["result"]["isError"], json!(false));
        assert!(ok["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("/x"));

        let err = tool_result_error(&json!(2), "boom");
        assert_eq!(err["result"]["isError"], json!(true));
        assert_eq!(err["result"]["content"][0]["text"], json!("boom"));
    }

    #[test]
    fn ping_returns_empty_result() {
        let msg = json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        assert!(resp["result"].is_object());
        assert!(resp.get("error").is_none());
    }

    #[test]
    fn notification_yields_no_response() {
        let msg = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        assert!(handle_rpc_message(&msg, SERVER_NAME, "v").is_none());
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let msg = json!({ "jsonrpc": "2.0", "id": 9, "method": "resources/list", "params": {} });
        let resp = handle_rpc_message(&msg, SERVER_NAME, "v").unwrap();
        assert_eq!(resp["error"]["code"], json!(-32601));
    }

    #[tokio::test]
    async fn tool_call_unknown_tool_returns_tool_error() {
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": { "name": "does_not_exist", "arguments": {} }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["id"], json!(7));
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("does_not_exist"));
    }

    #[tokio::test]
    async fn tool_call_times_out_without_frontend() {
        // No frontend is listening and `app` is None, so the bridge cannot run.
        let (state, _tx) = test_state("t");
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "tools/call",
            "params": { "name": "list_requests", "arguments": {} }
        });
        let resp = handle_tool_call(&msg, &state).await.unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
    }

    #[test]
    fn default_settings_use_default_port_and_disabled() {
        let settings = McpSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.port, DEFAULT_PORT);
        assert!(settings.token.is_empty());
    }

    fn test_state(token: &str) -> (McpState, watch::Sender<bool>) {
        let (tx, rx) = watch::channel(false);
        let state = McpState {
            token: Arc::new(token.to_string()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            shutdown_rx: rx,
            server_version: Arc::new("test".to_string()),
            app: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
        };
        (state, tx)
    }

    /// Spins up the real axum router on an ephemeral loopback port and drives it
    /// with an HTTP client to verify auth and the MCP handshake end-to-end.
    #[tokio::test]
    async fn server_enforces_auth_and_completes_initialize_handshake() {
        use futures_util::StreamExt;

        let token = "test-secret-token";
        let (state, _shutdown_tx) = test_state(token);
        let router = build_router(state);
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let client = reqwest::Client::new();
        let sse_url = format!("http://{}/sse", addr);

        // No token -> 401.
        let resp = client.get(&sse_url).send().await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // Wrong token -> 401.
        let resp = client
            .get(&sse_url)
            .bearer_auth("wrong")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // Correct token -> 200 SSE stream, first event names the POST endpoint.
        let resp = client
            .get(&sse_url)
            .bearer_auth(token)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let mut body = resp.bytes_stream();

        let mut buf = Vec::new();
        while let Some(chunk) = body.next().await {
            buf.extend_from_slice(&chunk.unwrap());
            let text = String::from_utf8_lossy(&buf);
            if text.contains("event: endpoint") && text.contains("sessionId=") {
                break;
            }
            assert!(buf.len() < 8192, "endpoint event never arrived");
        }
        let text = String::from_utf8_lossy(&buf).to_string();
        assert!(text.contains("event: endpoint"), "got: {}", text);
        let session: String = text
            .split("sessionId=")
            .nth(1)
            .unwrap()
            .chars()
            .take_while(|c| !c.is_whitespace())
            .collect();
        assert!(!session.is_empty());

        // POST initialize to the session endpoint -> 202, response over SSE.
        let post_url = format!("http://{}/message?sessionId={}", addr, session);
        let init = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2024-11-05" }
        });
        let resp = client
            .post(&post_url)
            .bearer_auth(token)
            .json(&init)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);

        buf.clear();
        while let Some(chunk) = body.next().await {
            buf.extend_from_slice(&chunk.unwrap());
            let text = String::from_utf8_lossy(&buf);
            if text.contains("serverInfo") {
                break;
            }
            assert!(buf.len() < 8192, "initialize response never arrived");
        }
        let text = String::from_utf8_lossy(&buf);
        assert!(text.contains("event: message"), "got: {}", text);
        assert!(text.contains(SERVER_NAME), "got: {}", text);
        assert!(text.contains("\"protocolVersion\""), "got: {}", text);

        // An unauthenticated POST is also rejected.
        let resp = client.post(&post_url).json(&init).send().await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    /// DNS rebinding defense: a valid token does not help a cross-origin
    /// browser page, while requests with a localhost or absent Origin pass.
    #[tokio::test]
    async fn server_rejects_cross_origin_requests() {
        let token = "test-secret-token";
        let (state, _shutdown_tx) = test_state(token);
        let router = build_router(state);
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let client = reqwest::Client::new();
        let sse_url = format!("http://{}/sse", addr);

        // Valid token but foreign Origin -> rejected.
        let resp = client
            .get(&sse_url)
            .bearer_auth(token)
            .header(header::ORIGIN, "https://evil.example")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);

        // Valid token and localhost Origin -> accepted.
        let resp = client
            .get(&sse_url)
            .bearer_auth(token)
            .header(header::ORIGIN, "http://localhost:1420")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // No Origin (non-browser MCP client) and valid token -> accepted.
        let resp = client
            .get(&sse_url)
            .bearer_auth(token)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
