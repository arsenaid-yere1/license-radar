# E3-S2 RED history

Date: 2026-10-08. Historical development observations; these are not final source-bound gauntlet results.

- Baseline unit suite: 256/256 tests, 35 files, passed before implementation.
- Initial domain stub threw `Not implemented`: all six new summary/property tests failed on behavior. Restored domain implementation passed the narrow 16-test date suite.
- Initial dashboard route/panel stubs and absent entry links: six new route/presentation tests failed; 15 inherited tests passed. Implementation subsequently passed all 21.
- QP03 temporary `days <= 60` to `days < 60`: failed after five generated cases, shrank to `[1,60]`, expected one due entry but received zero. Original source restored exactly.
- QP04 temporary removal of due-list `.sort(byDate)`: failed after one generated case, shrank to two same-title/day records; reversed input returned UUID 2 before UUID 1. Original source restored exactly.
- Existing M13 navigation test extended for dashboard: temporary visible label removal failed its dashboard link lookup. Original source restored exactly; recovered pending/uncertain test passed.
- New real API Q01/Q10/member-role witnesses: temporary `projectDashboard` throw made all three selected tests fail with `Dashboard fixture mutant`; the fourth missing-cycle test was not selected and does not receive this RED claim. Original source restored exactly. Missing-cycle failures separately exercise the inherited repository validation defense; inherited mutation and SQL adversarial controls cover that boundary.
- First real browser run: 14/16 passed; two failures were fixture assumptions, not application defects. Detail preserves the inherited capitalized `Coverage end date:` label. Shared error `reset()` does not re-fetch a server snapshot. Spec Revision 3 corrected the label and recovery trigger to a fresh request; shared error behavior was not changed.
- The two immediately passing new browser tests (stale detail/corrections and viewer/revoked authority) both failed with a temporary route throw: expected count links were absent. Original route source restored exactly and production build rerun. A first throw attempt produced TypeScript unreachable-code narrowing errors and never reached browser execution; it is not counted as a behavioral RED.
- First dashboard-only property mutation: 67 killed, 1 survived, 33 compiler-invalid; score 98.53%, correctly failed the unchanged 100% threshold. Survivor was missing due-list sort. Added QP04 as spec Revision 4, observed that exact mutation fail, restored it, then reran: 68 killed, 0 survivors, 33 compiler-invalid, 100%.
- Sandbox-only API auth connections failed (`fetch failed`); sandbox-only Stryker listener failed (`listen EPERM`). Existing local service checks and escalated local verification succeeded. These environment failures are not application defects or behavioral RED evidence. A read-only Supabase help attempt could not write its external telemetry path; subsequent checks used the existing Docker/local health endpoints.

Temporary mutation/stub logs were captured outside `reports/` during development so gauntlet cleanup did not replace the observations. The final evidence uses the repository's persisted `npm run gauntlet` entry point, its source identity, and fresh final logs; the historical throwaway controls above are not additional permanent gauntlet layers.
