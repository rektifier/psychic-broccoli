<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let visible: boolean = false;

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="overlay" on:click|self={close} role="dialog" tabindex="-1">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Quick guide</span>
        <button class="btn-close" on:click={close}>&times;</button>
      </div>

      <div class="section">
        <div class="section-title">Requests</div>
        <p>Open a folder containing <code>.http</code> or <code>.rest</code> files. Each file can hold multiple requests separated by <code>###</code>.</p>
        <pre class="code-block">### Get users
GET https://api.example.com/users
Authorization: Bearer my-token

### Create user
POST https://api.example.com/users
Content-Type: application/json

&#123;
  "name": "Jane"
&#125;</pre>
      </div>

      <div class="section">
        <div class="section-title">Variables</div>
        <p>Define file-level variables with <code>@name = value</code>. Reference any variable with <code>&#123;&#123;name&#125;&#125;</code>.</p>
        <pre class="code-block">@hostname = localhost
@port = 3000

GET https://&#123;&#123;hostname&#125;&#125;:&#123;&#123;port&#125;&#125;/api/users</pre>
      </div>

      <div class="section">
        <div class="section-title">Environments</div>
        <p>Place <code>http-client.env.json</code> in your workspace root. Use <code>$shared</code> for defaults shared across all environments.</p>
        <pre class="code-block">&#123;
  "$shared": &#123; "BaseUrl": "https://localhost:5000" &#125;,
  "dev": &#123; "Token": "dev-token-123" &#125;,
  "staging": &#123; "Token": "staging-token-789" &#125;
&#125;</pre>
        <p>Add a <code>http-client.env.json.user</code> file for personal overrides (gitignored).</p>
      </div>

      <div class="section">
        <div class="section-title">Azure Key Vault</div>
        <p>Pull secrets from Azure Key Vault directly into your environment variables. Sign in first with <code>az login</code> or <code>azd auth login</code>.</p>
        <p>Configure a vault per environment (or in <code>$shared</code>) by adding a <code>$keyvault</code> block to your env file, or use the Key Vault section in the environment editor.</p>
        <pre class="code-block">&#123;
  "$shared": &#123;
    "BaseUrl": "https://localhost:5000",
    "$keyvault": &#123;
      "provider": "AzureKeyVault",
      "vaultUrl": "https://my-vault.vault.azure.net",
      "secretName": "app-secrets"
    &#125;
  &#125;
&#125;</pre>
        <p>The secret value in Azure must be a flat JSON object with string values:</p>
        <pre class="code-block">&#123;
  "ApiKey": "sk-abc123",
  "DbPassword": "hunter2"
