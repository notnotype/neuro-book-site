# Task Walkthroughs

`docs/tasks/` records long-lived task context.

## When to create or update

- Create a task when work changes behavior, architecture, product direction, or long-term TODOs.
- Continue updating the same task for follow-up adjustments to the same feature.
- Pure Q&A or failed read-only exploration does not require a task update.

## Naming

- Active task directories use `NN-kebab-case-name/`.
- Each task directory contains at least `README.md`.

## Sync

When a major task changes project state, update both:

- `PROJECT-STATUS.md`
- The active task walkthrough.
