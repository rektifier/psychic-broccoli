<script lang="ts">
  export let label: string;
  export let text: string;

  const id = `helptip-${Math.random().toString(36).slice(2, 8)}`;
  const anchorName = `--ht-${id}`;
</script>

<span class="helptip">
  <button
    class="helptip-trigger"
    popovertarget={id}
    aria-label="Help: {label}"
    style="anchor-name: {anchorName}"
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <circle cx="8" cy="5.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  </button>

  <div
    {id}
    popover="auto"
    class="helptip-content"
    role="status"
    aria-live="polite"
    style="position-anchor: {anchorName}"
  >
    {text}
  </div>
</span>

<style>
  .helptip {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  .helptip-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    margin-left: var(--space-1);
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color var(--duration-normal);
  }

  .helptip-trigger:hover {
    color: var(--color-text-secondary);
  }

  .helptip-trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .helptip-trigger svg {
    width: 14px;
    height: 14px;
  }

  .helptip-content {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-default);
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-dropdown);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed);
    max-width: 280px;
    inset: unset;
    top: anchor(bottom);
    left: anchor(center);
    translate: -50% var(--space-1);
  }
</style>
