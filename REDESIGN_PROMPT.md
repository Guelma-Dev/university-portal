# Master Prompt — "DailyFlutterUI" design language & motion system

Use this prompt verbatim with any AI agent (or as an implementation spec) to
rebuild the app's look & feel to match the reference video. It is written for
THIS repo's stack: Capacitor 6 WebView app — semantic HTML + vanilla CSS +
vanilla JS. No animation libraries (CSS keyframes + Web Animations API only),
per AGENTS.md.

---

## ROLE & GOAL

You are re-skinning an existing working app (university portal, SPA sections in
one shell) with the "DailyFlutterUI" design language: dark editorial theme,
high-contrast serif italics, white bottom-sheet forms, blueprint splash
animation, electric-lightning background, and a physically-consistent motion
system. Preserve all existing functionality (forms post to the same handlers,
sections keep their IDs and logic) — this is a presentation-layer rebuild.

Reference flow demonstrated: Splash → Auth (with validation + loading demo) →
Onboarding → Home (carousel). Adopt the same order: splash once per launch,
onboarding only on first run (localStorage flag), auth as the gate, home as the hub.

EXISTING BASE: the app already carries the "Nova" dark layer (css/nova.css,
navy glass tokens, native + blueprint splash, swallow transition, ripple
buttons — see PROGRESS.md 1.4.43–1.4.46). Keep that base and its
remove-the-layer-to-revert philosophy; build the screens below ON TOP of it
(do not fork a second theme). Where tokens differ, reconcile to this prompt's
values inside nova.css rather than adding new files.

## DESIGN TOKENS (put in :root as CSS variables)

