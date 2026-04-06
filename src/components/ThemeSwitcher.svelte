<script lang="ts">
  import { THEMES, type ThemeId } from '../lib/theme';

  interface Props {
    current: ThemeId;
    onChange: (theme: ThemeId) => void;
  }

  let { current, onChange }: Props = $props();
</script>

<select
  class="theme-select"
  value={current}
  onchange={(e) => onChange(e.currentTarget.value as ThemeId)}
  style="-webkit-app-region: no-drag"
>
  {#each THEMES as theme}
    <option value={theme.id}>{theme.label}</option>
  {/each}
</select>

<style>
  .theme-select {
    -webkit-app-region: no-drag;
    height: 20px;
    padding: 0 var(--space-1);
    margin-right: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg-surface);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-2xs);
    cursor: pointer;
    outline: none;
  }
  .theme-select:hover {
    border-color: var(--color-text-faint);
  }
  .theme-select:focus {
    border-color: var(--color-border-focus);
  }
</style>
