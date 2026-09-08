import { handleFormalRequest } from '../../src/formalWorker.js';
import { profileFetch, request, seedMenuVersion, seedUser } from './formal-fixtures.js';
import { SqliteD1 } from './formal-db.js';

export const ORDER_DATE = '2026-09-08';
export const ORDER_NOW = new Date('2026-09-07T01:00:00.000Z');

export const seedOrderDatabase = ({ balance = 100 } = {}) => {
  const database = new SqliteD1();
  seedUser(database, {
    lineUserId: 'user-1',
    displayName: 'User One',
    pickupFloor: '1樓',
    balance
  });
  seedUser(database, {
    lineUserId: 'user-2',
    displayName: 'User Two',
    pickupFloor: '9樓',
    balance: 0
  });
  seedUser(database, {
    lineUserId: 'admin-1',
    displayName: 'Admin One',
    pickupFloor: '1樓',
    role: 'Admin',
    balance: 0
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES (?, ?, ?)
  `, ORDER_DATE, 'Vendor A', 'A');
  seedMenuVersion(database, {
    menuVersionId: 'version-order',
    vendor: 'Vendor A',
    effectiveDate: '2026-09-01'
  });
  const insertMenuItem = `
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, note, image_url, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  database.run(insertMenuItem, 'menu-a', 'version-order', 'legacy-duplicate', 'Item A', 80, 1, '', '', 1);
  database.run(insertMenuItem, 'menu-b', 'version-order', 'legacy-duplicate', 'Item B', 30, 1, '', '', 2);
  database.run(insertMenuItem, 'menu-disabled', 'version-order', 'legacy-disabled', 'Disabled', 70, 0, '', '', 3);
  return database;
};

export const callOrderRoute = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, { ...options, token: options.token || profile.token || 'token-user' }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: options.now || ORDER_NOW
    }
  );
  return { response, body: await response.json() };
};

export const userProfile = (lineUserId = 'user-1', token = 'token-user') => ({
  token,
  lineUserId,
  displayName: lineUserId
});