- `--bg: #0B0E14` (near-black, slight blue tint) — app background everywhere.
- `--surface: #11151D`; `--card: #FFFFFF`.
- `--text: #F5F7FA`; `--text-dim: #8A93A6`.
- `--accent: #2F7CF6` (iOS-ish blue) — CTAs, links, active states.
- `--pill-active: #0B0E14` (black pill with white text for segmented/chips).
- `--danger: #E5484D`; field fill on white: `#F2F4F7`.
- Type: display = high-contrast serif, italic for emphasis (self-hosted
  "Playfair Display" or "Fraunces" woff2) for H1 ("Welcome back.",
  "Beautiful UI. Ready to build.", "Featured kits") and card titles.
  UI text = system sans (-apple-system, Inter). Wordmark = bold sans
  "DailyFlutter" + serif italic blue "UI" (swap in the portal's own name).
- Radii: cards 24, bottom sheet 28 (top corners only), fields 14, pills 999.
- Shadows: cards `0 20px 40px rgba(0,0,0,.18)`; FABs get a colored glow.

## MOTION SYSTEM (global, non-negotiable)

- Durations: micro 150ms · standard 250ms · entrances 350–450ms ·
  screen crossfade 400ms · splash exit 700ms.
- Easings: entrances `cubic-bezier(.16,1,.3,1)` (easeOutExpo-like);
  exits `cubic-bezier(.4,0,1,1)`; sliding pills/thumbs
  `cubic-bezier(.34,1.56,.64,1)` (slight overshoot).
- Stagger children by 40–60ms, each fading in + `translateY(12px)→0`.
- Animate ONLY `transform` and `opacity`. Honor `prefers-reduced-motion`
  (disable the lightning canvas and long drift loops).
- Every animation has a declared duration/easing — nothing ad-hoc.

## SCREEN 1 — SPLASH (one-shot, ~2.5s)

1. Background `--bg` + faint dot grid: `radial-gradient` dots every 24px at
   6% opacity (blueprint feel).
2. Logo draw-on: inline SVG (reuse the app's existing logo paths; set
   `pathLength="1"` on every path). Animate `stroke-dashoffset: 1→0` per path,
   1.2s, staggered (outer shape first, inner bolt second), white 2px strokes.
   WHILE drawing, show blueprint decorations: 4px white squares at anchor
   points + 1px Bézier handle lines with end dots — fade these out (300ms)
   as fills begin.
3. Fill phase: gradient fills fade in (outer: white→#D9DEE7; inner:
   #67B3FF→#1D5FD6 at 120°), optionally with a brief diagonal hatch-pattern
   preview on one segment before the solid fill lands.
4. Wordmark rises below (fade + `translateY(14px)→0`, 450ms), then the tagline
   in `--text-dim` 13px.
5. EXIT (signature move): the whole logo layer scales 1→9 with ease-in over
   650ms while the next screen fades in underneath at scale 1.04→1 — the logo
   "becomes" the app.

## SCREEN 2 — AUTH (entry gate)

- Background: same dark; add the electric canvas: full-bleed `<canvas>`
  behind content. Every 1.2–2s spawn one thin branching bolt (recursive
  midpoint displacement, stroke #BFD9FF, `shadowBlur` 12 blue, alpha flickers
  0.9→0 over ~600ms, slight downward drift). Pause when the screen is hidden.
- Brand row top-left (small logo + wordmark). H1 "Welcome back." serif 40px,
  sub-copy gray 14px.
- Bottom sheet: white, `border-radius 28px 28px 0 0`, slides up 500ms
  easeOutExpo on entrance, width 100%, padding 20:
  - Segmented control: gray track (999 radius, 4px inner padding); black thumb
    slides between "Sign In"/"Sign Up" (translateX 250ms overshoot); active
    label white, inactive gray.
  - Fields (52px, radius 14, fill #F2F4F7): leading icon (mail / lock),
    focus = 1.5px accent ring + white background; password gets a trailing
    eye toggle.
  - Row: custom checkbox (accent when checked, animated check stroke) label
    "Keep me signed in" + right link "Forgot Password?".
  - Primary button: full-width 52px pill, `--accent` bg, white label, pressed
    scale .98.
  - "OR CONTINUE WITH" (11px, letter-spaced, gray) then two 50/50 ghost
    buttons with 1px #E5E8EF border (Google "G" logo, Apple logo).
  - Footer: "New to …? Create an account" with accent link — toggles the
    segmented control to Sign Up (same sheet, fields morph: name field slides
    in, password confirm optional).
- VALIDATION: empty/invalid submit → each bad field gets: border `--danger`,
  leading icon red, helper text ("Enter your email address" / "Enter your
  password") sliding down 150ms — AND the sheet shakes:
  `translateX` keyframes `[0,-9,7,-5,3,0]px` over 400ms. Errors clear on input.
- SUBMIT: label fades out, 18px white indeterminate spinner fades in
  (rotate 800ms linear) inside the button; on success → crossfade out.

## SCREEN 3 — ONBOARDING (first run only)

- Background collage: 3–4 columns of app screenshots in rounded-16 white-
  bordered cards, the whole container rotated -6° and oversized (140%),
  CSS keyframes drifting `translateY(-6%)` alternate 50s + slight X wobble;
  overlay `linear-gradient(180deg, transparent 30%, var(--bg) 85%)` for
  legibility.
- Content bottom-anchored, staggered entrance: H1 "Beautiful UI. Ready to
  build." (serif; second sentence lighter), gray body, accent pill CTA
  "Get Started", small caption underneath.
- CTA → crossfade to Home.

## SCREEN 4 — HOME

- Header: 44px avatar, bold name + gray role line; right side two 38px dark
  circles with line icons (bell, grid).
- Section title "Featured kits" serif italic 30px + "See all" accent link.
- Chips row: horizontally scrollable pills — active = black pill white text,
  inactive = `#1A2030` bg gray text; the active state animates (thumb slide or
  quick crossfade).
- Card carousel: horizontal scroll-snap; cards ~78% viewport width, white,
  radius 24, padding 18. Each card: serif title + gray subtitle, embedded
  device-mockup screenshots LAYERED (second one offset + rotated 6°, soft
  shadow), 48px accent circular FAB top-right with the diamond logo, and a
  mini-CTA row ("Hungry? …" style).
  PARALLAX (signature): on carousel scroll, each card computes its offset
  from viewport center (rAF-throttled) and translates its INNER screenshot
  layer at 0.4–0.6× of that offset — inner content moves slower than the card.
- Bottom nav: white bar (radius 20 or pill), 4 items (Home / Alerts /
  Community / Profile), active = accent icon + label, inactive gray.

## SCREEN TRANSITIONS

- Auth ⇄ Onboarding ⇄ Home: 400ms crossfade with the entering screen scaling
  1.04→1 and the outgoing fading out — produces the "ghost overlap" look.
  No slides between screens.
- Splash→Auth: the logo-zoom handoff from Screen 1 step 5.

## IMPLEMENTATION RULES

- One SPA shell; screens are `<section data-screen="…">` toggled by a tiny
  router function that owns the crossfade classes and entrance staggers.
- Vanilla only: CSS keyframes + `element.animate()` for one-shots; `<canvas>`
  for lightning; rAF + scroll listener for parallax. No GSAP/Lottie.
- Self-host the serif (woff2) under assets/fonts; inline the logo SVG with
  `pathLength` so the draw-on works.
- 60fps discipline: transform/opacity only, `will-change` on animating layers,
  cancel listeners when screens hide.
- Map existing portal content onto this system: the carousel cards become the
  portal's sections (Grades, Schedule, Exams, Meals…) with artwork per card;
  bottom nav maps to existing tabs; auth sheet wraps the existing Progres
  login (same submit handler, same fields) with the new validation visuals.
