export const seedUser = (database, {
  lineUserId = null,
  userId = lineUserId,
  employeeId = lineUserId ? `employee-${lineUserId}` : null,
  displayName = lineUserId,
  pickupFloor = '1樓',
  balance = 0,
  role = 'User',
  active = 1
}) => {
  database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, userId, employeeId, lineUserId, displayName, pickupFloor, balance, role, active);
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
