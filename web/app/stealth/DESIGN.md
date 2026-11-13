---
name: BrowserArena Bot Detection — route design
description: Existing benchmark-shell treatment for the scores-only /stealth route.
colors:
  background: "oklch(0.9940 0 0)"
  foreground: "oklch(0 0 0)"
  muted: "oklch(0.9702 0 0)"
  muted-foreground: "oklch(0.4386 0 0)"
  border: "oklch(0.9722 0.0034 247.8581)"
  primary: "oklch(0.82 0.12 75)"
  ring: "oklch(0.82 0.12 75)"
typography:
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.625
  date:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "11px"
    lineHeight: "16px"
  table-label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.6rem"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.05em"
  provider:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 500
    lineHeight: "20px"
  counts:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  panel: "3px"
spacing:
  unit: "0.27rem"
components:
  scores-panel:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "0"
  history-select:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "0 10px"
    height: "calc(1.02rem + 0.27rem * 3 + 2px)"
---

# Design System: BrowserArena Bot Detection

## Overview

This document applies only to `/stealth` and its adjacent sidecar. It records the route's use of the existing BrowserArena benchmark shell; it establishes no visual authority for other routes or shared components. Shared implementation remains authoritative for inherited styles. The frontmatter records the captured light-theme values, rather than introducing new tokens into the application.

**Creative North Star: "The existing benchmark shell"**

Mode: Read. The route is a compact comparison surface for weekly aggregate access scores. Preserve the existing typography, navigation, ruled table, striped page background, warm header and wordmark. Keep the scores and their interpretation legible without introducing another visual identity, decorative assets or promotional claims.

**Key Characteristics:**

- Restrained, mostly neutral score presentation inside the incumbent branded shell.
- Explicit measurement date, weekly history and visible score denominators.
- Stable provider labels beside horizontally scrollable counts on narrow screens.
- Honest pending and unavailable-run states with interpretation text retained.

### Evidence and release boundary

Documentation snapshot: 2026-11-04. Source inspection covered the route, its CSS, aggregate loader/ranking logic and shared benchmark shell. Supplied captures cover the empty desktop state and synthetic populated desktop, mobile and horizontally scrolled mobile states. The requested viewport classes were desktop (1440 × 1000) and mobile (375 × 812); full-page captures can extend beyond those heights.

All populated captures used temporary synthetic fixtures, removed after capture. No captured percentage, provider ordering or date is a measured benchmark result. The local aggregate directory contains no score files. The production state reported for this handoff has no published scores and reads **“First verified run pending.”** Production was not independently inspected in this documentation pass.

The supplied fixture-QA record reports history selection, keyboard horizontal scrolling, empty dated-link handling, no mobile document overflow and absence of raw data. These are supplied local QA observations, not new tests run for this document. The closed review identified provider/access-rate overlap and empty-history recovery; its second verdict marked both resolved and gave a ship disposition only within those findings' scope. This is not broader release approval. No live weekly campaign or deployed-preview verification has occurred yet. Dark-theme values exist in shared styles but the supplied captures establish only the light presentation; broader accessibility and device coverage are not established here.

## Colors

### Primary

Warm amber belongs to the inherited brand shell and the scroll region's focus ring. The header mixes the shared primary with background; the footer wordmark uses primary directly. The route does not add score-dependent colors, medals or a highlighted winning row.

### Neutral

Near-white background supports the table and opaque sticky provider cells. Black foreground defines the title, table frame and active navigation. Muted foreground carries dates, column labels and explanatory text. Pale borders divide rows and the sticky provider column. The muted surface appears on the history button's hover state.

**The Aggregate Rule.** Color must not imply a benchmark result that has not been published. An empty publication state stays empty.

## Typography

The shell and route prose use Plus Jakarta Sans with a sans-serif fallback. Provider names use DM Sans; passed, blocked and error counts use IBM Plex Mono with tabular numerals. Access-rate values retain the inherited sans-serif table text, aligned right.

Use the frontmatter hierarchy for the title, measurement line, table labels, provider names and counts. Table labels are uppercase; the page title keeps normal title capitalization. The pending heading is medium-weight text (1.125rem). History labels and the submit button use compact body-sized text (0.875rem); the shared shell makes the native select smaller (0.68rem, weight 500, line height 16px).

Interpretation copy uses the body role and relaxed line spacing, constrained to the existing prose container. Keep the short run-date line subordinate to the title and distinguish actual measurement date from week-of date.

## Layout

The route uses the shared maximum-width main container (80rem), existing top navigation, benchmark sidebar and footer. Horizontal padding uses the shared spacing unit: four units on mobile and ten from the small-screen breakpoint. The striped background remains visible around content and behind unboxed explanatory copy.

At desktop widths from 1280px, benchmark navigation remains beside the content. Between 1280px and 1799px, the main container reserves 208px on the left and the sidebar is 184px wide. Below 1280px, navigation becomes the existing “Benchmark & setup” drawer. Below 640px, the shared benchmark header stacks without its desktop minimum height. These are inherited shell behaviors, not route-specific redesign decisions.

The content sequence is title and date, history controls when available, score table or pending/unavailable message, then “How to read these scores.” History controls wrap with a two-unit gap. The empty message has a constrained width (42rem); interpretation copy is constrained to 48rem with a six-unit top margin.

