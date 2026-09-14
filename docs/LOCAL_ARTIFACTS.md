# Local artifacts

This repository keeps generated investigation and test evidence outside the
tracked source tree. The root `.local/` directory is ignored by Git; it is a
workspace for reproducible local runs, not a release input.

| Folder | Purpose | Typical contents | Tracking rule |
| --- | --- | --- | --- |
| `.local/ai/` | Agent-run diagnostics and implementation evidence | baseline/modified copies, test logs, lint/build output, rollback checks | Ignore; regenerate when needed |
| `.local/codex/` | Codex task artifacts | task reports, diffs, verification records, rollback scripts, UI captures | Ignore; retain locally for audit context |
| `.local/screenshots/` | Manual browser and deployment captures | PNG screenshots of sidebar/list/search states | Ignore; attach selectively to a review instead |
| `.local/qa/` | Feature QA fixtures and result snapshots | collection/tag/relevance/error-path screenshots and logs | Ignore; regenerate from the QA flow |
| `.local/staging/` | Staging-only deployment evidence | preview pages, health responses, CORS checks, deploy logs | Ignore; never ship as application input |

## Repository policy

- Track source, tests, manifests, configuration, and documentation required to
  reproduce the product.
- Ignore generated logs, screenshots, temporary copies, deployment responses,
  and rollback evidence unless a review explicitly promotes a small report into
  `docs/`.
- Keep credentials and machine-specific configuration out of both tracked files
  and `.local/`.

The migration on 2026-09-14 moved the previously untracked root entries into
these categories without changing their contents. Original root names are
preserved as child names under the relevant category for easy lookup; the former
`.codex/` container is flattened into `.local/codex/` so its task folders are
directly addressable.
