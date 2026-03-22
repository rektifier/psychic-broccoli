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
        <p>Add a <code>.user</code> file for personal overrides (gitignored).</p>
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
        <div class="section-title">Dynamic variables</div>
        <pre class="code-block">&#123;&#123;$randomInt 1 100&#125;&#125;      Random integer
&#123;&#123;$timestamp&#125;&#125;            Unix epoch (UTC)
&#123;&#123;$datetime iso8601&#125;&#125;     UTC datetime
&#123;&#123;$localDatetime iso8601&#125;&#125; Local datetime</pre>
      </div>

      <div class="section">
        <div class="section-title">Assertions</div>
        <p>Add assertions in the <strong>Assertions</strong> tab. One assertion per line, with expression and label separated by <code> | </code>.</p>
        <pre class="code-block">expression | Label text
expression without a label</pre>
      </div>

      <div class="section">
        <div class="section-title">Assertion - Data access</div>
        <pre class="code-block">pb.response.status             HTTP status code
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
&#123;&#123;variableName&#125;&#125;               Environment/file variable</pre>
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
        <div class="section-title">Assertion - Set &amp; Global directives</div>
        <p>In <code>.http</code> files, you can also store values for use in later requests:</p>
        <pre class="code-block"># @pb.set("token", pb.response.body.$.token)
# @pb.global("sessionId", pb.response.body.$.id)
# @pb.assert(pb.response.status == 200, "OK")</pre>
        <p><code>set</code> stores a file-level variable. <code>global</code> persists across files.</p>
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
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 100;
    background: rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    background: #FFFFFF;
    border: 1px solid #D4D4D8;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.12);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #DCDCE2;
    position: sticky;
    top: 0;
    background: #FFFFFF;
    z-index: 1;
    border-radius: 10px 10px 0 0;
  }
  .modal-title {
    font-size: 13px;
    font-weight: 600;
    color: #1A1A2E;
  }
  .btn-close {
    width: 24px; height: 24px;
    border: none; border-radius: 4px;
    background: transparent; color: #999;
    font-size: 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-close:hover { background: #E4E4EA; color: #444; }

  .section {
    padding: 12px 16px;
    border-bottom: 1px solid #F0F0F4;
  }
  .section:last-child {
    border-bottom: none;
  }
  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #D4900A;
    margin-bottom: 6px;
  }

  p {
    font-size: 12px;
    color: #555;
    line-height: 1.5;
    margin-bottom: 8px;
  }
  p:last-child {
    margin-bottom: 0;
  }

  code {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px;
    background: #F0F0F4;
    padding: 1px 5px;
    border-radius: 3px;
    color: #9A7520;
  }

  .code-block {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.5;
    background: #F8F8FA;
    border: 1px solid #E8E8EC;
    border-radius: 6px;
    padding: 8px 12px;
    color: #444;
    margin: 6px 0;
    white-space: pre;
    overflow-x: auto;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    font-size: 12px;
    color: #555;
  }

  kbd {
    display: inline-block;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    background: #F0F0F4;
    border: 1px solid #D4D4D8;
    border-radius: 4px;
    color: #444;
    min-width: 80px;
    text-align: center;
  }
</style>
