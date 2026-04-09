use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use futures_util::StreamExt;

const REQUEST_TIMEOUT_SECS: u64 = 30;
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS: usize = 5;

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

/// Check whether an IP address should be blocked even in a developer HTTP client.
/// Loopback and RFC1918 are intentionally allowed so users can hit local services
/// (see issue #79); this only blocks addresses that are never valid developer
/// targets and that include well-known SSRF risks like cloud metadata endpoints.
fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_link_local()          // 169.254.0.0/16 (incl. cloud metadata 169.254.169.254)
            || v4.is_broadcast()        // 255.255.255.255
            || v4.is_unspecified()      // 0.0.0.0
            || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64) // 100.64.0.0/10 (CGNAT)
        }
        IpAddr::V6(v6) => {
            // Check IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(&IpAddr::V4(v4));
            }
            v6.is_unspecified()                       // ::
            || (v6.segments()[0] == 0xfe80)           // fe80::/10 link-local
        }
    }
}

/// Validate that a URL is safe to request: correct scheme and non-private host.
/// Returns the validated (host, resolved IPs) pair so the caller can pin the
/// DNS resolution and prevent TOCTOU attacks.
async fn validate_url(url_str: &str) -> Result<(String, Vec<SocketAddr>), String> {
    let parsed = url::Url::parse(url_str)
        .map_err(|_| "Invalid URL format".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http:// and https:// URLs are allowed".to_string()),
    }

    let host = parsed.host_str()
        .ok_or_else(|| "URL must contain a host".to_string())?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);

    // Block a narrow set of never-valid or dangerous direct IP addresses
    // (link-local/cloud metadata, broadcast, unspecified, CGNAT).
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(&ip) {
            return Err("Requests to this address are blocked (link-local, broadcast, or unspecified)".to_string());
        }
        return Ok((host, vec![SocketAddr::new(ip, port)]));
    }

    // Resolve hostname and check all resulting IPs
    let addr = format!("{}:{}", host, port);
    let resolved: Vec<SocketAddr> = tokio::net::lookup_host(&addr).await
        .map_err(|_| "Failed to resolve host".to_string())?
        .collect();

    if resolved.is_empty() {
        return Err("Host resolved to no addresses".to_string());
    }

    for sa in &resolved {
        if is_blocked_ip(&sa.ip()) {
            return Err("Requests to this address are blocked (link-local, broadcast, or unspecified)".to_string());
        }
    }

    Ok((host, resolved))
}

/// Custom redirect policy that re-validates each redirect target URL to
/// prevent SSRF via open redirect chains.
fn ssrf_safe_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("Too many redirects");
        }
        let url = attempt.url();
        match url.scheme() {
            "http" | "https" => {}
            _ => return attempt.error("Redirect to non-HTTP scheme blocked"),
        }
        if let Some(host) = url.host_str() {
            if let Ok(ip) = host.parse::<IpAddr>() {
                if is_blocked_ip(&ip) {
                    return attempt.error("Redirect to blocked address");
                }
            }
        }
        attempt.follow()
    })
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let (host, resolved_addrs) = validate_url(&payload.url).await?;

    // Pin the DNS resolution we already validated to prevent TOCTOU attacks
    // where a second lookup could return a different (private) IP.
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(ssrf_safe_redirect_policy());

    for sa in &resolved_addrs {
        builder = builder.resolve(&host, *sa);
    }

    let client = builder.build()
        .map_err(|_| "Failed to initialize HTTP client".to_string())?;

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
        } else if e.is_connect() {
            "Connection failed - check that the server is reachable".to_string()
        } else if e.is_redirect() {
            "Too many redirects or unsafe redirect target".to_string()
        } else {
            "Request failed - check the URL and try again".to_string()
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

    // Stream the response body with a size limit to prevent OOM from
    // malicious or unexpectedly large responses.
    let capacity = res.content_length()
        .map(|len| len.min(MAX_RESPONSE_BYTES as u64) as usize)
        .unwrap_or(0);
    let mut body_bytes = Vec::with_capacity(capacity);
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Error reading response body".to_string())?;
        body_bytes.extend_from_slice(&chunk);
        if body_bytes.len() > MAX_RESPONSE_BYTES {
            return Err(format!(
                "Response too large (exceeded {} MB limit). Download aborted.",
                MAX_RESPONSE_BYTES / (1024 * 1024)
            ));
        }
    }
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers,
        body,
    })
}