&#125;</pre>
        <p>Each key becomes a variable (e.g. <code>&#123;&#123;ApiKey&#125;&#125;</code>). If a key exists both locally and in Key Vault, the KV value wins by default - you can toggle per variable in the environment editor.</p>
      </div>

      <div class="section">
        <div class="section-title">Dynamic variables</div>
        <pre class="code-block">&#123;&#123;$randomInt 1 100&#125;&#125;      Random integer
&#123;&#123;$timestamp&#125;&#125;            Unix epoch (UTC)
&#123;&#123;$datetime iso8601&#125;&#125;     UTC datetime
&#123;&#123;$localDatetime iso8601&#125;&#125; Local datetime</pre>
      </div>

      <div class="section">
        <div class="section-title">Request chaining</div>
        <p>Name a request with <code>// @name</code>, then reference its response in later requests.</p>
        <pre class="code-block">// @name login
POST https://api.example.com/auth
Content-Type: application/json

&#123; "user": "admin", "pass": "secret" &#125;

###

GET https://api.example.com/protected
Authorization: Bearer &#123;&#123;login.response.body.$.token&#125;&#125;</pre>
      </div>

      <div class="section">
        <div class="section-title">The pb. prefix</div>
        <p>All scripting in Psychic Broccoli uses the <code>pb.</code> prefix. It gives you access to the current request and response, and lets you set variables, mutate requests, and write assertions.</p>
        <pre class="code-block"><strong>Read data</strong>
pb.response.status             HTTP status code
pb.response.statusText         Status text ("OK")
pb.response.body               Raw response body
pb.response.body.$.path        JSONPath into body
pb.response.body.$.items.length Array length
pb.response.headers.Name       Response header
pb.response.time               Response time (ms)
pb.response.size               Response size (bytes)
pb.request.url                 Request URL
pb.request.method              Request method
pb.request.body                Request body
pb.request.headers.Name        Request header

<strong>Write data</strong>
pb.set("key", expr)            Store a file-level variable
pb.global("key", expr)         Store a workspace variable
pb.assert(expr, "label")       Assert a condition

<strong>Mutate the request (Before Send only)</strong>
pb.set("request.url", expr)              Override URL
pb.set("request.header.Name", expr)      Set/replace a header
pb.set("request.body", expr)             Replace entire body
pb.set("request.body.$.path", expr)      Patch a JSON field</pre>
      </div>

      <div class="section">
        <div class="section-title">Before Send</div>
        <p>Scripts in the <strong>Before Send</strong> tab run after variables are resolved but before the request is sent. Use them to dynamically mutate the outgoing request.</p>
        <pre class="code-block"><strong>Add or override headers</strong>
pb.set("request.header.X-Request-Id", &#123;&#123;$timestamp&#125;&#125;)
pb.set("request.header.Authorization", "Bearer " + &#123;&#123;token&#125;&#125;)

<strong>Override the URL</strong>
pb.set("request.url", "https://fallback.example.com/api")

<strong>Patch JSON body fields</strong>
pb.set("request.body.$.timestamp", &#123;&#123;$timestamp&#125;&#125;)
pb.set("request.body.$.user.name", "Override Name")

<strong>Replace the entire body</strong>
pb.set("request.body", "&#123;\"key\": \"value\"&#125;")

<strong>Set variables for later use</strong>
pb.set("computedKey", "prefix-" + &#123;&#123;$randomInt 1 999&#125;&#125;)</pre>
      </div>

      <div class="section">
        <div class="section-title">After Receive</div>
        <p>Scripts in the <strong>After Receive</strong> tab run once the response arrives. Use them to extract values, store tokens, or validate responses.</p>
        <pre class="code-block"><strong>Extract and store values</strong>
pb.set("token", pb.response.body.$.access_token)
pb.set("userId", pb.response.body.$.data.user.id)
pb.global("sessionId", pb.response.body.$.session)

<strong>Store response metadata</strong>
pb.set("lastStatus", pb.response.status)
pb.set("responseTime", pb.response.time)
pb.set("contentType", pb.response.headers.Content-Type)

<strong>Chain into later requests</strong>
pb.global("authToken", pb.response.body.$.token)
pb.global("baseUrl", pb.response.body.$.config.apiUrl)</pre>
      </div>

      <div class="section">
        <div class="section-title">Assertions</div>
        <p>Add assertions in the <strong>Assertions</strong> tab. One assertion per line, with expression and label separated by <code> | </code>.</p>
        <pre class="code-block">expression | Label text
expression without a label</pre>
      </div>

      <div class="section">
        <div class="section-title">Assertion - Operators</div>
        <pre class="code-block"><strong>Comparison</strong>
pb.response.status == 200           | Equals
pb.response.status != 404           | Not equals
pb.response.body.$.count > 0        | Greater than
pb.response.body.$.count >= 1       | Greater or equal
pb.response.body.$.count &lt; 100      | Less than
pb.response.time &lt;= 500             | Less or equal

<strong>String matching</strong>
pb.response.body.$.name startsWith "John" | Starts with
pb.response.body.$.url endsWith ".pdf"    | Ends with
pb.response.headers.Content-Type contains "json" | Contains

<strong>Null checks</strong>
pb.response.body.$.token != null    | Value exists
pb.response.body.$.error == null    | Value is absent

<strong>Boolean</strong>
pb.response.body.$.active == true   | Is true
pb.response.body.$.deleted == false | Is false

<strong>Logic</strong>
pb.response.status == 200 &amp;&amp; pb.response.body.$.id != null
pb.response.status == 200 || pb.response.status == 201
!pb.response.body.$.error           | Negation</pre>
      </div>

      <div class="section">
        <div class="section-title">Assertion - Examples</div>
        <pre class="code-block">pb.response.status == 200 | OK
pb.response.body.$.items.length > 0 | Has items
pb.response.headers.Content-Type contains "json" | JSON response
pb.response.body.$.email endsWith "@example.com" | Valid domain
pb.response.time &lt; 1000 | Fast response
pb.response.body.$.name startsWith "J" | Name starts with J
pb.response.status == &#123;&#123;expectedStatus&#125;&#125; | Variable comparison</pre>
      </div>

      <div class="section">
        <div class="section-title">Pb directives in .http files</div>
        <p>In <code>.http</code> files, use comment-prefixed syntax with section markers:</p>
        <pre class="code-block">GET &#123;&#123;baseUrl&#125;&#125;/api/users/1
Authorization: Bearer &#123;&#123;token&#125;&#125;

# @pb.beforeSend
# @pb.set("request.header.X-Trace", &#123;&#123;$timestamp&#125;&#125;)

# @pb.afterReceive
# @pb.set("userId", pb.response.body.$.id)
# @pb.global("lastUser", pb.response.body.$.name)
# @pb.assert(pb.response.status == 200, "OK")</pre>
        <p><code>set</code> stores a variable scoped to the current file. <code>global</code> makes it available across all files in the workspace. Both are runtime-only and reset when you close the app. The GUI tabs and file directives are equivalent.</p>
      </div>

      <div class="section">
        <div class="section-title">Shortcuts</div>
        <div class="shortcut-row"><kbd>Ctrl+Enter</kbd> <span>Send request</span></div>
        <div class="shortcut-row"><kbd>Right-click</kbd> <span>Set response alias on a request</span></div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Modal base from shared.css; only overrides here */
  .modal {
    width: 480px;
  }
  .modal-header {
    position: sticky;
    top: 0;
    background: var(--color-bg-surface);
    z-index: 1;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }

  .section {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-bg-sidebar);
  }
  .section:last-child {
    border-bottom: none;
  }
  .section-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--color-primary);
    margin-bottom: var(--space-1\.5);
  }

  p {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin-bottom: var(--space-2);
  }
  p:last-child {
    margin-bottom: 0;
  }

  code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: var(--text-sm);
    background: var(--color-bg-sidebar);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    color: var(--color-warning);
  }

  .code-block {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: var(--text-sm);
    line-height: 1.5;
    background: var(--color-bg);
    border: 1px solid var(--color-bg-hover);
    border-radius: var(--radius-default);
    padding: var(--space-2) var(--space-3);
    color: var(--slate-250);
    margin: var(--space-1\.5) 0;
    white-space: pre;
    overflow-x: auto;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  kbd {
    display: inline-block;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    padding: 2px var(--space-2);
    background: var(--color-bg-sidebar);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--slate-250);
    min-width: 80px;
    text-align: center;
  }
</style>
