const toUser = (row) => {
  if (!row) return null;
  return {
    lineUserId: String(row.line_user_id),
    displayName: String(row.display_name || ''),
    pickupFloor: String(row.pickup_floor || ''),
    balance: Number(row.balance),
    role: String(row.role || 'User'),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
};

export const getUserByLineId = async (database, lineUserId) => {
  const row = await database.prepare(`
    SELECT line_user_id, display_name, pickup_floor, balance, role, created_at, updated_at
    FROM users
    WHERE line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  return toUser(row);
};

export const publicUser = (user) => {
  if (!user) return null;
  return {
    userId: user.lineUserId,
    name: user.displayName,
    floor: user.pickupFloor,
    defaultFloor: user.pickupFloor,
    balance: user.balance,
    role: user.role,
    lineUserId: user.lineUserId,
    displayName: user.displayName
  };
};
