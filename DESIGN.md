# Design System

## Color Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| Background | `#0d0f11` | Page background, card backgrounds |
| Surface | `#1a1d21` | Hover states, input backgrounds, elevated surfaces |
| Border | `#1e2126` | Card borders, dividers, separators |
| Green | `#3dd9a4` | Long positions, profit, positive PnL, connection status |
| Red | `#f6465d` | Short positions, loss, negative PnL, liquidation, close actions |
| Cyan | `#00d4ff` | Primary accent, selected tabs, active states, links |
| White | `#ffffff` | Primary text, headings, asset names |
| Gray 400 | `text-gray-400` | Secondary text, labels, inactive icons |
| Gray 500 | `text-gray-500` | Tertiary text, column headers, metadata |
| Gray 600 | `text-gray-600` | Disabled text, divider text |

## Typography

- **UI text:** System font stack (default Tailwind sans)
- **Numbers:** Monospace (`font-mono`) for all prices, sizes, PnL, percentages
- **Data-dense components:** 9-11px (`text-[9px]` to `text-[11px]`)
- **Headers/labels:** 12-14px (`text-xs` to `text-sm`)
- **Primary values:** 16-20px (`text-base` to `text-xl`) for current price, account balance
- **Tabular numbers:** Use `tabular-nums` for animated/streaming values to prevent layout shift

## Spacing

- **Card padding:** `px-3 py-2` (compact) or `px-4 py-3` (standard)
- **Gap between cards:** `gap-2` (8px)
- **Page padding:** `p-2` (desktop), `px-3 py-2.5` (mobile header)
- **Inner grid gaps:** `gap-2` for data grids, `gap-3` for nav items

## Component Patterns

### Cards
- Dark background (`bg-[#0d0f11]`), thin border (`border border-[#1e2126]`), rounded (`rounded-lg`)
- No shadows. Borders create hierarchy.

### Expandable Rows
- Click to expand/collapse with chevron rotation
- Expanded content uses nested grids for data display
- `border-b border-[#1e2126]/50` between rows (50% opacity for subtlety)

### Animated Numbers
- `<AnimatedNumber>` component for live PnL, prices
- 200ms transition duration
- Green/red color based on positive/negative value

### Buttons
- **Primary action:** Solid background with accent color
- **Destructive:** Text-only in red (`text-[#f6465d]`), no background
- **Disabled:** `cursor-not-allowed`, reduced opacity or gray text
- **Touch targets:** `touch-manipulation` class on all interactive elements

### Status Indicators
- Connection: 2px dot (`w-2 h-2 rounded-full`), green=connected, red=disconnected
- Signal activity: Pulsing green dot (`animate-pulse`)

### Tabs
- Active: white text + cyan bottom border (`border-b-2 border-[#00d4ff]`)
- Inactive: gray text, no border

### Badges
- Small inline tags: `text-[9px] px-1 py-0.5 rounded font-medium`
- Color-coded: green bg for long, red bg for short, with 10% opacity backgrounds
- Source badge: `SIG` tag in cyan (`text-[#00d4ff] bg-[#00d4ff]/10`) for signal-sourced positions

## Layout

### Desktop (md+)
- Three-column: left sidebar (orderbook + trades, 256px), center (chart + positions, flex), right sidebar (account + signals + order form, 320px)
- `gap-2` between columns
- Full height, no scroll on page level

### Mobile
- Two-tab navigation: Markets (chart or orderbook) | Trade (orderbook + order form split)
- Bottom nav bar with `pb-12` for safe area
- `100dvh` for full viewport height

## Interaction States

- **Hover:** `hover:bg-[#1a1d21]` on interactive rows
- **Active/pressed:** `active:bg-[#1a1d21]` on mobile touch targets
- **Loading:** `animate-pulse` on skeleton text, `opacity-50` on loading elements
- **Error:** Toast notifications via ToastContext (top-right, auto-dismiss)
- **Empty:** Centered gray text with optional action link (e.g., "Login to trade")
