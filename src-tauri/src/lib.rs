use std::collections::HashMap;
use std::time::Duration;
use serde::{Deserialize, Serialize};

const REQUEST_TIMEOUT_SECS: u64 = 30;
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50 MB

#[derive(Deserialize)]
struct HttpRequestPayload {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpResponsePayload {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

fn validate_url(url: &str) -> Result<(), String> {
    let lower = url.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("Only http:// and https:// URLs are allowed, got: {}", url))
    }
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    validate_url(&payload.url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let method = payload.method.parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &payload.url);

    for (key, value) in &payload.headers {
        req = req.header(key, value);
    }

    if let Some(body) = payload.body {
        req = req.body(body);
    }

    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("Request timed out after {} seconds", REQUEST_TIMEOUT_SECS)
        } else {
            e.to_string()
        }
    })?;

    let status = res.status().as_u16();
    let status_text = res.status().canonical_reason().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for (key, value) in res.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    let body_bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if body_bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "Response too large: {} bytes (limit: {} bytes)",
            body_bytes.len(),
            MAX_RESPONSE_BYTES
        ));
    }
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers,
        body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![http_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
