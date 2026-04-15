<script lang="ts">
  export let label: string;
  export let value: string;
  export let inserted: boolean = false;
  export let nested: boolean = false;
  export let maxValueLength: number = 30;

  $: truncated = value.length > maxValueLength ? value.slice(0, maxValueLength) + '...' : value;
</script>

<button class="picker-row" class:row-nested={nested} class:inserted on:click>
  <span class="row-key">{label}</span>
  <span class="row-value">{truncated}</span>
  <span class="row-action">{inserted ? 'Inserted' : 'Insert'}</span>
</button>

<style>
  .picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 7px var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast);
  }
  .picker-row:hover { background: var(--color-bg-subtle); }
  .picker-row.inserted { background: color-mix(in srgb, var(--color-success) 12%, transparent); }
  .picker-row.row-nested { padding-left: var(--space-6); }

  .row-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-warning);
    font-weight: var(--weight-semibold);
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-value {
    color: var(--color-text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
  .row-action {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-placeholder);
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0;
    transition: opacity var(--duration-fast);
  }
  .picker-row:hover .row-action { opacity: 1; }
  .picker-row.inserted .row-action {
    opacity: 1;
    color: var(--color-success);
  }
</style>
