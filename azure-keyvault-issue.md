# Integrate Azure Key Vault to resolve provider secrets as environment variables

## Summary

The app already recognizes `ProviderVariable` objects in `http-client.env.json` (with a `provider` field), but currently resolves them as **placeholders** (e.g. `[AzureKeyVault:secretName]`) instead of fetching actual secret values. We need to implement real Azure Key Vault integration so that secrets can be used as environment variables at runtime.

## Current State

- **`src/lib/types.ts`** — `ProviderVariable` interface exists (`provider`, plus arbitrary string keys)
- **`src/lib/parser.ts`** — `mergeEnvVars()` (~line 1115) detects provider objects but inserts a placeholder string instead of resolving them
- **`http-client.env.json`** — supports the structure but no real provider entries exist yet

## Design

### Secret Format

**JSON only.** This is the industry standard for bundling key-value pairs in a single Key Vault secret — used by Terraform (`jsonencode()`), ARM/Bicep, Azure CLI, and Azure DevOps pipelines. The Azure Portal's secret editor handles JSON reliably (no whitespace issues like YAML, no escaping ambiguity like dotenv).

The Key Vault secret value:
```json
{"ApiKey": "sk-abc123", "DbPassword": "hunter2", "StripeKey": "pk_live_xyz"}
```

### Configuration

A `$keyvault` entry per environment in `http-client.env.json`:

```json
{
  "production": {
    "LocalToken": "my-local-value",
    "$keyvault": {
      "provider": "AzureKeyVault",
      "vaultUrl": "https://my-vault.vault.azure.net",
      "secretName": "production-env"
    }
  }
}
```

The resolver fetches the secret, parses the JSON, and expands the key-value pairs into the variable list.

### Rust Backend

Add Azure SDK crates to `src-tauri/Cargo.toml`:

```toml
azure_security_keyvault_secrets = "0.4"
azure_identity = "0.22"
```

Create a Tauri command in `src-tauri/src/lib.rs` that:
- Takes a `vault_url` and `secret_name`
- Authenticates via `DefaultAzureCredential` (supports Azure CLI, env vars, managed identity)
- Fetches the secret value
- Returns the raw string (frontend parses the JSON)

```rust
#[tauri::command]
async fn resolve_keyvault_secret(vault_url: String, secret_name: String) -> Result<String, String> {
    let credential = azure_identity::DefaultAzureCredential::new().map_err(|e| e.to_string())?;
    let client = azure_security_keyvault_secrets::SecretClient::new(&vault_url, credential)
        .map_err(|e| e.to_string())?;
    let secret = client.get_secret(&secret_name).await.map_err(|e| e.to_string())?;
    Ok(secret.value)
}
```

### Frontend — Variable Resolution

Update `mergeEnvVars` in `src/lib/parser.ts` to:
1. Detect `$keyvault` entries
2. Call the Tauri command via `invoke()`
3. Parse the returned JSON string into a `Record<string, string>`
4. Tag each variable with a `source` for UI rendering

This makes `mergeEnvVars` and its callers `async`.

### Environment Editor UX

Each variable row is tagged with a source: `local`, `vault`, or `conflict`.

**Visual indicators:**
- **Local-only vars** — render as today (editable, checkbox toggles enable/disable)
- **Vault-only vars** — read-only value field, small `KV` badge/pill next to value, checkbox to skip this session
- **Conflict vars** (same key in both local and vault) — checkbox controls whether to use the **local** value (checked) or fall through to the **vault** value (unchecked). The vault value is shown in a muted sub-line beneath the local value for comparison.

**Conflict banner** — only shown when overlaps exist:

> **Key Vault conflict** — `ApiKey` exists both locally and in Key Vault. The local value is used by default. Uncheck to use the Key Vault value instead.

Example rendering:
```
 Variable           Value                          Source
─────────────────────────────────────────────────────────────
 [x] LocalToken     my-local-value                           (editable)
 [x] StripeKey      pk_live_xyz            [KV]              (read-only)
─────────────────────────────────────────────────────────────
 ⚠ 1 conflict with Key Vault
─────────────────────────────────────────────────────────────
 [x] ApiKey         local-override         [KV]              (editable)
                    ↳ vault: sk-abc123                       (muted sub-line)
```

**Session-only state** — conflict checkbox preferences are not persisted to `http-client.env.json`.

### Authentication

`DefaultAzureCredential` tries these methods in order (no login UI required):
- Environment variables (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`)
- Azure CLI (`az login`) — most convenient for local dev
- Managed Identity — for deployed scenarios

## Files to Change

| Layer | File(s) | Change |
|-------|---------|--------|
| Rust deps | `src-tauri/Cargo.toml` | Add `azure_security_keyvault_secrets` + `azure_identity` |
| Rust command | `src-tauri/src/lib.rs` | Add `resolve_keyvault_secret` Tauri command |
| Types | `src/lib/types.ts` | Add `source` field to `EnvVar` or equivalent type |
| Resolver | `src/lib/parser.ts` | Make `mergeEnvVars` async, detect `$keyvault`, call `invoke()`, parse JSON, tag sources |
| UI | `src/components/EnvironmentEditor.svelte` | Vault badge, read-only vault rows, conflict banner, sub-line for vault values |

## Acceptance Criteria

- [ ] `$keyvault` entries in `http-client.env.json` are fetched and expanded into individual variables
- [ ] Secret value is parsed as flat JSON (`Record<string, string>`)
- [ ] Vault-sourced variables display a `KV` badge and are read-only in the editor
- [ ] Overlapping keys show a conflict banner with the vault value visible for comparison
- [ ] User can uncheck a local value to fall through to the vault value (session-only, not persisted)
- [ ] Graceful error handling when vault is unreachable or credentials are missing
- [ ] Existing string-based environment variables continue to work unchanged
