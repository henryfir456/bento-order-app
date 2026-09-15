# Automatic Daily Group Opening Design

## Goal

At the Cloudflare Worker’s Asia/Taipei midnight schedule, open the second
following Monday-Friday order date for the canonical vendor `禾拾` when no
vendor assignment exists.

## Architecture

The formal Worker exports a Cloudflare `scheduled` handler and configures the
daily UTC trigger `0 16 * * *`. The handler converts
`controller.scheduledTime` with the existing `getTaipeiDate` helper, skips
Taipei Saturday and Sunday, calculates the target date with a pure business
day helper, and delegates persistence to the same calendar-setting write path
used by `setCalendarSetting`.

The shared persistence path retains manual Admin authorization, mode, and
audit behavior. The scheduled path uses the existing canonical vendor
normalization and the mode already required for `禾拾` (`B`), with an atomic
conditional upsert that inserts or fills only a blank assignment. A nonblank
assignment causes no write and produces `SKIP_ALREADY_OPEN`; the date primary
key and conditional write make repeated or concurrent triggers idempotent.

No menu, menu-version, image, auth, frontend, or historical-data behavior is
changed. The existing `vendor_source` values remain unchanged. Structured
Worker logs identify `automatic_daily_group_opening`, the Taipei business
date, target date, outcome, and vendor; no audit row is written because the
current audit schema requires a real user actor.

## Testing

Focused Worker tests cover all weekday mappings, weekend no-ops, exact
Asia/Taipei midnight conversion, year/month boundaries, existing assignments,
atomic creation, repeated invocation, concurrent invocation, canonical mode,
provenance logging, and unchanged menu reads. Existing calendar/admin,
runtime-config, and schema tests remain in the verification set.

