# Calm Market Intelligence

This is the canonical design-language contract for Base Terminal. It applies to product UI, visual tests, and future tracked changes.

## Principles

1. Market truth comes before decoration.
2. Density is calmed through layered clarity, not miniature text.
3. Every color and state has one meaning.
4. Controls and overlays share one behavior contract.
5. Every viewport and language preserves the same decision order.

The terminal remains a live, information-rich workspace. Its persistent decision order is compact Live Tape → six-lane Live Market Wall → Market Board. Pair selection, Inspector, Pair Workspace, account, wallet and deliberate trade lifecycle remain available through progressive disclosure rather than competing as equal dashboard layers.

## Token layers

Tokens have three strict layers:

1. **Primitive** raw values live only in `src/app/design-tokens.css`.
2. **Semantic** tokens express product meaning: surfaces, content, market direction, freshness, trust, operation, network and focus.
3. **Component** tokens express purpose-named geometry, elevation, motion and control sizing.

Component TSX and component CSS may use semantic or component tokens only. They may not access `--primitive-*` variables.

### Spacing

Layout padding, margin and gap use only 4, 8, 12, 16, 24 and 32 px. Borders, icon geometry, control height, responsive container geometry, chart dimensions and overlay width are not spacing; they require purpose-named component tokens.

### Radius

- none/seam: 0
- control: 4px
- card: 8px
- panel: 12px
- overlay: 16px
- pill: status, avatar and true segmented/pill controls only

### Type

- metadata: 11/14
- label: 12/16
- table data: 13/18 with tabular numbers
- body: 14/20
- section title: 16/20
- page title: 20/24
- display value: 24/30

Essential UI never falls below 11px. Uppercase is limited to short eyebrows, status markers and table labels. Mono is limited to numbers, timestamps, addresses and reason codes.

## Semantic state axes

Four axes never substitute for one another:

1. **Market direction:** positive, negative, unchanged or unknown.
2. **Freshness:** live, fresh, delayed, stale, static or unknown.
3. **Identity/trust:** verified, unverified, conflicting, risk or unknown.
4. **Operation/tradeability:** idle, working, ready, pending, success, failed, cancelled or expired.

`unknown` is not safe, zero, verified, tradeable or unavailable. `verified` is not a safety guarantee. `quote ready` is an operation state, not market direction or transaction success.

Discovery actions follow the same truth ladder: a market-data row may offer **Inspect**; an exact Base token may offer **Check quote** even when no execution candidate was precomputed; **Buy/Sell** language belongs inside the explicit trade lifecycle and does not imply that a route exists. A failed live route check returns its exact no-route/provider/metadata state instead of hiding the entry point.

## Color contract

- Neutral canvas and panel hierarchy is the foundation.
- Mint is Mergen accent, primary action and `data-live` only.
- Calm green is positive market direction and operation success.
- Cyan is verified source/trust or neutral information.
- Base blue is network and focus.
- Amber is caution, delayed/stale freshness and expiry.
- Rose is negative market direction, documented danger or failed operation.
- Muted violet is volume category only.
- Unknown, unavailable and unverified remain neutral.

Color is always supported by label, icon, placement or accessible text. Neon glow, decorative gradient and permanently glowing borders are prohibited.

## Shared component contracts

Button sizes are 32px, 40px and at least 44px for touch. Icon buttons use the same family. Every interactive shared component defines default, hover, focus-visible, pressed/active, disabled and loading behavior. Loading preserves control width. Disabled controls remain readable and never appear clickable.

Inputs and selects keep native semantics while using the shared visual shell. Focus-visible uses the Base blue semantic focus token; pointer clicks do not manufacture focus styling.

State surfaces use one anatomy when applicable:

1. What happened?
2. Why, or what boundary applies?
3. What can the user do?

Compact variants serve rows and lanes. Full variants serve sections, pages and overlays. Supported families are loading, empty, delayed, stale, unavailable, error, partial and offline/recovering. The product must not claim offline unless browser/network evidence exists.

## Responsive decisions