The score table is full-width with a minimum width of 640px and fixed layout. Provider occupies 180px; access rate occupies 120px. Rows and header are 40px high. Cell padding is 2px vertically and two spacing units horizontally. On narrow screens, scroll the table inside its panel rather than widening the document. The first provider column remains sticky at the left edge with an opaque background and a divider. Other columns may be clipped behind it while scrolling; provider labels must remain readable.

**The Stable Column Rule.** Keep provider names and the access-rate column in separate fixed-width tracks. Preserve the explicit route override rather than inheriting the shared table's different column assumptions.

## Elevation & Depth

The score panel is flat: its foreground frame and subtle row rules provide structure without a card shadow. The sticky provider column uses stacking order (z-index 1), an opaque surface and a right divider, not translucency. Row hover uses the inherited faint foreground tint and does not indicate an action.

The shared mobile drawer alone introduces an overlay and shadow. Its exact shadow, motion and responsive thresholds are recorded in the route-scoped sidecar. The dashboard inherits a brief entrance fade and row/control transitions; no new route animation is introduced. Shared reduced-motion rules remove these animations and transitions.

## Shapes

Use the inherited small, nearly square corners for the table panel, navigation choices and select. The table frame is a foreground border (1.5px); internal row and sticky-column dividers are finer (1px). Keep the table dense and rectangular. The pending state is ordinary text in the page flow, without an illustration, empty table or replacement card.

## Components

### Navigation and shell

Reuse the existing top navigation, sidebar, responsive drawer and footer wordmark. “Bot Detection” is the active benchmark with inverted foreground/background colors and `aria-current="page"`. This route has no setup controls. The shared drawer implements Escape dismissal, a focus loop and return focus to its menu trigger; those behaviors were read in source, not independently exercised in this pass.

### Run title and history

The title is “Bot Detection.” With a selected run, the date line reads `Run <date> · Week of <weekOf>`; otherwise it reads “Weekly scores.” Show history only when at least one aggregate exists. Use the associated “Run history” label, native select and explicit “View run” submit button. The GET form submits to `/stealth` with the `week` parameter; selection alone does not submit. Options show measurement dates, and runs are ordered newest week first.

Without a week parameter, show the latest available run. An unavailable week must display “This run is unavailable” and direct the reader to choose an available date; keep history visible and default its select to the latest option. With no aggregates at all, even a dated link shows the first-run pending state and hides history. Missing a new weekly publication leaves the last available run visible by default; it does not invent a fresh measurement.

Controls inherit visible keyboard outlines from the shared dashboard. Preserve the native select and form semantics rather than replacing them with a custom picker.

### Provider scores

Use a semantic table with a visually hidden caption describing sample size, rounds and measurement date. Column headers are Provider, Access rate, Passed, Blocked and Errors. Provider names are row headers. Access rate carries `aria-sort="descending"`; the header is not an interactive sort control. Rows are informational and use a default cursor, with no drill-down or evidence links.

Rank by unrounded access rate descending, breaking ties by provider identifier; null rates follow numeric rates. Display rates rounded to whole percentages. Access rate is passed divided by passed plus blocked. Errors are separate and excluded from that denominator. When passed plus blocked is zero, display `N/A`. Passed shows a count out of 90 planned visits; blocked and errors show counts. The supported aggregate represents 30 difficult websites and three rounds per provider. This fixed difficult sample does not represent general browsing reliability.

The scroll wrapper is a keyboard-focusable labelled region (`tabIndex=0`) with an inset focus outline (2px, using ring). Preserve column scopes, row scopes, the caption and the region's horizontal-scroll label.

### Pending and unavailable states

The initial state says “First verified run pending” and explains that no scores have been published. Retain methodology and interpretation beneath it. Do not insert illustrative rows, zeros, progress percentages or an estimated publication date. For an unavailable selected run, the visible recovery is the existing history form whenever aggregates exist.

### Interpretation and publication boundary

Keep the rate denominator, error treatment, planned visits, measurement date and difficult-sample limitation visible in “How to read these scores.” Describe weekly publication as the protocol's intended cadence, not evidence that a campaign has already run. The public surface contains aggregate scores only; execution source, target lists, individual outcomes, raw evidence and recordings stay private elsewhere. Do not add target names, evidence links, credentials or private operational metadata to this route or its documentation.

## Do's and Don'ts

### Do:

- **Do** preserve the existing benchmark shell and restrict this document's authority to `/stealth`.
- **Do** keep provider names readable while the score region scrolls horizontally.
- **Do** distinguish measurement date, week, access-rate denominator and planned-visit count.
- **Do** retain an honest pending state and a visible history-based recovery for unavailable weeks.
- **Do** identify populated captures as temporary synthetic-fixture QA and keep release verification limits explicit.

### Don't:

- **Don't** publish illustrative scores or treat fixture screenshots as measured results.
- **Don't** infer general browsing reliability from this fixed difficult sample.
- **Don't** imply the closed two-finding design review verifies a live campaign or deployment.
- **Don't** expose targets, individual outcomes, private execution details or raw evidence.
- **Don't** add a new visual identity, promotional claims, score charts or provider drill-downs to this scoped page.
