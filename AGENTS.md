<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design System

The visual design language for this app is defined in [`DESIGN.md`](./DESIGN.md) (Linear's design system). Treat it as the single source of truth for all UI decisions.

- **Re-read the relevant section of `DESIGN.md` before building or restyling any UI.**
- **Never introduce colors, fonts, spacing, radii, or shadows that aren't defined in `DESIGN.md`.** Pull from its token values, not ad-hoc ones.
- This project uses **Tailwind CSS v4**, so design tokens belong in `src/app/globals.css` under `@theme` — map `DESIGN.md`'s values to theme variables there, then reference those variables in components rather than hardcoding hex/px.
