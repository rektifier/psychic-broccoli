# DESIGN.md - Psychic Broccoli Design System

This document defines the visual design system for Psychic Broccoli, a desktop HTTP client built with Tauri + Svelte. All design tokens live in `src/styles/tokens.css`. To re-theme the app, modify only the semantic token mappings in that file.

---

## 1. Visual Theme and Atmosphere

Psychic Broccoli is a **monospace-first developer tool** with a warm, focused aesthetic. The interface prioritizes density and scannability - every pixel earns its place.

- **Font**: The entire UI uses a monospace stack (`SF Mono`, `Cascadia Code`, `JetBrains Mono`, `Fira Code`). This reinforces the "code tool" identity and keeps HTTP payloads, headers, and URLs visually aligned.
- **Color temperature**: Cool neutral grays (`#F8F8FA`, `#F0F0F4`, `#DCDCE2`) form the backdrop. A single warm accent - amber `#D4900A` - provides all primary interaction cues (buttons, focus rings, active indicators, divider hovers).
- **Density**: Base font size is 12-13px. Spacing follows a 4px grid. The UI is intentionally compact to maximize visible request/response data.
- **Depth**: Flat by default. Borders (1px `#DCDCE2`) separate regions. Shadows appear only on elevated surfaces (toasts, dropdowns, modals) - never decorative.
- **Motion**: Transitions are quick (0.15s standard) and functional. No decorative animations except the loading pulse indicator.

---

## 2. Color Palette and Roles

### Primary

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#D4900A` | Buttons, active indicators, focus rings |
| `--color-primary-hover` | `#E09E18` | Button hover state |
| `--color-primary-active` | `#C07D08` | Button active/pressed state |
| `--color-primary-fg` | `#FFFFFF` | Text on primary backgrounds |
| `--color-primary-subtle` | `rgba(212,144,10,0.06)` | Subtle hover backgrounds |

### Neutral Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#F8F8FA` | App background |
| `--color-bg-sidebar` | `#F0F0F4` | Sidebar, titlebar, tab bar |
| `--color-bg-surface` | `#FFFFFF` | Content areas, modals, inputs |
| `--color-bg-muted` | `#E4E4EA` | Hover states, close button bg |
| `--color-bg-subtle` | `#F5F5FA` | Subtle row highlights |
| `--color-bg-hover` | `#E8E8EC` | List item hover |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `--color-text` | `#333340` | Primary body text |
| `--color-text-heading` | `#1A1A2E` | Headings, active labels |
| `--color-text-secondary` | `#555` | Slightly de-emphasized text |
| `--color-text-muted` | `#777` | Secondary labels |
| `--color-text-faint` | `#999` | Icons, placeholders, hints |
| `--color-text-placeholder` | `#BBB` | Input placeholders |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--color-border` | `#D4D4D8` | Interactive element borders (inputs, buttons) |
| `--color-border-focus` | `var(--color-primary)` | Focus ring color |
| `--color-divider` | `#DCDCE2` | Structural dividers, section borders |

### Semantic / Status

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#3D8B45` | 2xx status, passed assertions, POST method |
| `--color-error` | `#CC4455` | Failed assertions, errors, DELETE method |
| `--color-warning` | `#9A7520` | 4xx status, PUT method |
| `--color-info` | `#2B7FC5` | GET method, informational badges |
| `--color-accent-flow` | `#8040A8` | Flow editor accent, HEAD method |

### HTTP Method Colors

| Token | Value | Method |
|-------|-------|--------|
| `--color-method-get` | `#2B7FC5` | GET |
| `--color-method-post` | `#3D8B45` | POST |
| `--color-method-put` | `#9A7520` | PUT |
| `--color-method-patch` | `#A06828` | PATCH |
| `--color-method-delete` | `#CC4455` | DELETE |
| `--color-method-head` | `#8040A8` | HEAD |
| `--color-method-options` | `#1A8898` | OPTIONS |
| `--color-method-trace` | `#666677` | TRACE |
| `--color-method-connect` | `#CC4455` | CONNECT |

### Toast Colors

| Type | Background | Border | Text |
|------|-----------|--------|------|
| Error | `#FEF2F2` | `#FECACA` | `#991B1B` |
| Warning | `#FFFBEB` | `#FDE68A` | `#92400E` |
| Info | `#EFF6FF` | `#BFDBFE` | `#1E40AF` |

---

## 3. Typography Rules

### Font Stack

```css
font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale

| Token | Size | Role |
|-------|------|------|
| `--text-2xs` | 9px | Badge counts, group counts, status indicators |
| `--text-xs` | 10px | Small labels, inline counts |
| `--text-sm` | 11px | Code blocks, help text, shortcuts, tree labels |
| `--text-base` | 12px | Primary UI text, buttons, tab labels, table cells |
| `--text-md` | 13px | Modal titles, URL input, body editor, base body text |
| `--text-lg` | 14px | Status badges, empty state text |
| `--text-xl` | 16px | Request name input, close button icon size |
| `--text-2xl` | 20px | Loading indicator |

### Weight Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--weight-regular` | 400 | Body text, descriptions |
| `--weight-medium` | 500 | Section toggles, interactive labels |
| `--weight-semibold` | 600 | Buttons, headings, active tabs, badges |
| `--weight-bold` | 700 | HTTP method labels, send button, status codes |

