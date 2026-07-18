<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ActionLoop Marketing Site — Agent Instructions

**Source of truth:** Read `../docs/PRD.md` before making product, copy, or feature decisions. When the PRD and this file conflict, follow the PRD.

## Project

This is the **marketing site** for **ActionLoop** (working title; alternates: Loopin, Nudge) — a Next.js 16 app in `marketing-agent/`.

| | |
|---|---|
| **Problem** | Decisions and action items from meetings and chat threads get buried; tasks drop, owners are unclear, deadlines slip. |
| **Goal** | Surface action items from transcripts and chat, assign owners and deadlines, and follow up proactively. |
| **Audience** | Working professionals and small teams using Zoom/Teams meetings and WhatsApp/Slack groups. |

## Product messaging (use on the site)

- **Tagline angle:** Turn messy conversations into clear accountability.
- **Value props:** Extract action items automatically · Assign owners and deadlines · Proactive reminders · Nothing gets lost in chat.
- **Demo hook:** Paste a messy WhatsApp thread or meeting transcript → get a structured action list in seconds.
- **Before/after narrative:** Chaos vs. clarity — show the judge-facing demo flow from the PRD.

## MVP scope (what we are building toward)

Core flow from the PRD:

1. Upload/paste a meeting transcript or chat export.
2. AI extracts decisions, action items, owner, and deadline.
3. Output: **Decision → Action → Owner → Due date**.
4. Reminders fire as deadlines approach.
5. Users can edit, confirm, reassign, or mark done before reminders go out.

### Feature priority

| Priority | Features |
|---|---|
| **Must-have** | Transcript/chat ingestion · LLM extraction (action, owner, deadline) · Structured summary/dashboard · Manual edit/confirm before reminders |
| **Should-have** | Automated email/in-app reminders · WhatsApp/Slack export support |
| **Nice-to-have** | Auto-generated follow-up summary for the group · Recurring meeting memory |

### Out of scope (do not build or promise on the marketing site)

- Live audio transcription
- Deep Jira/Asana/calendar integrations (stub/mock only for demos)
- Multi-language support beyond English

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4
- **Package manager:** Bun (`bun.lock` present) — **always use Bun; never npm, yarn, or pnpm**
- **App entry:** `src/app/` — use Server Components by default; Client Components only when needed

### Bun (required)

Always use **Bun** for installs, scripts, and running the project. Do not use npm, yarn, or pnpm.

| Task | Command |
|---|---|
| Install dependencies | `bun install` |
| Add a package | `bun add <package>` |
| Add a dev dependency | `bun add -d <package>` |
| Run dev server | `bun dev` |
| Build | `bun run build` |
| Start production server | `bun start` |
| Lint | `bun run lint` |
| Run any script | `bun run <script>` |

## Code conventions

- Match existing patterns in `src/app/` (functional components, Tailwind-only styling).
- Use the Next.js `Image` component for images; use the metadata API in `layout.tsx` for SEO.
- Keep marketing copy aligned with the PRD — do not invent features outside MVP scope.
- Prefer accessible, semantic HTML (headings, landmarks, ARIA where needed).

## Success criteria (from PRD)

- Demo-able extraction accuracy (before/after vs. manual review).
- “5-minute meeting recap” vs. re-reading a 45-minute transcript.
- Judge demo: messy input → clean action list in seconds → reminder notification.

## Demo flow (reference for landing page / demo sections)

1. Show a realistic messy chat thread or meeting transcript.
2. Paste it into ActionLoop.
3. Show structured action items appearing quickly.
4. Show a reminder notification for an upcoming deadline.
5. Close with before vs. after — chaos vs. clarity.
