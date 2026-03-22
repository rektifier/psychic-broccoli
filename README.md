# Psychic Broccoli

[![CI](https://img.shields.io/github/actions/workflow/status/rektifier/psychic-broccoli/ci.yml?branch=develop&style=flat-square&label=CI)](https://github.com/rektifier/psychic-broccoli/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/rektifier/psychic-broccoli?style=flat-square)](https://github.com/rektifier/psychic-broccoli/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()

A lightweight, cross-platform desktop HTTP client built with **Tauri v2**, **Svelte**, **TypeScript**, and **Rust**. Psychic Broccoli reads `.http` files compatible with Visual Studio, VS Code REST Client, and JetBrains HTTP Client — giving you a fast, native alternative to browser-based API tools.

> **No CORS. No Electron. No bloat.** HTTP requests are dispatched from Rust via `reqwest`, so you never hit browser sandbox restrictions.


![File tree and request editor](https://github.com/user-attachments/assets/f6d7ef96-3fe2-450a-8f07-7008599053c3)
![Response viewer with headers and body](https://github.com/user-attachments/assets/f5253b75-ae2b-4637-94ac-2ac42c8461d5)
![Environment editor and variable picker](https://github.com/user-attachments/assets/e7bd9aac-3884-4559-91ed-42641fe678d1)

---

## Table of Contents

- [Features](#features)
- [Download](#download)
- [`.http` File Syntax](#http-file-syntax)
- [Environment System](#environment-system)
- [Request Chaining](#request-chaining)
- [Dynamic Variables](#dynamic-variables)
- [Pb Script Engine](#pb-script-engine)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Features

**Workspace & Files**
- Open a folder and automatically discover all `.http` / `.rest` files.
- Full `.http` spec support — comments, separators, variables, body, and all nine HTTP methods.

**Environments & Variables**
- `http-client.env.json` with `$shared` defaults, per-environment overrides, and `.user` file support.
- Inline environment editor for adding, renaming, and deleting environments and variables.
- Variable substitution with file-level, environment, and chained references.
- Dynamic variables: `$randomInt`, `$datetime`, `$timestamp`, `$localDatetime`.

**Request Workflow**
- Request chaining — name a request with `@name` and reference its response in subsequent requests.
- Variable picker modal for inserting environment, dynamic, or response-data variables.
- Resolved URL preview showing the fully substituted URL before sending.
- Header autocomplete for common HTTP headers.

**Interface**
- Resizable panes with a draggable divider between the request editor and response viewer.
- Raw request view to inspect the exact method, URL, headers, and body that were sent.
- Keyboard shortcut: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send.

---

## Download

Grab the latest installer from [**GitHub Releases**](https://github.com/rektifier/psychic-broccoli/releases).

| Platform             | Format              |
| -------------------- | ------------------- |
| Windows              | `.msi` / `.exe`     |
| macOS (Apple Silicon) | `.dmg`             |
| macOS (Intel)        | `.dmg`              |
| Linux                | `.deb` / `.AppImage` |

---

## `.http` File Syntax

### Requests

```http
GET https://api.example.com/users
```

Full format: `METHOD URL [HTTP/version]`
Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`.

### Separators & Comments

```http
### Get all users
GET https://api.example.com/users

### Create a user
# This is a comment
// This is also a comment
POST https://api.example.com/users
```

### Headers & Body

Headers follow the request line with no blank line. A blank line separates headers from the body.

```http
POST https://api.example.com/users
Content-Type: application/json
Authorization: Bearer my-token

{
  "name": "Jane",
  "email": "jane@example.com"
}
```

### File-Level Variables

```http
@hostname = localhost
@port = 44320
@host = {{hostname}}:{{port}}

GET https://{{host}}/api/users
```

Variables can reference other variables, including those from the environment system.

---

## Environment System

### `http-client.env.json`

Place this file in the workspace root alongside your `.http` files:

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

### `http-client.env.json.user`

User-specific overrides that should be added to `.gitignore`:

```json
{
  "dev": {
    "Token": "my-personal-dev-token"
  }
}
```

### Resolution Priority

| Priority | Source |
| :------: | ------ |
| 1        | File-level `@variable` in the `.http` file |
| 2        | `.user` file — environment-specific |
| 3        | `env` file — environment-specific |
| 4        | `.user` file — `$shared` |
| 5        | `env` file — `$shared` |

---

## Request Chaining

Name a request with `# @name` or `// @name`, then reference its response downstream:

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

### Reference Syntax

| Pattern | Description |
| ------- | ----------- |
| `{{name.response.body.*}}` | Entire response body |
| `{{name.response.body.$.token}}` | JSON path |
| `{{name.response.body.$.data[0].id}}` | JSON path with array index |
| `{{name.response.headers.Location}}` | Response header value |

---

## Dynamic Variables

```http
GET https://api.example.com/posts/{{$randomInt 1 100}}
X-Timestamp: {{$timestamp}}
X-Date: {{$datetime iso8601}}
X-Tomorrow: {{$datetime iso8601 1 d}}
X-Local: {{$localDatetime iso8601}}
```

| Variable | Description |
| -------- | ----------- |
| `$randomInt [min max]` | Random integer (default 0–1000) |
| `$timestamp [offset]` | Unix epoch seconds (UTC) |
| `$datetime format [offset]` | UTC datetime string |
| `$localDatetime format [offset]` | Local timezone datetime |
| `$processEnv NAME` | OS environment variable *(placeholder)* |
| `$dotenv NAME` | `.env` file variable *(placeholder)* |

Offset units: `ms`, `s`, `m`, `h`, `d`, `w`, `M`, `y`.

---

## Pb Script Engine

Psychic Broccoli includes a built-in scripting system using `# @pb.*` comment directives in `.http` files. Directives are attached to requests and executed after the response is received.

### Directive types

| Directive | Description |
| --------- | ----------- |
| `# @pb.assert(expr, "label")` | Assert a condition; result is pass/fail with the given label |
| `# @pb.set("key", expr)` | Store a value as a file-level variable for subsequent requests |
| `# @pb.global("key", expr)` | Store a value as a global variable (persists across files) |

### Expression syntax

Expressions can reference:

- `pb.response.status` - HTTP status code
- `pb.response.body.$.path` - JSONPath into response body
- `pb.response.headers.Header-Name` - Response header value
- `pb.request.url`, `pb.request.method`, `pb.request.body` - Request properties
- Comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`

### Example

```http
GET {{baseUrl}}/api/users/1
Authorization: {{token}}

# @pb.assert(pb.response.status == 200, "Should return 200")
# @pb.assert(pb.response.body.$.name != null, "Name should exist")
# @pb.set("userId", pb.response.body.$.id)
```

---

## Architecture

All `.http` parsing, variable resolution, and scripting happens on the frontend in TypeScript. The Tauri/Rust backend is intentionally thin - it serves only as an HTTP proxy (via `reqwest`) to bypass CORS and browser sandbox restrictions. This means the frontend contains the core logic, and the backend requires minimal changes for most feature work.

---

## Project Structure

```
src/
├── App.svelte                  Main layout, request execution, file I/O
├── main.ts                     Svelte entry point
├── lib/
│   ├── types.ts                TypeScript interfaces
│   ├── parser.ts               .http parser, serializer, variable engine
│   └── stores.ts               Svelte stores (workspace, env, results)
└── components/
    ├── TreeSidebar.svelte      Folder picker, env selector, file tree
    ├── TreeNode.svelte         Recursive tree item (folder / file / request)
    ├── RequestEditor.svelte    URL bar, headers, body editor
    ├── ResponseViewer.svelte   Response body, headers, raw request tabs
    ├── EnvironmentEditor.svelte  Environment variable editor
    ├── DependencyBar.svelte    Request dependency indicators
    └── VariablePicker.svelte   Variable insertion modal

src-tauri/
├── src/lib.rs                  Rust HTTP client (reqwest) via Tauri invoke
├── src/main.rs                 Tauri window entry point
├── capabilities/default.json   Plugin permissions (fs, dialog, http)
└── Cargo.toml                  Rust dependencies

.github/workflows/
└── release.yml                 CI workflow for multi-platform builds
```

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for details on the development setup, branching strategy, commit conventions, and how to submit pull requests.

### Quick start

```bash
git clone -b develop https://github.com/rektifier/psychic-broccoli.git
cd psychic-broccoli
pnpm install
pnpm tauri dev
```

### Useful commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Vite dev server only (no Tauri window) |
| `pnpm build` | Production frontend build |
| `pnpm check` | TypeScript / Svelte type checking |
| `pnpm tauri build` | Full production desktop build |

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop framework
- [Svelte](https://svelte.dev/) - Frontend framework
- [reqwest](https://github.com/seanmonstar/reqwest) - Rust HTTP client
- [SignPath Foundation](https://signpath.org/) - Code signing for open source

---

## License

This project is licensed under the [MIT License](LICENSE).
