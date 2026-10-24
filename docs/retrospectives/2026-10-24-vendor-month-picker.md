# 2026-10-24 Restore vendor month picker

- What happened: 0.19.3 hid the whole heading card for the Vendor layout, which also held the month picker used by the 訂單總覽 and 對帳 tabs.
- Fix: render the month picker on its own for Vendor accounts outside the 今日 tab (0.19.5).
- Lesson: before removing a card, list every control inside it; a "name only" card was not name only.
