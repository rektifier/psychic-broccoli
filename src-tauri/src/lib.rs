use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

mod mcp;

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
    /// "utf8" when `body` is the response text as-is, "base64" when the raw
    /// bytes were not valid UTF-8 and `body` holds their base64 encoding.
    body_encoding: String,
    /// Byte length of the raw response body (before any base64 encoding).
    size: usize,
}

/// Collect response headers into the map the frontend expects, joining
/// repeated headers (e.g. multiple Set-Cookie) with ", " so no value is
/// silently dropped.
fn collect_headers(map: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    let mut headers: HashMap<String, String> = HashMap::new();
    for (key, value) in map {
        if let Ok(v) = value.to_str() {
            headers
                .entry(key.to_string())
                .and_modify(|existing| {
                    existing.push_str(", ");
                    existing.push_str(v);
                })
                .or_insert_with(|| v.to_string());
        }
    }
    headers
}

/// Encode a response body for the JSON bridge: valid UTF-8 passes through
/// unchanged; binary bodies (images, gzip, protobuf) are base64-encoded so
/// the bytes survive instead of being mangled by lossy conversion.
fn encode_body(bytes: Vec<u8>) -> (String, &'static str) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, "utf8"),
        Err(err) => (BASE64_STANDARD.encode(err.as_bytes()), "base64"),
    }
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
            || (v6.segments()[0] == 0xfe80) // fe80::/10 link-local
        }
    }
}

const BLOCKED_ADDR_MSG: &str =
    "Requests to this address are blocked (link-local, broadcast, or unspecified)";
const NO_ADDRS_MSG: &str = "Host resolved to no addresses";

/// Reject a DNS resolution if it is empty or contains any blocked address.
/// Blocking when *any* resolved IP is blocked prevents an attacker-controlled
/// DNS record from smuggling a blocked address in among safe ones.
fn check_resolved_addrs(addrs: &[SocketAddr]) -> Result<(), String> {
    if addrs.is_empty() {
        return Err(NO_ADDRS_MSG.to_string());
    }
    for sa in addrs {
        if is_blocked_ip(&sa.ip()) {
            return Err(BLOCKED_ADDR_MSG.to_string());
        }
    }
    Ok(())
}

/// DNS resolver that enforces the IP blocklist on every resolved address.
/// reqwest consults DNS for the initial request and for each redirect hop, so
/// this blocks redirects to hostnames whose DNS records point into a blocked
/// range (the redirect policy can only inspect IP-literal hosts) and closes
/// the TOCTOU window between URL validation and connection.
struct BlocklistDnsResolver;

impl reqwest::dns::Resolve for BlocklistDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            check_resolved_addrs(&addrs)?;
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Extract the IP address from a URL host when it is an IP literal.
/// `url::Host` is used instead of parsing `host_str()` because `host_str()`
/// returns IPv6 literals with their surrounding brackets ("[fe80::1]"),
/// which `IpAddr::from_str` rejects - the connector strips the brackets and
/// dials such hosts directly, so a string-based check would miss them.
fn host_ip(url: &url::Url) -> Option<IpAddr> {
    match url.host()? {
        url::Host::Ipv4(v4) => Some(IpAddr::V4(v4)),
        url::Host::Ipv6(v6) => Some(IpAddr::V6(v6)),
        url::Host::Domain(_) => None,
    }
}

/// Validate that a URL is safe to request: correct scheme, has a host, and
/// if the host is an IP literal it is not a blocked address. IP literals
/// must be checked here because the connector dials them directly without
/// consulting the DNS resolver. Hostname targets are validated at resolution
/// time by `BlocklistDnsResolver`, which checks every lookup the connector
/// performs, so the addresses that are checked are exactly the addresses
/// that are dialed (no TOCTOU window).
fn validate_url(url_str: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url_str).map_err(|_| "Invalid URL format".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http:// and https:// URLs are allowed".to_string()),
    }

    if parsed.host().is_none() {
        return Err("URL must contain a host".to_string());
    }

    // Block a narrow set of never-valid or dangerous direct IP addresses
    // (link-local/cloud metadata, broadcast, unspecified, CGNAT).
    if let Some(ip) = host_ip(&parsed) {
        if is_blocked_ip(&ip) {
            return Err(BLOCKED_ADDR_MSG.to_string());
        }
    }

    Ok(())
}

/// Custom redirect policy that re-validates each redirect target URL to
/// prevent SSRF via open redirect chains. The policy closure is synchronous,
/// so it can only check IP-literal hosts here; hostname targets are checked
/// at resolution time by `BlocklistDnsResolver`.
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
        if let Some(ip) = host_ip(url) {
            if is_blocked_ip(&ip) {
                return attempt.error("Redirect to blocked address");
            }
        }
        attempt.follow()
    })
}

