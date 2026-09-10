# Employee master preload (local dry-run only)

This is the reviewed local preload path for the canonical `users` table. It
does not connect to D1, write SQL, import the legacy workbook, or alter GAS.
The output is a machine-readable review artifact; an invalid or conflicting
input never produces an executable operation list.

## Input contract

JSON is either an array or `{ "employees": [] }`. CSV keeps every field as
text, including leading zeroes. Required fields are:

```text
employee_id, display_name, pickup_floor, role, active
```

Optional fields are `line_user_id` and `mapping_evidence`. A non-empty
`line_user_id` is accepted only with `mapping_evidence: "reviewed"` and only
when the existing local canonical snapshot contains that exact LINE ID. The
preload never accepts a balance field and therefore cannot overwrite balances,
orders, ledger rows, audit rows, or relational ownership.

Validation is strict:

- `employee_id` must be a non-empty string matching the textual ID contract;
  JSON numbers are rejected rather than coerced.
- Blank IDs, duplicate IDs, duplicate LINE IDs, blank names, invalid floors,
  invalid roles, and invalid active values are hard failures.
- Roles are `User`, `ProxyAdmin`, or `Admin`. A privileged role is never
  inferred; it must be explicit in the input row.
- Names are presentation only. They are never used to deduplicate or merge.

## Merge semantics

The planner indexes only canonical employee and exact LINE identities:

1. A reviewed employee-to-existing-LINE mapping updates that same canonical
   user and fills `employee_id`; it never creates a second user.
2. An existing employee with `line_user_id IS NULL` remains unbound when the
   input has no LINE mapping.
3. An employee/LINE pair that resolves to different users is `CONFLICT`.
4. An unknown LINE mapping is `CONFLICT`; no guess or name fallback is made.
5. A new employee without a reviewed LINE mapping is an insert with
   `line_user_id: null`.

## Local command

The command is create-only for its report path and has no `--remote`,
`--execute`, or `--apply` mode:

```powershell
npm.cmd run employee-master:dry-run -- `
  --input tests/fixtures/employee-master.sample.json `
  --existing-users tests/fixtures/employee-master.sample-existing-users.json `
  --output .local-imports/employee-master-sample-report.json
```

The sample intentionally contains seven valid unbound employees, one reviewed
existing LINE mapping, a leading-zero ID, a duplicate employee, an invalid
floor, an invalid role, and a blank ID. Its expected report is:

```json
{
  "insert": 7,
  "update": 1,
  "skip": 0,
  "conflict": 0,
  "invalid": 4,
  "executable": false,
  "remoteMutation": "NOT_EXECUTED"
}
```

The invalid rows deliberately make the complete report non-executable. A
reviewed valid-only input is required before any later, separately authorized
production preload checkpoint.
