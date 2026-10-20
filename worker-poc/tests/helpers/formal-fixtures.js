import { randomUUID } from 'node:crypto';
import { handleFormalRequest as runFormalRequest } from '../../src/formalWorker.js';

const activeSyntheticMappings = new WeakMap();

export const handleFormalRequest = async (request, env, options = {}) => {
  const database = env?.DB;
  const url = new URL(request.url);
  if (request.method === 'OPTIONS' || (request.method === 'GET' && url.pathname === '/api/health')
    || !database?.prepare) {
    return runFormalRequest(request, env, options);
  }

  let entry = activeSyntheticMappings.get(database);
  if (entry) {
    entry.references += 1;
  } else {
    entry = { references: 1, installed: false, ownerId: null, ready: null };
    activeSyntheticMappings.set(database, entry);
    entry.ready = (async () => {
      let result;
      try {
        result = await database.prepare(`
          SELECT account_key FROM protected_account_employee_mappings
          WHERE account_key = 'RESERVED_VENDOR_OWNER'
          LIMIT 1
        `).all();
      } catch {
        return;
      }
      const mappings = Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : []);
      if (mappings.length) return;

      const fixtureSuffix = randomUUID();
      entry.ownerId = `test-protected-owner-${fixtureSuffix}`;
      const employeeId = `TEST-PROTECTED-OWNER-${fixtureSuffix}`;
      const lineUserId = `line-test-protected-owner-${fixtureSuffix}`;
      const createdAt = new Date().toISOString();
      await database.prepare(`
        INSERT INTO users (
          user_id, employee_id, line_user_id, display_name, pickup_floor, active, verification_status
        ) VALUES (?, ?, ?, 'Synthetic protected configuration', '1樓', 1, 'VERIFIED')
      `).bind(entry.ownerId, employeeId, lineUserId).run();
      try {
        await database.prepare(`
          INSERT INTO protected_account_employee_mappings (account_key, employee_id, created_at)
          VALUES ('RESERVED_VENDOR_OWNER', ?, ?)
        `).bind(employeeId, createdAt).run();
      } catch (error) {
        await database.prepare('DELETE FROM users WHERE user_id = ?').bind(entry.ownerId).run();
        entry.ownerId = null;
        throw error;
      }
      entry.installed = true;
    })();
  }

  try {
    await entry.ready;
    return await runFormalRequest(request, env, options);
  } finally {
    entry.references -= 1;
    if (entry.references === 0) {
      activeSyntheticMappings.delete(database);
      if (entry.installed) {
        await database.prepare(`
          DELETE FROM protected_account_employee_mappings WHERE account_key = 'RESERVED_VENDOR_OWNER'
        `).run();
        await database.prepare('DELETE FROM users WHERE user_id = ?').bind(entry.ownerId).run();
      }
    }
  }
};

export const seedUser = (database, {
  lineUserId = null,
  userId = lineUserId,
  employeeId = lineUserId ? `employee-${lineUserId}` : null,
  displayName = lineUserId,
  pickupFloor = '1樓',
  balance = 0,
  role = 'User',
  active = 1,
  verificationStatus = 'VERIFIED'
}) => {
  database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, userId, employeeId, lineUserId, displayName, pickupFloor, balance, role, active, verificationStatus);
};

export const seedMenuVersion = (database, {
  menuVersionId,
  vendor = 'Vendor A',
  effectiveDate = '2026-09-08'
}) => {
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `, menuVersionId, vendor, effectiveDate);
};

export const seedVendor = (database, {
  vendorId,
  name,
  description = '',
  phone = '',
  address = '',
  websiteUrl = '',
  menuSourceUrl = '',
  menuImageUrl = '',
  menuUpdatedAt = null,
  enabled = 1
}) => {
  database.run(`
    INSERT INTO vendors (
      vendor_id, name, description, phone, address, website_url,
      menu_source_url, menu_image_url, menu_updated_at, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    vendorId,
    name,
    description,
    phone,
    address,
    websiteUrl,
    menuSourceUrl,
    menuImageUrl,
    menuUpdatedAt,
    enabled
  );
};

export const seedLedgerRow = (database, {
  transactionId,
  userId,
  amount,
  balanceAfter,
  type = 'ADJUSTMENT',
  referenceId = null,
  topupMethod = null,
  note = '',
  occurredAt = '2026-09-06T00:00:00.000Z'
}) => {
  database.run(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type,
      reference_id, topup_method, note, auth_mode, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'legacy_import', ?)
  `, transactionId, userId, amount, balanceAfter, type, referenceId, topupMethod, note, occurredAt);
};

export const profileFetch = ({
  token = 'token-user',
  lineUserId = 'user-1',
  displayName = 'Synthetic User'
} = {}) => async (url, init) => {
  if (url !== 'https://api.line.me/v2/profile') {
    throw new Error('unexpected profile URL');
  }
  if (init?.headers?.Authorization !== 'Bearer ' + token) {
    return new Response('{}', { status: 401 });
  }
  return Response.json({ userId: lineUserId, displayName });
};

export const request = (path, {
  method = 'GET',
  token = 'token-user',
  body,
  headers = {}
} = {}) => new Request('https://formal.test' + path, {
  method,
  headers: {
    Authorization: 'Bearer ' + token,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...headers
  },
  ...(body ? { body: JSON.stringify(body) } : {})
});
