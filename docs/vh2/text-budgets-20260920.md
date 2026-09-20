# VH2 text budgets and reply diagnostics

VH2 now accounts for text requests per character/provider scope, across that character's lives. Counts come from the immutable provider versions saved with dialogue, social-caption and life-adviser jobs. Another character's requests do not consume this allowance. Reservations include failed and uncertain submissions; they reset at midnight UTC.

New character connections have two categories:

- **Chat and calls:** no local daily cap by default. This includes replies to player messages, even when the service queues the reply automatically after attention becomes available. The provider may still impose its own limits.
- **Background:** social captions and daily life-adviser calls share a bounded allowance of six requests per day. When an enabled Always On setting is explicitly synchronized, its configured background allowance is retained. Background feature switches remain required.

The disabled legacy Always On setting no longer supplies a cap for new foreground dialogue. Existing untagged `dailyLimit` settings are ambiguous: the service cannot know whether an old six-request cap was inherited accidentally or deliberately chosen. These remain enforced as a **visible legacy shared cap** until the user saves separate budgets. The chat displays its usage and offers **Text request budgets** directly; users can disable the dialogue cap, set an explicit limit, or use zero to block a category. Saving never submits or retries a request. A previously queued request also retains its frozen spending constraints; an explicit retry takes a fresh configuration.

**Reply details**, beside the chat budget control, shows recent attempts, model, status and errors. Provider-returned input/output/total/cached/reasoning token counts are shown only when reported as valid non-negative integers. Missing counts remain unavailable; no estimate is presented as actual usage. The optional frozen prompt preview includes text only, redacts the configured provider key and bearer credentials, omits media data, and explicitly labels its 24,000-character preview bound. Diagnostic token receipts survive service backups and copied character archives; old archives without receipts remain readable.

## Verification

All testing used local fixtures, without paid provider calls:

- `scratch/vh2_budget_audit.py`: 19 checks, including seven successful dialogue turns beyond the old six-request limit, exhausted background allowance isolation, multiple characters, enabled caps across provider versions, legacy migration, UTC reset, token reporting/redaction and unknown outcomes.
- `scratch/vh2_budget_ui_audit.js`: disabled Always On policy isolation; explicit enabled background sync; visible usage, reset and migration language.
- `scratch/vh2_budget_browser_audit.js`: real chat notice, direct legacy budget control, persisted cap-off migration, token-count and prompt-detail UI, zero page errors.
- `scratch/vh2_social_worker_audit.py`: 4 checks, including zero background allowance blocking social generation.
- `scratch/vh2_life_adviser_audit.py`: 14 checks, including scoped legacy limits and separate background blocking.
- `scratch/vh2_backup_audit.py`: 14 checks, including receipt round trips through backup/character copy and old-archive compatibility.