#[cfg(feature = "keyvault")]
mod keyvault_cmd {
    use super::*;

    #[derive(Deserialize)]
    pub struct KeyVaultPayload {
        pub vault_url: String,
        pub secret_name: String,
    }

    #[derive(Serialize)]
    pub struct KeyVaultResponse {
        pub value: String,
    }

    fn validate_vault_url(url_str: &str) -> Result<(), String> {
        let parsed = url::Url::parse(url_str)
            .map_err(|e| format!("Invalid vault URL: {}", e))?;
        if parsed.scheme() != "https" {
            return Err("Vault URL must use https://".to_string());
        }
        match parsed.host_str() {
            Some(host) => {
                let lower = host.to_lowercase();
                let prefix = lower.strip_suffix(".vault.azure.net")
                    .ok_or_else(|| "Vault URL host must end with .vault.azure.net".to_string())?;
                if prefix.is_empty()
                    || !prefix.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                    || prefix.starts_with('-')
                    || prefix.ends_with('-')
                {
                    return Err("Invalid vault name in URL".to_string());
                }
                Ok(())
            }
            _ => Err("Vault URL host must end with .vault.azure.net".to_string()),
        }
    }

    fn validate_secret_name(name: &str) -> Result<(), String> {
        if name.is_empty() || name.len() > 127 {
            return Err("Secret name must be 1-127 characters".to_string());
        }
        if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Secret name may only contain alphanumeric characters and hyphens".to_string());
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn fetch_keyvault_secret(payload: KeyVaultPayload) -> Result<KeyVaultResponse, String> {
        validate_vault_url(&payload.vault_url)?;
        validate_secret_name(&payload.secret_name)?;

        let credential = azure_identity::DeveloperToolsCredential::new(None)
            .map_err(|e| format!(
                "Failed to create Azure credentials. Sign in with `az login` or `azd auth login`, then retry. Error: {}",
                e
            ))?;

        let client = azure_security_keyvault_secrets::SecretClient::new(
            &payload.vault_url,
            credential,
            None,
        )
        .map_err(|e| format!("Failed to create Key Vault client: {}", e))?;

        let response = tokio::time::timeout(
            Duration::from_secs(REQUEST_TIMEOUT_SECS),
            client.get_secret(&payload.secret_name, None),
        )
        .await
        .map_err(|_| format!(
            "Key Vault request timed out after {} seconds", REQUEST_TIMEOUT_SECS
        ))?
        .map_err(|e| format!("Failed to fetch secret '{}': {}", payload.secret_name, e))?;

        let secret = response
            .into_model()
            .map_err(|e| format!("Failed to parse secret '{}': {}", payload.secret_name, e))?;

        let value = secret.value.ok_or_else(|| {
            format!("Secret '{}' exists but has no value", payload.secret_name)
        })?;

        Ok(KeyVaultResponse { value })
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        // Skip symbolic links to prevent copying files from unexpected locations
        if file_type.is_symlink() {
            continue;
        }
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn should_update(source: &Path, target: &Path) -> bool {
    let bundled = source.join(".version");
    let existing = target.join(".version");
    match (std::fs::read_to_string(bundled), std::fs::read_to_string(existing)) {
        (Ok(src_ver), Ok(dst_ver)) => src_ver.trim() != dst_ver.trim(),
        _ => true,
    }
}

#[tauri::command]
async fn extract_getting_started(app_handle: tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;
    let source = resource_dir.join("getting-started");

    let documents = app_handle
        .path()
        .document_dir()
        .or_else(|_| {
            // Fallback for Linux without xdg-user-dirs
            std::env::var("HOME")
                .map(std::path::PathBuf::from)
                .map(|h| h.join("Documents"))
                .map_err(|e| tauri::Error::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    e.to_string(),
                )))
        })
        .map_err(|e| format!("Failed to resolve document dir: {}", e))?;
    let target = documents.join("Psychic Broccoli").join("getting-started");

    if should_update(&source, &target) {
        copy_dir_recursive(&source, &target)
            .map_err(|e| format!("Failed to copy getting-started: {}", e))?;
    }

    Ok(target.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "keyvault")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            http_request,
            extract_getting_started,
            keyvault_cmd::fetch_keyvault_secret
        ]);
    }

    #[cfg(not(feature = "keyvault"))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            http_request,
            extract_getting_started
        ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn allows_loopback_and_rfc1918() {
        assert!(!is_blocked_ip(&ip("127.0.0.1")));
        assert!(!is_blocked_ip(&ip("127.255.255.1")));
        assert!(!is_blocked_ip(&ip("::1")));
        assert!(!is_blocked_ip(&ip("10.0.0.1")));
        assert!(!is_blocked_ip(&ip("172.16.5.5")));
        assert!(!is_blocked_ip(&ip("192.168.1.10")));
        assert!(!is_blocked_ip(&ip("fc00::1")));
        assert!(!is_blocked_ip(&ip("fd12:3456:789a::1")));
    }

    #[test]
    fn allows_public_addresses() {
        assert!(!is_blocked_ip(&ip("1.1.1.1")));
        assert!(!is_blocked_ip(&ip("8.8.8.8")));
        assert!(!is_blocked_ip(&ip("2606:4700:4700::1111")));
    }

    #[test]
    fn blocks_link_local_and_metadata() {
        // Cloud metadata endpoint used by AWS/GCP/Azure
        assert!(is_blocked_ip(&ip("169.254.169.254")));
        assert!(is_blocked_ip(&ip("169.254.0.1")));
        assert!(is_blocked_ip(&ip("fe80::1")));
    }

    #[test]
    fn blocks_unspecified_and_broadcast() {
        assert!(is_blocked_ip(&ip("0.0.0.0")));
        assert!(is_blocked_ip(&ip("255.255.255.255")));
        assert!(is_blocked_ip(&ip("::")));
    }

    #[test]
    fn blocks_cgnat() {
        assert!(is_blocked_ip(&ip("100.64.0.1")));
        assert!(is_blocked_ip(&ip("100.127.255.254")));
        // Just outside CGNAT range should be allowed
        assert!(!is_blocked_ip(&ip("100.63.255.255")));
        assert!(!is_blocked_ip(&ip("100.128.0.0")));
    }

    #[test]
    fn blocks_ipv4_mapped_ipv6_metadata() {
        // ::ffff:169.254.169.254
        assert!(is_blocked_ip(&ip("::ffff:169.254.169.254")));
        // ::ffff:127.0.0.1 should now be allowed (loopback)
        assert!(!is_blocked_ip(&ip("::ffff:127.0.0.1")));
    }

    #[tokio::test]
    async fn validate_url_allows_localhost_literal() {
        let res = validate_url("http://127.0.0.1:8080/health").await;
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[tokio::test]
    async fn validate_url_allows_ipv6_loopback_literal() {
        let res = validate_url("http://[::1]:8080/").await;
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[tokio::test]
    async fn validate_url_allows_rfc1918_literal() {
        let res = validate_url("http://192.168.1.10/").await;
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[tokio::test]
    async fn validate_url_blocks_cloud_metadata() {
        let res = validate_url("http://169.254.169.254/latest/meta-data/").await;
        assert!(res.is_err(), "expected Err, got {:?}", res);
    }

    #[tokio::test]
    async fn validate_url_blocks_unspecified() {
        let res = validate_url("http://0.0.0.0/").await;
        assert!(res.is_err(), "expected Err, got {:?}", res);
    }

    #[tokio::test]
    async fn validate_url_rejects_non_http_scheme() {
        let res = validate_url("ftp://example.com/").await;
        assert!(res.is_err());
    }
}
