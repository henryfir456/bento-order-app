PRAGMA foreign_keys = ON;

-- Every row in this seed belongs to the disposable local UAT database.
INSERT INTO users (
  user_id, employee_id, line_user_id, display_name, pickup_floor,
  balance, role, active, verification_status, invalid_reason
) VALUES
  ('local-uat-admin', 'LOCAL-UAT-ADMIN', 'local-uat-line-admin', '合成 Admin', '1樓', 0, 'Admin', 1, 'VERIFIED', NULL),
  ('local-uat-user', 'LOCAL-UAT-USER', 'local-uat-line-user', '合成 User', '9樓', 0, 'User', 1, 'VERIFIED', NULL),
  ('local-uat-vendor-one', 'LOCAL-UAT-VENDOR-ONE', 'local-uat-line-vendor-one', '合成 Vendor V' || printf('%05d', 1), '1樓', 0, 'User', 1, 'VERIFIED', NULL),
  ('local-uat-vendor-two', 'LOCAL-UAT-VENDOR-TWO', 'local-uat-line-vendor-two', '合成 Vendor V' || printf('%05d', 2), '1樓', 0, 'User', 1, 'VERIFIED', NULL),
  ('local-uat-protected-owner', 'LOCAL-UAT-PROTECTED-OWNER', 'local-uat-line-protected-owner', '合成受保護帳號 Owner', '1樓', 0, 'User', 1, 'VERIFIED', NULL);

INSERT INTO protected_account_user_mappings (account_key, user_id, created_at)
VALUES ('RESERVED_VENDOR_OWNER', 'local-uat-protected-owner', '2026-10-21T00:00:00.000Z');

INSERT INTO vendors (vendor_id, name, description, enabled)
VALUES
  (printf('V%05d', 1), '合成測試店家甲', '[SYNTHETIC UAT] vendor one', 1),
  (printf('V%05d', 2), '合成測試店家乙', '[SYNTHETIC UAT] isolation canary two', 1);

INSERT INTO vendor_principals (user_id, principal_role, status)
VALUES
  ('local-uat-vendor-one', 'Vendor', 'ACTIVE'),
  ('local-uat-vendor-two', 'Vendor', 'ACTIVE');

INSERT INTO vendor_memberships (user_id, vendor_id, status)
VALUES
  ('local-uat-vendor-one', (SELECT vendor_id FROM vendors WHERE name = '合成測試店家甲'), 'ACTIVE'),
  ('local-uat-vendor-two', (SELECT vendor_id FROM vendors WHERE name = '合成測試店家乙'), 'ACTIVE');

INSERT INTO announcements (
  announcement_id, title, content, start_date, end_date,
  enabled, source_order, image_urls_json, auto_popup_eligible_at,
  created_at, updated_at
) VALUES (
  'local-uat-announcement-001',
  '[合成測試] 隔離 Worker 公告',
  'This announcement and its unread state are synthetic local UAT data.',
  '2026-10-01', '2026-10-31', 1, 100, '[]',
  '2026-10-20T00:00:00.000Z',
  '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'
);

INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
VALUES
  ('local-uat-menu-one-old', '合成測試店家甲', '2026-10-01'),
  ('local-uat-menu-one-new', '合成測試店家甲', '2026-10-15'),
  ('local-uat-menu-two', '合成測試店家乙', '2026-10-01');

INSERT INTO menu_items (
  menu_item_id, menu_version_id, legacy_item_id, variant_key,
  item_name, price, enabled, source_order
) VALUES
  ('local-uat-r-old', 'local-uat-menu-one-old', 'R', 'BASE', '風味便當', 90, 1, 1),
  ('local-uat-b-old', 'local-uat-menu-one-old', 'B', 'BASE', 'B.水煮低醣健康餐', 100, 1, 2),
  ('local-uat-c-old', 'local-uat-menu-one-old', 'C', 'BASE', 'C.每日特餐', 110, 1, 3),
  ('local-uat-alt-old', 'local-uat-menu-one-old', 'ALT', 'BASE', 'A.風味便當', 90, 1, 4),
  ('local-uat-fr-new', 'local-uat-menu-one-new', 'FR', 'BASE', 'A.風味便當', 95, 1, 1),
  ('local-uat-b-new', 'local-uat-menu-one-new', 'B', 'BASE', '水煮低醣健康餐', 105, 1, 2),
  ('local-uat-c-new', 'local-uat-menu-one-new', 'C', 'BASE', 'C.特餐', 115, 1, 3),
  ('local-uat-alt-new', 'local-uat-menu-one-new', 'ALT', 'BASE', 'A.風味便當', 95, 1, 4),
  ('local-uat-vendor-two-x', 'local-uat-menu-two', 'X', 'BASE', '隔離店家合成餐', 120, 1, 1);

