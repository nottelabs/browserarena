---
name: BrowserArena website access
description: Implemented website-access report and inherited shell only.
colors:
  primary: "oklch(0.82 0.12 75)"
  background: "oklch(0.9940 0 0)"
  foreground: "oklch(0 0 0)"
  secondary: "oklch(0.96 0.02 75)"
  muted: "oklch(0.9702 0 0)"
  muted-foreground: "oklch(0.4386 0 0)"
  border: "oklch(0.9722 0.0034 247.8581)"
  input: "oklch(0.9401 0 0)"
  accessible-bg: "#e1f0e7"
  accessible-text: "#205836"
  blocked-bg: "#f8e6e2"
  blocked-text: "#893b29"
  login-bg: "#e7ecf9"
  login-text: "#354f85"
  uncertain-bg: "#f8edcf"
  uncertain-text: "#73550d"
typography:
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  count:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "13px"
    fontWeight: 600
rounded:
  compact: "3px"
  field: "4px"
  download: "5px"
  table: "6px"
spacing:
  control-gap: "4px"
  cell-block: "8px"
  cell-inline: "12px"
  controls: "16px"
  evidence-grid: "24px"
  section: "44px"
components:
  download:
    textColor: "{colors.foreground}"
    rounded: "{rounded.download}"
    padding: "8px 12px"
  search:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  navigation-active:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.compact}"
  outcome-accessible:
    backgroundColor: "{colors.accessible-bg}"
    textColor: "{colors.accessible-text}"
    rounded: "{rounded.compact}"
    padding: "3px 7px"
---

# Design System: BrowserArena website access

## Overview

**Creative North Star: "Reviewable evidence"**

BrowserArena’s existing amber wordmark and header frame a compact, neutral evidence report. Preserve that identity: readable comparisons, restrained outcome colors, monospace counts and original screenshots carry the information.

This document covers the implemented `/website-access` surface and the shell it inherits, based on source and the supplied desktop/mobile captures. It is not an audit of the entire application. Light-theme captures are the visual evidence; dark-theme tokens exist in globals but were not visually reviewed here.

**Key Characteristics:**
- Compact comparison table with persistent website context.
- Original evidence, review reasons and replay provenance remain adjacent.
- Amber shell identity; quiet report surfaces.

Sources: `PRODUCT.md`, `.impeccable/website-access-brief.md`, `web/app/website-access/results.tsx` and `results.module.css`, `web/app/globals.css` and `layout.tsx`, plus the benchmark shell, sidebar, navbar and wordmark components. Supplied visual references: `.impeccable/review/desktop.png` and `mobile.png`.

The requested destination is BrowserArena, with the full runner included in the draft. That delivery intent does not establish hosting or runner readiness. Supplied final review disposition: **ship at this narrow UI scope**, with two fixes resolved: evidence keyboard focus and sticky mobile site names. Source confirms focus transfer into the evidence section and sticky first-column styling. This documentation pass inspected source and existing images only; it did not run a browser, build, tests or runner, verify a live deployment, or verify overall replay playback.

## Colors

Amber belongs to the inherited wordmark and tinted header. Near-white surfaces, black text and muted gray supporting text keep the report quiet. Pale amber marks the selected row. Outcome pairs use green for accessible, terracotta for bot block, blue for login wall and ochre for uncertain. Error outcomes have text labels and an E mark, without a dedicated color rule.

**The Label Rule.** Outcome color accompanies letters or explicit labels; it never carries the result alone.

The frontmatter records light-theme source values. Shared CSS variables retain their existing theme behavior; the report’s outcome colors are literal values.

## Typography

Plus Jakarta Sans supplies the report hierarchy; IBM Plex Mono distinguishes counts. DM Sans supplies the outlined shell wordmark. The title reduces to 28px below the report breakpoint; section headings use 20px, weight 650 and 1.4 line height. Supporting text ranges from 11–13px, with 10px provider summaries and 9px round marks. Paragraph measures are bounded, typically 70–75ch.

## Layout

The inherited shell provides a sticky header, diagonal background stripes, desktop benchmark sidebar and large footer wordmark. Below 1280px the sidebar becomes the “Benchmark & setup” drawer. The shared main container is capped at 80rem; laptop rules reserve sidebar space.

The report proceeds from title/download and sampling caveat to comparison, visit evidence and method. Its table stays at least 800px wide inside a keyboard-focusable horizontal scroll region. Website names stick to the left with opaque selected/hover backgrounds (180px column; 160px on mobile). Evidence uses two columns with a 24px gap. At 767px and below, headers stack, controls wrap and evidence/method grids become one column. Evidence and method sections allow 90px scroll clearance.

## Elevation & Depth

The report uses fine borders, tonal row states and dark section rules, without card shadows. The shell adds outlined, offset-shadow wordmarks; the mobile drawer uses a soft overlay shadow. Preserve these inherited distinctions. Dashboard entry and drawer motion already have reduced-motion overrides; the report introduces no decorative animation.

## Shapes

Small corners define controls, outcome labels and the table, as captured in the frontmatter. Evidence is an open article with a top rule, not a floating card. Global radius defaults do not describe these local report controls.

## Components

- **Comparison matrix:** accessible counts out of three, three lettered round markers, provider totals and visible legend. Search filters domains; an empty result announces its state and offers Clear search.
- **Evidence controls:** native website selector and three pressed-state round buttons. Matrix activation selects a site, focuses the evidence section (`tabIndex=-1`) and scrolls it into view. Interactive report controls and the table scroll region use a foreground focus outline (2px, 3px offset).
- **Evidence article:** provider, named outcome, linked original screenshot, reason and replay provenance. Images use a 1365:900 contain frame, preserving differing capture dimensions without cropping. Missing original screenshots receive explicit text.
- **Replay:** original scored recordings and separately recorded follow-ups have distinct labels. Unpublished media says “Replay archived; video hosting is not configured for this deployment.” Missing replays and playback errors have their own messages. A play control is conditional on configured hosting; its presence is not playback verification.
- **Shell navigation and download:** compact outlined controls; current navigation is dark with light text. Download stays adjacent to the title on desktop and moves beneath it on mobile.

**The Provenance Rule.** Keep original evidence, later recordings and availability separate in both labels and claims.

The current report inventory is 300 original reviewed visits and 300 original screenshots, with 180 original recordings and 120 follow-up recordings. `results/website-access/2026-10-28/run.json` carries screenshot SHA-256 provenance; screenshot bytes remain unaltered. Follow-ups are excluded from every score and cannot establish what happened during an earlier visit. The supplied captures show the honest unconfigured-video-hosting state. Inventory is not proof of media delivery or playback.

## Do's and Don'ts

- Do preserve the inherited BrowserArena shell and compact report hierarchy.
- Do keep site names visible during horizontal scrolling and move keyboard focus into selected evidence.
- Do label original recordings, follow-ups and missing media explicitly.
- Don't use follow-up recordings to change original scores.
- Don't replace unavailable media with a working-playback claim.
- Don't extend this surface’s ship disposition to the full app, runner or live deployment.
