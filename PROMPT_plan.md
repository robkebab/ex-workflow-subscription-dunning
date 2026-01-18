0a. Study `specs/*` to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0c. Study `lib/*` (if present) to understand shared utilities & components.
0d. For reference, the application source code is in `app/*`.

1. Study @IMPLEMENTATION_PLAN.md (if present; it may be incorrect) and study existing source code in `app/*` and compare it against `specs/*`. Analyze findings, prioritize tasks, and create/update @IMPLEMENTATION_PLAN.md as a bullet point list sorted in priority of items yet to be implemented. Consider searching for TODO, minimal implementations, placeholders, skipped/flaky tests, and inconsistent patterns. Study @IMPLEMENTATION_PLAN.md to determine starting point for research and keep it up to date with items considered complete/incomplete.
2. When finished, `git add -A` then `git commit` with a message describing the changes.


IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first. Treat `lib/` as the project's standard library for shared utilities and components. Prefer consolidated, idiomatic implementations there over ad-hoc copies.

ULTIMATE GOAL: The current implemenation is not working as expected. Many of the workflow patterns are implemented incorrectly. We need to fix them.