- Header is 56px; desktop rail is 80px.
- At 1536px and above, six Live Wall lanes share one row.
- At 1024–1535px, three lanes are visible before natural continuation.
- At 768–1023px, two lanes are visible.
- Mobile shows one active lane and a six-option, wrapping lane switcher without horizontal scrolling.
- Compact Market Board rows are 40px/13px; comfortable rows are 48px/13px.
- Mobile opportunities use one identity row, a 2×2 evidence grid, signal summary, one primary action and secondary actions through inspect/overflow.
- Inspector is a fixed 400px desktop drawer and a bottom sheet capped at 92dvh on mobile.
- Inspector opens with token identity, price/freshness, movement, liquidity/volume, trade status, wallet status and primary signals. Raw reason codes, pool addresses, provider internals, pricing paths and timestamps live under **Technical details** or Pools.
- Wallet chrome distinguishes Connect, Reconnect, Locked, Wrong network and session-verified Connected. A connected summary identifies the provider, Base network and native balance; full public-address and selected-token balance truth lives in the Wallet drawer.
- Primary market naming is token-first. Raw `/ WETH` and `/ USDC` pairs are secondary pool evidence, represented on main surfaces by `via WETH`, `via USDC`, `direct USDC` or `unpriced`.
- Mobile navigation is Terminal / Markets / Watchlist / Wallet. Alerts remain a header action.

## Overlay contract

- popover: anchored, maximum 360px
- drawer: 400px desktop
- sheet: maximum 92dvh
- modal: 480–560px for truly modal decisions

All overlays share header anatomy, close placement, surface, scrim, footer order, focus trap, focus return, Escape and outside-click rules. Only one primary overlay is active: Market Inspector, Market Board sheet, Pool Drawer, Trade Drawer, Mergen Profile or Wallet Picker. Opening any primary overlay replaces the previous primary overlay. Only contextual secondary decisions—Board filters/columns and transaction review—may suspend and restore their owning primary overlay through `OverlayManager`; their DOM is portalled outside the suspended surface.

## Canonical account contract

Mergen Account Service/Profile Contract is the sole account truth. `mergen.finance` presents it and Base Terminal consumes its versioned projection. Wallet state is a separate transaction capability and can never create, name or authenticate a Mergen profile. Base Terminal stores no session token or profile in Web Storage and shows no fallback identity when the canonical contract is unavailable.

The profile surface uses the canonical Mergen initials fallback, effective display name, email, member-since timestamp, last-sign-in timestamp and Free/Mergen Pro membership only. Username/handle, image avatar, locale, role and linked-wallet UI stay absent until those fields exist in the canonical contract.

Semantic layers are: base, sticky, shell, popover, drawer, modal, toast and accessibility. Raw z-index is prohibited.

## Motion

- instant: 80ms
- fast: 140ms
- standard: 220ms
- overlay: 280ms
- deliberate: 360ms
- verified market update tint: at most 900ms

Motion originates physically: popovers from triggers, drawers from their edge, sheets from the bottom and market tint at the changed cell. Hover scale, bounce, glow and shadow bursts are prohibited. Reduced motion collapses animation to an immediate state.

## Copy glossary

| EN | TR |
|---|---|
| market | piyasa |
| pair | piyasa çifti |
| pool | havuz |
| route | işlem rotası |
| quote | teklif |
| fresh quote | taze teklif |
| approval | token izni (approval) |
| executable | işleme hazır |
| read-only | salt okunur |
| delayed | gecikmeli |
| stale | güncelliğini yitirmiş |
| unavailable | kullanılamıyor |

Actions begin with verbs. Empty/loading/error copy follows what happened → why → next action. TR and EN must preserve the same claim strength and dictionary key parity.

## Approved alternatives

- Compact Market Board: 40px/13px; comfortable: 48px/13px.
- Inspector desktop width: fixed 400px.
- Live change feedback: short tint on the changed cell only.
- Mobile navigation: Terminal / Markets / Watchlist / Wallet; Alerts in header.
- Muted violet is permitted only for volume semantics.
- Mint is never decorative.

## On-chain evidence disclosure

Observed on-chain state does not add another dashboard layer. The main Wall and Board keep their existing density and hierarchy. Protocol adapter, exact source block/time, raw reserve/balance evidence, reason codes, and provider/on-chain reconciliation live behind native disclosure controls in Inspector → Pools and the Pool Drawer. Conflict and unavailable copy uses semantic trust/freshness colors already in the system; it does not introduce a new accent. Finding an on-chain price never enables Buy/Sell by itself.

Provider-reported token images are decorative only. They may render beside an exact Base contract through the same-origin, allowlisted image proxy, but never change identity status; unverified brand-like names always retain the generic avatar.

## Static guard

`npm run design:guard` scans product source and fails on:

- raw numeric hex/rgb/hsl outside token definitions;
- raw product z-index;
- arbitrary or off-scale spacing;
- non-semantic radius and shadow/glow utilities;
- component access to primitive tokens;
- legacy color tokens.

Generated output, third-party code and test fixtures are outside the scan. Runtime-computed chart geometry and anchored popover coordinates are the only current dynamic-style exceptions; they express data/viewport geometry, not design values. New ad-hoc values must fail the guard until represented by a documented semantic/component token.
