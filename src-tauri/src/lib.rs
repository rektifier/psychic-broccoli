use std::collections::HashMap;
use serde::{Deserialize, Serialize};

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

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let client = reqwest::Client::new();

    let method = payload.method.parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &payload.url);

    for (key, value) in &payload.headers {
        req = req.header(key, value);
    }

    if let Some(body) = payload.body {
        req = req.body(body);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let status_text = res.status().canonical_reason().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for (key, value) in res.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    let body = res.text().await.map_err(|e| e.to_string())?;

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