INSERT INTO orders (
  order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, order_date, vendor, vendor_id, pickup_floor, note,
  total_amount, status, created_by_user_id, created_auth_mode,
  created_at, updated_at
) VALUES
  ('local-uat-order-user-old', 'local-uat-user', 'LOCAL-UAT-USER', 'local-uat-line-user',
   '合成 User', '2026-10-10', '合成測試店家甲', printf('V%05d', 1), '9樓', '[SYNTHETIC UAT] historical menu aliases',
   660, 'COMPLETED', 'local-uat-user', 'line', '2026-10-10T01:00:00.000Z', '2026-10-10T01:00:00.000Z'),
  ('local-uat-order-user-current', 'local-uat-user', 'LOCAL-UAT-USER', 'local-uat-line-user',
   '合成 User', '2026-10-20', '合成測試店家甲', printf('V%05d', 1), '9樓', '[SYNTHETIC UAT] active test order',
   1410, 'ACTIVE', 'local-uat-user', 'line', '2026-10-20T01:00:00.000Z', '2026-10-20T01:00:00.000Z'),
  ('local-uat-order-vendor-two', 'local-uat-admin', 'LOCAL-UAT-ADMIN', 'local-uat-line-admin',
   '合成 Admin', '2026-10-20', '合成測試店家乙', printf('V%05d', 2), '1樓', '[SYNTHETIC UAT] isolation canary',
   120, 'ACTIVE', 'local-uat-admin', 'line', '2026-10-20T01:05:00.000Z', '2026-10-20T01:05:00.000Z');

INSERT INTO order_items (
  order_id, line_no, menu_item_id, legacy_item_id,
  item_name_snapshot, quantity, unit_price, subtotal
) VALUES
  ('local-uat-order-user-old', 1, 'local-uat-r-old', 'R', '風味便當', 2, 90, 180),
  ('local-uat-order-user-old', 2, 'local-uat-b-old', 'B', 'B.水煮低醣健康餐', 1, 100, 100),
  ('local-uat-order-user-old', 3, 'local-uat-c-old', 'C', 'C.每日特餐', 1, 110, 110),
  ('local-uat-order-user-old', 4, 'local-uat-alt-old', 'ALT', 'A.風味便當', 3, 90, 270),
  ('local-uat-order-user-current', 1, 'local-uat-fr-new', 'FR', '風味便當', 4, 95, 380),
  ('local-uat-order-user-current', 2, 'local-uat-b-new', 'B', 'B.水煮低醣健康餐', 2, 105, 210),
  ('local-uat-order-user-current', 3, 'local-uat-c-new', 'C', '每日特餐', 3, 115, 345),
  ('local-uat-order-user-current', 4, 'local-uat-alt-new', 'ALT', 'A.風味便當', 5, 95, 475),
  ('local-uat-order-vendor-two', 1, 'local-uat-vendor-two-x', 'X', '隔離店家合成餐', 1, 120, 120);

INSERT INTO vendor_transfer_payments (
  payment_id, vendor_id, amount_twd, transferred_on, idempotency_key,
  request_hash, created_by_user_id, created_at
) VALUES (
  'SYNTHETIC-UAT-PAYMENT-ONE', (SELECT vendor_id FROM vendors WHERE name = '合成測試店家甲'), 100, '2026-10-20',
  'SYNTHETIC-UAT-IDEMPOTENCY-ONE', '{"synthetic":true}',
  'local-uat-admin', '2026-10-21T00:00:00.000Z'
);

INSERT INTO vendor_transfer_allocations (
  allocation_id, payment_id, vendor_id, service_date,
  amount_twd, created_by_user_id, created_at, attribution_basis
) VALUES (
  'SYNTHETIC-UAT-ALLOCATION-ONE', 'SYNTHETIC-UAT-PAYMENT-ONE',
  (SELECT vendor_id FROM vendors WHERE name = '合成測試店家甲'), '2026-10-20', 100, 'local-uat-admin', '2026-10-21T00:00:00.000Z',
  'CANONICAL_VENDOR_ATTRIBUTION_V1'
);