### Line Height

| Token | Value | Usage |
|-------|-------|-------|
| `--leading-tight` | 1.2 | Compact labels, badges |
| `--leading-normal` | 1.4 | Standard UI text |
| `--leading-relaxed` | 1.6 | Body editor, response output |

---

## 4. Component Stylings

### Buttons

**Primary** (Send, Confirm, Import):
- Background: `--color-primary`, hover: `--color-primary-hover`
- Text: `--color-primary-fg`, weight: `--weight-bold`
- Padding: `--space-2.5` vertical, `--space-5` horizontal
- Radius: `--radius-default` (6px)
- Letter spacing: 0.3px

**Secondary** (Cancel, Done, Close):
- Background: transparent, border: 1px `--color-border`
- Text: `--color-text-muted`, hover: `--color-text`
- Padding: `--space-1.5` vertical, `--space-3.5` horizontal
- Radius: `--radius-default`

**Ghost** (Subtle actions):
- Background: transparent, no border
- Text: `--color-text-faint`, hover: `--color-primary`
- No padding (inherits from context)

**Icon** (Small toolbar actions):
- Size: 24x24px, border: 1px `--color-border`
- Radius: `--radius-sm` (4px)
- Color: `--color-text-faint`, hover: `--color-primary`

**Disabled state** (all variants): opacity 0.5, cursor default, pointer-events none

### Modals

- Overlay: fixed, `--overlay-bg`, z-index `--z-modal`
- Container: `--color-bg-surface`, border `--color-border`, radius `--radius-xl` (10px), shadow `--shadow-modal`
- Header: padding `--space-3` / `--space-4`, bottom border `--color-divider`
- Title: `--text-md`, `--weight-semibold`, `--color-text-heading`
- Close button: 24x24, `--radius-sm`, color `--color-text-faint`
- Max height: 80vh with overflow-y auto

### Inputs

- Background: `--color-bg-input`
- Border: 1px `--color-border`, focus: `--color-border-focus`
- Radius: `--radius-default` (6px)
- Padding: `--space-2` vertical, `--space-2.5` horizontal
- Font size: `--text-base` (12px)
- Placeholder color: `--color-text-placeholder`

### Tabs

- Bar background: `--color-bg-sidebar`
- Tab text: `--color-text-faint`, active: `--color-text-heading`
- Active indicator: 2px bottom border `--color-primary`
- Flow tab indicator: 2px bottom border `--color-accent-flow`
- Font size: `--text-sm`, active weight: `--weight-semibold`
- Max tab width: 180px

### Toasts

- Position: fixed, bottom-right, z-index `--z-toast`
- Radius: `--radius-default`, shadow: `--shadow-toast`
- Font size: `--text-base`, line-height: `--leading-normal`
- Animation: slide-in from right, 0.2s ease-out

### Status Badges

- Font size: `--text-lg` (14px), weight: `--weight-bold`
- Padding: `--space-1` / `--space-3`
- Radius: `--radius-default`
- Letter spacing: 0.3px
- Background: status color at ~9% opacity

### Dependency Pills

- Font size: `--text-sm`, weight: `--weight-medium`
- Padding: `--space-1` / `--space-2`
- Radius: `--radius-full` (pill shape)
- Background: method color at ~9% opacity

---

## 5. Layout Principles

### Spacing Scale

Base unit: 4px. All spacing values are multiples or common fractions of this base.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight gaps, badge padding |
| `--space-1.5` | 6px | Button padding, small gaps |
| `--space-2` | 8px | Standard gap between items |
| `--space-2.5` | 10px | Medium container padding |
| `--space-3` | 12px | Section padding, header padding |
| `--space-3.5` | 14px | Modal body, text area padding |
| `--space-4` | 16px | Standard container padding |
| `--space-5` | 20px | Large spacing |
| `--space-6` | 24px | Section margins |
| `--space-7` | 28px | Drop zone padding |
| `--space-10` | 40px | Empty state spacing |

### Grid and Layout

- **Three-pane layout**: Sidebar (260px default) + Editor + Response viewer
- All panes are resizable via draggable dividers (3px wide)
- Sidebar min-width: 160px, max-width: 500px
- Editor/Response split: 50/50 default, adjustable
- Titlebar height: 28px (Tauri drag region)
- Tab bar height: 32px

### Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-xs` | 3px | Micro badges |
| `--radius-sm` | 4px | Icon buttons, close buttons |
| `--radius-md` | 5px | Filter inputs, display mode buttons |
| `--radius-default` | 6px | Standard buttons, inputs, badges |
| `--radius-lg` | 8px | Text areas, body output containers |
| `--radius-xl` | 10px | Modals, root-level buttons |
| `--radius-full` | 9999px | Pills, dependency bar items |

---

## 6. Depth and Elevation

| Level | Name | Treatment | Usage |
|-------|------|-----------|-------|
| 0 | Flat | No shadow, no border | Backgrounds, panes |
| 1 | Whisper | 1px border `--color-divider` | Section separators, table rows |
| 2 | Raised | `--shadow-toast` | Toasts, autocomplete dropdowns |
| 3 | Elevated | `--shadow-dropdown` | Context menus, suggestion lists |
| 4 | Modal | `--shadow-modal` | Dialogs, variable pickers, inspectors |

Depth is achieved primarily through borders and background contrast, not shadows. Shadows are reserved for floating elements that overlay the main content.

---

## 7. Responsive Behavior

This is a **desktop-only Tauri application**. No mobile breakpoints are needed.

### Constraints

- Minimum window size is enforced by Tauri configuration
- Sidebar collapses gracefully when dragged to minimum width (160px)
- Editor and response panes have `min-width: 0` to allow flex overflow
- Modals use `max-width: 90vw` and `max-height: 80vh` for small window safety
- All scrollable regions use `overflow-y: auto`

### Divider Behavior

- Sidebar divider: horizontal resize, 3px hit target, visual feedback on hover (amber)
- Editor/Response divider: same behavior, vertical split
- Cursor changes to `col-resize` during drag
- User selection disabled during resize operations

---

## 8. Accessibility and States

### Interactive States

| State | Treatment |
|-------|-----------|
| Default | Base token colors |
| Hover | Background shift (`--color-bg-muted` or `--color-bg-hover`), border/text color change |
| Active | Scale or color intensification (e.g., `--color-primary-active`) |
| Focus | Border color `--color-border-focus` (amber) |
| Disabled | Opacity 0.5, pointer-events none |

### Keyboard Support

- All interactive elements are focusable via Tab
- Modals trap focus and close on Escape
- Tree navigation supports Arrow keys
- Autocomplete supports Arrow Up/Down and Enter
- Custom `tabindex` on non-native interactive elements

### Contrast

| Pair | Ratio | Level |
|------|-------|-------|
| `--color-text` (#333340) on `--color-bg` (#F8F8FA) | ~11:1 | AAA |
| `--color-text-muted` (#777) on `--color-bg` (#F8F8FA) | ~4.9:1 | AA |
| `--color-primary-fg` (#FFF) on `--color-primary` (#D4900A) | ~3.5:1 | AA Large |
| `--color-text-faint` (#999) on `--color-bg-surface` (#FFF) | ~3.0:1 | Decorative only |

### Color Independence

HTTP method colors are always paired with text labels (GET, POST, etc.), never color-alone. Status badges include numeric codes alongside color. Assertion results use pass/fail text with color reinforcement.

---

## 9. Agent Prompt Guide

### Quick Token Reference

When building or modifying components, always use these semantic tokens:

```
Background:     var(--color-bg-surface)
Text:           var(--color-text)
Border:         var(--color-border)
Divider:        var(--color-divider)
Primary button: var(--color-primary) / var(--color-primary-fg)
Focus ring:     var(--color-border-focus)
Muted text:     var(--color-text-muted)
Hover bg:       var(--color-bg-muted)
Spacing:        var(--space-N) where N is 1-10
Radius:         var(--radius-default) for most elements
Transition:     var(--duration-normal)
```

### Component Building Checklist

When creating a new component:

1. Use only semantic tokens from `tokens.css` - never hardcode hex/px values
2. For HTTP method colors, import `METHOD_COLORS` from `src/lib/theme.ts`
3. For modal layouts, use shared classes from `shared.css` (`.overlay`, `.modal`, `.modal-header`, etc.)
4. For button variants, use shared `.btn` classes or replicate the token pattern
5. All interactive elements need hover and focus states
6. All text should use the monospace font stack (inherited from body)
7. Spacing should use `--space-*` tokens on the 4px grid

### Iteration Rules

1. **Amber is the only saturated accent** - use `--color-primary` sparingly for interactive cues only
2. **Borders are whisper-weight** - always 1px, always `--color-divider` or `--color-border`
3. **Shadows only on floating elements** - never on inline/static content
4. **Four weights**: regular (read), medium (interact), semibold (emphasize), bold (announce)
5. **Compact density** - prefer `--space-1` through `--space-3` for internal padding; larger values for section gaps
6. **Cool gray backbone** - backgrounds are always from the neutral gray scale
7. **Status colors map directly** - green=success, red=error, amber=warning, blue=info, purple=flow
8. **Monospace always** - never introduce a proportional font
