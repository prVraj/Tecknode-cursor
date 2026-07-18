# Create Pull Request

Create a pull request for the current branch using `gh`. Base branch: `main`.

## Before creating the PR

Run in parallel:

```bash
git status
git diff
git branch -vv
git log --oneline main..HEAD
git diff main...HEAD
```

Review **all commits** on this branch, not just the latest.

## Push and create

If the branch is not on the remote yet:

```bash
git push -u origin HEAD
```

Create the PR:

```bash
gh pr create --base main --title "<type>: <short description>" --body "$(cat <<'EOF'
## Summary
- What changed and why (1–3 bullets)

## Test plan
- [ ] Step to verify the change

EOF
)"
```

## Title format

Use conventional prefixes:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — code restructuring
- `chore:` — tooling, deps, config

## Labels

Apply after creation when appropriate:

| Change type | Label |
|-------------|-------|
| Bug fix | `bug` |
| New feature | `enhancement` |
| Documentation | `documentation` |
| Needs help | `help wanted` |

```bash
gh pr edit <number> --add-label "enhancement"
```

## Link issues

If this PR closes an issue, include in the body:

- `Closes #123`
- `Fixes #123`

## Finish

Return the PR URL when done.

Do not merge unless the user explicitly asks.
