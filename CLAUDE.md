# Kennko Cafe — Build Instructions

## What to Build
A single-page landing page (`index.html`) for Kennko Cafe. Everything in one file — HTML, CSS, no external frameworks.

## Brand Context
Read `brand/BRIEF.md` for all cafe info, brand guidelines, color palette, and copy direction.

## Assets
Brand assets (logo, photos, graphics) are in `brand/assets/`. Use them directly via relative paths.

## Requirements
- Single `index.html` file, self-contained (inline CSS)
- Mobile-responsive
- Sections: Hero with CTA, About, Menu Highlights, Location/Contact, Footer
- Use the exact brand colors, fonts, and tone from the brief
- Reference images from `brand/assets/` where provided
- Modern, clean design — not template-y
- Deployed via Vercel (static), so no server-side code

## After Building
- Commit and push to `main`
- Vercel auto-deploys on push

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
