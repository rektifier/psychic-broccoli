# Psychic Broccoli

A lightweight desktop HTTP client built with **Tauri v2 + Svelte + TypeScript + Rust**.
Reads `.http` files compatible with Visual Studio, VS Code REST Client, and JetBrains HTTP Client.

## Features

- **Workspace browser** - open a folder and discover all `.http`/`.rest` files automatically
- **Full .http spec** - comments, separators, variables, body, all 9 HTTP methods
- **Environment system** - `http-client.env.json` + `.user` overrides + `$shared`
- **Inline environment editor** - add, rename, delete environments and variables
- **Variable substitution** - file variables, environment variables, chained references
- **Request chaining** - name a request with `@name`, reference its response in other requests
- **Variable picker** - insert variables from environment, dynamic values, or response data
- **Dynamic variables** - `$randomInt`, `$datetime`, `$timestamp`, `$localDatetime`
- **Resolved URL preview** - see the fully substituted URL before sending
- **Header autocomplete** - common HTTP headers suggested when adding headers
- **Resizable panes** - draggable divider between request editor and response viewer
- **Raw request view** - inspect the exact request that was sent (method, URL, headers, body)
- **No CORS issues** - HTTP requests are made from Rust via `reqwest`, not the browser
- **Keyboard shortcut** - Ctrl+Enter to send
- **Cross-platform** - builds for Windows, macOS, and Linux

## Project structure

```
src/
  App.svelte                    Main app layout, request execution, file I/O
  main.ts                       Svelte entry point
  lib/
    types.ts                    TypeScript interfaces
    parser.ts                   .http parser, serializer, variable substitution engine
    stores.ts                   Svelte stores (workspace, env, named results)
  components/
    TreeSidebar.svelte          Sidebar with folder picker, env selector, file tree
    TreeNode.svelte             Recursive tree item (folder/file/request)
    RequestEditor.svelte        URL bar, headers, body editor
    ResponseViewer.svelte       Response body, headers, raw request tabs
    EnvironmentEditor.svelte    Environment variable editor
    DependencyBar.svelte        Shows request dependencies (chained requests)
    VariablePicker.svelte       Modal for inserting variables

src-tauri/
  src/lib.rs                    Rust HTTP client (reqwest) exposed via Tauri invoke
  src/main.rs                   Tauri window entry point
  capabilities/default.json     Plugin permissions (fs, dialog, http)
  Cargo.toml                    Rust dependencies

.github/workflows/
  release.yml                   GitHub Actions workflow for building releases
```

## Download

Grab the latest installer for your platform from [GitHub Releases](../../releases).

| Platform | Format |
| --- | --- |
| Windows | `.msi` / `.exe` |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.deb` / `.AppImage` |

## .http file syntax

### Requests

```http
GET https://api.example.com/users
```

Full format: `METHOD URL [HTTP/version]`.
Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE, CONNECT.

### Request separators

```http
### Get all users
GET https://api.example.com/users

### Get all posts
GET https://api.example.com/posts
```

### Comments

```http
# This is a comment
// This is also a comment
```

### Headers

Headers go immediately after the request line (no blank line):

```http
GET https://api.example.com/users
Authorization: Bearer my-token
Accept: application/json
```

### Request body

A blank line separates headers from body:

```http
POST https://api.example.com/users
Content-Type: application/json

{
  "name": "Jane",
  "email": "jane@example.com"
}
```

### File-level variables

```http
@hostname = localhost
@port = 44320
@host = {{hostname}}:{{port}}

GET https://{{host}}/api/users
```

Variables can reference other variables, including environment variables.

## Environment system

### http-client.env.json

Place in the workspace root alongside your `.http` files:

```json
{
  "$shared": {
    "BaseUrl": "https://localhost:5000",
    "ContentType": "application/json"
  },
  "dev": {
    "Token": "dev-token-123"
  },
  "staging": {
    "BaseUrl": "https://staging.api.com",
    "Token": "staging-token-789"
  }
}
```

`$shared` variables are available to all environments as defaults.

### http-client.env.json.user

User-specific overrides (should be gitignored):

```json
{
  "dev": {
    "Token": "my-personal-dev-token"
  }
}
```

### Variable resolution priority

| Priority | Source |
|----------|--------|
| 1 | File-level `@variable` in the `.http` file |
| 2 | `.user` file, environment-specific |
| 3 | env file, environment-specific |
| 4 | `.user` file, `$shared` |
| 5 | env file, `$shared` |

## Request chaining

Name a request with `# @name` or `// @name`, then reference its response:

```http
// @name login
POST https://api.example.com/auth/token
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}

###

GET https://api.example.com/protected
Authorization: Bearer {{login.response.body.$.token}}
```

### Reference syntax

```
{{name.response.body.*}}              - entire body
{{name.response.body.$.token}}        - JSON path
{{name.response.body.$.data[0].id}}   - JSON path with array index
{{name.response.headers.Location}}    - response header
```

## Dynamic variables

```http
GET https://api.example.com/posts/{{$randomInt 1 100}}
X-Timestamp: {{$timestamp}}
X-Date: {{$datetime iso8601}}
X-Tomorrow: {{$datetime iso8601 1 d}}
X-Local: {{$localDatetime iso8601}}
```

| Variable | Description |
| --- | --- |
| `$randomInt [min max]` | Random integer (default 0-1000) |
| `$timestamp [offset]` | Unix epoch seconds (UTC) |
| `$datetime format [offset]` | UTC datetime string |
| `$localDatetime format [offset]` | Local timezone datetime |
| `$processEnv NAME` | OS environment variable (placeholder) |
| `$dotenv NAME` | `.env` file variable (placeholder) |

Offset units: `ms`, `s`, `m`, `h`, `d`, `w`, `M`, `y`.

## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)
- Tauri v2 system dependencies for your platform - see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Development setup

```bash
git clone -b develop https://github.com/rektifier/psychic-broccoli.git
cd psychic-broccoli
pnpm install
pnpm tauri dev
```

This starts the Vite dev server on port 1420 and opens the Tauri window with hot-reload.

### Useful commands

```bash
pnpm dev              # Vite dev server only (no Tauri window)
pnpm build            # Production frontend build
pnpm check            # TypeScript / Svelte type checking
pnpm tauri build      # Full production desktop build
```

### Releasing

The project uses a `develop` / `main` branch workflow. Day-to-day work happens on `develop`. When ready to release:

```bash
git checkout main
git merge develop
git tag v0.1.0
git push origin main --tags
```

Pushing a `v*` tag triggers the GitHub Actions release workflow, which builds installers for all platforms and creates a draft release with the assets attached.

The version is defined in two places - update both before tagging:

- `src-tauri/tauri.conf.json` - `version` field
- `src-tauri/Cargo.toml` - `version` field

## License

MIT
