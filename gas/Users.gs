function getRegisteredUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  if (!userSheet) return null;

  const data = userSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0] || '').trim() === normalizedUserId) {
      return {
        rowIndex: i + 1,
        userId: normalizedUserId,
        name: String(row[1] || '').trim(),
        defaultFloor: String(row[2] || '').trim(),
        floor: String(row[2] || '').trim(),
        balance: Number(row[3] || 0),
        role: String(row[4] || 'User').trim() || 'User'
      };
    }
  }

  return null;
}

function getIdentityError(userId) {
  return getRegisteredUser(userId) ? null : UNREGISTERED_USER_MESSAGE;
}

function isValidPickupFloor(floor) {
  return VALID_PICKUP_FLOORS.indexOf(String(floor || '').trim()) >= 0;
}

function isAdminUser(userId) {
  const user = getRegisteredUser(userId);
  return Boolean(user && hasPermission(user.role, 'manageRoles'));
}

function toPublicUser(user) {
  return {
    userId: user.userId,
    name: user.name,
    floor: user.defaultFloor,
    defaultFloor: user.defaultFloor,
    balance: user.balance,
    role: user.role
  };
}

function getAllUserSummaries(userSheet) {
  const userData = userSheet.getDataRange().getValues().slice(1);
  return userData.map(row => ({
    userId: row[0],
    name: row[1],
    floor: row[2],
    balance: Number(row[3] || 0),
    role: row[4] || "User"
  }));
}