/// Shared HTTP client, built once and reused for every request so TCP
/// connections and TLS sessions are pooled across requests. Sharing is safe
/// because every builder setting (timeout, redirect policy, DNS resolver) is
/// identical for all requests; anything request-specific (method, URL,
/// headers, body) is set on the RequestBuilder.
///
/// SSRF enforcement does not need per-request DNS pinning: every hostname
/// lookup the connector performs (initial request, each redirect hop, and
/// any reconnect) goes through `BlocklistDnsResolver`, and the addresses it
/// validates are exactly the addresses the connector then dials, so a DNS
/// answer cannot swap to a blocked address between check and use. IP-literal
/// hosts skip DNS entirely and are checked synchronously in `validate_url`
/// (initial URL) and the redirect policy (redirect targets); literals cannot
/// rebind, so there is no TOCTOU window for them either.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(ssrf_safe_redirect_policy())
        .dns_resolver(BlocklistDnsResolver)
        .build()
        .map_err(|_| "Failed to initialize HTTP client".to_string())?;
    // A concurrent first call may have won the race; get_or_init returns the
    // stored client either way and the extra one is dropped.
    Ok(HTTP_CLIENT.get_or_init(|| client))
}

/// Surface a `BlocklistDnsResolver` rejection from a send error. The
/// resolver's error is wrapped in reqwest/hyper connect errors, so walk the
/// source chain looking for our known messages; without this, a blocked
/// hostname would show only a generic "Connection failed" message.
fn resolver_block_message(e: &reqwest::Error) -> Option<String> {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = source {
        let msg = err.to_string();
        if msg.contains(BLOCKED_ADDR_MSG) {
            return Some(BLOCKED_ADDR_MSG.to_string());
        }
        if msg.contains(NO_ADDRS_MSG) {
            return Some(NO_ADDRS_MSG.to_string());
        }
        source = err.source();
    }
    None
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    validate_url(&payload.url)?;

    let client = http_client()?;

    let method = payload
        .method
        .parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &payload.url);

    for (key, value) in &payload.headers {
        req = req.header(key, value);
    }

    if let Some(body) = payload.body {
        req = req.body(body);
    }

    let res = req.send().await.map_err(|e| {
        if let Some(msg) = resolver_block_message(&e) {
            msg
        } else if e.is_timeout() {
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

    let headers = collect_headers(res.headers());

    // Stream the response body with a size limit to prevent OOM from
    // malicious or unexpectedly large responses.
    let capacity = res
        .content_length()
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
    let size = body_bytes.len();
    let (body, body_encoding) = encode_body(body_bytes);

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers,
        body,
        body_encoding: body_encoding.to_string(),
        size,
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
        let parsed = url::Url::parse(url_str).map_err(|e| format!("Invalid vault URL: {}", e))?;
        if parsed.scheme() != "https" {
            return Err("Vault URL must use https://".to_string());
        }
        match parsed.host_str() {
            Some(host) => {
                let lower = host.to_lowercase();
                let prefix = lower
                    .strip_suffix(".vault.azure.net")
                    .ok_or_else(|| "Vault URL host must end with .vault.azure.net".to_string())?;
                if prefix.is_empty()
                    || !prefix
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-')
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
            return Err(
                "Secret name may only contain alphanumeric characters and hyphens".to_string(),
            );
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn fetch_keyvault_secret(
        payload: KeyVaultPayload,
    ) -> Result<KeyVaultResponse, String> {
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
        .map_err(|_| {
            format!(
                "Key Vault request timed out after {} seconds",
                REQUEST_TIMEOUT_SECS
            )
        })?
        .map_err(|e| format!("Failed to fetch secret '{}': {}", payload.secret_name, e))?;

        let secret = response
            .into_model()
            .map_err(|e| format!("Failed to parse secret '{}': {}", payload.secret_name, e))?;

        let value = secret
            .value
            .ok_or_else(|| format!("Secret '{}' exists but has no value", payload.secret_name))?;

        Ok(KeyVaultResponse { value })
    }
}

/// Stub used when the `keyvault` feature is disabled, so the invoke handler
/// list in `run()` can be defined once for both feature configurations.
#[cfg(not(feature = "keyvault"))]
mod keyvault_cmd {
    #[tauri::command]
    pub async fn fetch_keyvault_secret(
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let _ = payload;
        Err(
            "Key Vault support is not enabled in this build (built without the `keyvault` feature)"
                .to_string(),
        )
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
    match (
        std::fs::read_to_string(bundled),
        std::fs::read_to_string(existing),
    ) {
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
                .map_err(|e| {
                    tauri::Error::Io(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        e.to_string(),
                    ))
                })
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
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(mcp::McpServerState::default())
        .setup(|app| {
            mcp::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http_request,
            extract_getting_started,
            keyvault_cmd::fetch_keyvault_secret,
            mcp::mcp_get_settings,
            mcp::mcp_is_running,
            mcp::mcp_set_enabled,
            mcp::mcp_set_port
        ])
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

    #[test]
    fn validate_url_allows_localhost_literal() {
        let res = validate_url("http://127.0.0.1:8080/health");
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[test]
    fn validate_url_allows_ipv6_loopback_literal() {
        let res = validate_url("http://[::1]:8080/");
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[test]
    fn validate_url_allows_rfc1918_literal() {
        let res = validate_url("http://192.168.1.10/");
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[test]
    fn validate_url_blocks_cloud_metadata() {
        let res = validate_url("http://169.254.169.254/latest/meta-data/");
        assert!(res.is_err(), "expected Err, got {:?}", res);
    }

    #[test]
    fn validate_url_blocks_unspecified() {
        let res = validate_url("http://0.0.0.0/");
        assert!(res.is_err(), "expected Err, got {:?}", res);
    }

    #[test]
    fn validate_url_blocks_ipv6_link_local_literal() {
        // host_str() would return "[fe80::1]" (with brackets), which does not
        // parse as an IpAddr; host() must be used to catch bracketed literals.
        let res = validate_url("http://[fe80::1]/");
        assert!(res.is_err(), "expected Err, got {:?}", res);
    }

    #[test]
    fn validate_url_defers_hostname_checks_to_resolver() {
        // Hostnames pass URL validation; they are checked when the connector
        // resolves them through BlocklistDnsResolver.
        let res = validate_url("http://any-hostname.example/");
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[test]
    fn validate_url_rejects_non_http_scheme() {
        let res = validate_url("ftp://example.com/");
        assert!(res.is_err());
    }

    #[test]
    fn host_ip_parses_bracketed_ipv6_literal() {
        let url = url::Url::parse("http://[fe80::1]:8080/").unwrap();
        assert_eq!(host_ip(&url), Some(ip("fe80::1")));
        let url = url::Url::parse("http://169.254.169.254/").unwrap();
        assert_eq!(host_ip(&url), Some(ip("169.254.169.254")));
        let url = url::Url::parse("http://example.com/").unwrap();
        assert_eq!(host_ip(&url), None);
    }

    #[tokio::test]
    async fn http_client_is_shared_across_calls() {
        let a = http_client().expect("client should build");
        let b = http_client().expect("client should build");
        assert!(std::ptr::eq(a, b), "expected the same client instance");
    }

    fn sa(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn check_resolved_addrs_allows_loopback_and_public() {
        assert!(check_resolved_addrs(&[sa("127.0.0.1:80")]).is_ok());
        assert!(check_resolved_addrs(&[sa("1.1.1.1:443"), sa("192.168.1.10:443")]).is_ok());
    }

    #[test]
    fn check_resolved_addrs_blocks_metadata() {
        assert!(check_resolved_addrs(&[sa("169.254.169.254:80")]).is_err());
        // A single blocked address among safe ones must fail the whole resolution
        assert!(check_resolved_addrs(&[sa("1.1.1.1:80"), sa("169.254.169.254:80")]).is_err());
        assert!(check_resolved_addrs(&[sa("[fe80::1]:80")]).is_err());
        assert!(check_resolved_addrs(&[sa("100.64.0.1:80")]).is_err());
    }

    #[test]
    fn check_resolved_addrs_rejects_empty() {
        assert!(check_resolved_addrs(&[]).is_err());
    }

    #[test]
    fn collect_headers_joins_duplicates() {
        let mut map = reqwest::header::HeaderMap::new();
        map.append("set-cookie", "a=1".parse().unwrap());
        map.append("set-cookie", "b=2".parse().unwrap());
        map.insert("content-type", "text/plain".parse().unwrap());
        let headers = collect_headers(&map);
        assert_eq!(headers.get("set-cookie").unwrap(), "a=1, b=2");
        assert_eq!(headers.get("content-type").unwrap(), "text/plain");
    }

    #[test]
    fn encode_body_passes_utf8_through() {
        let (body, encoding) = encode_body("hello åäö".as_bytes().to_vec());
        assert_eq!(body, "hello åäö");
        assert_eq!(encoding, "utf8");
    }

    #[test]
    fn encode_body_base64_encodes_binary() {
        let bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0x00];
        let (body, encoding) = encode_body(bytes.clone());
        assert_eq!(encoding, "base64");
        assert_eq!(BASE64_STANDARD.decode(&body).unwrap(), bytes);
    }

    #[tokio::test]
    async fn blocklist_resolver_resolves_localhost() {
        use reqwest::dns::Resolve;
        let name: reqwest::dns::Name = "localhost".parse().unwrap();
        let addrs: Vec<SocketAddr> = BlocklistDnsResolver
            .resolve(name)
            .await
            .expect("localhost should resolve")
            .collect();
        assert!(!addrs.is_empty());
        assert!(addrs.iter().all(|a| a.ip().is_loopback()));
    }
}
