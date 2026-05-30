# Authoritative Research Brief

This file is the source of truth for the complex dynamic-workflow scenario.

## Product Facts

| Claim | Correct value | Evidence |
| --- | --- | --- |
| Supported export formats | CSV, JSONL, Parquet | Product analytics export contract v3 |
| Unsupported export formats | XML, XLS, YAML | These were removed before launch |
| PII retention limit | 30 days | Compliance decision CD-17 |
| Default retry policy | 3 attempts with exponential backoff | Runtime policy RP-9 |
| Maximum concurrent workers | 8 | Capacity decision CAP-4 |
| Launch region | us-east-1 only | Rollout plan R-2 |

## Known Traps

- Several old notes claimed XML export would ship. That is obsolete.
- Some draft docs claimed a 90-day PII retention period. That is obsolete.
- A planning memo proposed 16 concurrent workers. That was rejected.

For this scenario, the correct implementation summary is:

1. Export formats are CSV, JSONL, and Parquet.
2. PII retention is 30 days.
3. Retry count is 3.
4. Maximum workers is 8.
5. Launch is us-east-1 only.
