# PRD: ActionLoop
*(working title — Loopin / Nudge are alternates)*

## 1. Problem
Decisions and action items made in meetings and chat threads (WhatsApp, Slack) routinely get buried and forgotten. There's no follow-through mechanism, so tasks silently drop, owners are unclear, and deadlines slip. This wastes time re-discussing the same decisions and erodes accountability.

## 2. Goal
Automatically surface action items from meeting transcripts and chat threads, assign owners and deadlines, and proactively follow up — so nothing important gets lost in conversation.

## 3. Target User
- Working professionals and small teams who run frequent meetings and coordinate over informal channels (WhatsApp/Slack groups) as well as formal ones (Zoom/Teams meetings).
- Anyone who's said "wait, who was supposed to do that?" a week after a meeting or group chat.

## 4. Core Use Case (MVP)
1. User uploads or pastes a meeting transcript, or connects/exports a chat thread.
2. AI extracts: decisions made, action items, owner (if named), and deadline (if stated or inferable).
3. Output is a clean, structured summary: **Decision → Action → Owner → Due date**.
4. A follow-up reminder is sent to the owner as the deadline approaches.
5. User can mark items done / reassign / edit before reminders go out.

## 5. Key Features
| Feature | Priority |
|---|---|
| Transcript/chat ingestion (paste text or upload file) | Must-have |
| Action item + owner + deadline extraction (LLM-based) | Must-have |
| Structured summary output (viewable list/dashboard) | Must-have |
| Manual edit/confirm before reminders trigger | Must-have |
| Automated reminder (email or in-app) as deadline nears | Should-have |
| Support for informal chat exports (WhatsApp/Slack) in addition to meeting transcripts | Should-have |
| Auto-generated follow-up summary message to share back with the group | Nice-to-have |
| Recurring meeting memory (track open items across multiple sessions) | Nice-to-have |

## 6. Out of Scope (for hackathon MVP)
- Live audio transcription (assume transcript/text is already available, or use an off-the-shelf speech-to-text API rather than building one).
- Deep integrations with calendar/project management tools (Jira, Asana, etc.) — stub this out or mock it for the demo.
- Multi-language support beyond English.

## 7. Success Metrics
- Accuracy of extracted action items vs. a manually-reviewed transcript (demo-able via a before/after comparison).
- Time saved: "5-minute meeting recap" vs. manually re-reading a 45-minute transcript.
- Judge-facing demo: paste a messy WhatsApp thread or transcript → get a clean action list in seconds.

## 8. Suggested Tech Approach
- LLM (e.g., Claude API) for extraction + structuring, using a prompt that outputs strict JSON (decision, action, owner, deadline).
- Simple frontend: paste-box + structured list/table view.
- Reminder logic: basic scheduled job (cron-like) checking deadlines and firing email/notification.
- Optional: WhatsApp/Slack export parser (regex/text preprocessing) before feeding into the LLM.

## 9. Demo Flow (for judges)
1. Show a messy, realistic chat thread or meeting transcript.
2. Paste it into ActionLoop.
3. Show the clean action-item output appear in seconds.
4. Show a reminder notification firing for an upcoming deadline.
5. Close with the "before vs. after" — chaos vs. clarity.