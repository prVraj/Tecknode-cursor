# Create GitHub Issue

Create a GitHub issue using `gh` for this repo (`prVraj/Tecknode-cursor`).

## Gather details

If the user did not specify title, type, or description, ask briefly before creating the issue.

## Available labels

| Label | Use when |
|-------|----------|
| `bug` | Something is broken or regressed |
| `enhancement` | New feature or improvement |
| `documentation` | Docs gaps or README updates |
| `question` | Needs clarification before work |
| `help wanted` | Open for contribution |
| `good first issue` | Small, well-scoped starter task |

Apply **one primary type label** (`bug`, `enhancement`, `documentation`, or `question`).

## Create the issue

```bash
gh issue create \
  --title "Short descriptive title" \
  --body "$(cat <<'EOF'
## Description
What is wrong or needed?

## Steps to reproduce (bugs)
1. ...

## Expected vs actual
- Expected: ...
- Actual: ...

## Acceptance criteria
- [ ] ...

EOF
)" \
  --label "enhancement"
```

Adapt the body for the issue type:

- **bug** — include steps to reproduce and expected vs actual
- **enhancement** — include problem, proposed solution, acceptance criteria
- **documentation** — include what docs are missing or unclear
- **question** — include context and what decision is needed

## Optional follow-ups

```bash
gh issue view <number>
gh issue edit <number> --add-assignee "@me"
gh issue comment <number> --body "Additional context..."
```

## Finish

Return the issue URL and number when done.
