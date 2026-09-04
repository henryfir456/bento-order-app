const ROLE_PERMISSIONS = {
  User: {
    orderOwn: true,
    editOwnOrder: true,
    cancelOwnOrder: true,
    viewOwnBalance: true,
    viewOwnTransactions: true,
    viewMemberBalances: false,
    topupMember: false
  },
  ProxyAdmin: {
    orderOwn: true,
    editOwnOrder: true,
    cancelOwnOrder: true,
    viewOwnBalance: true,
    viewOwnTransactions: true,
    viewAdminOrderSummary: true,
    viewAllOrders: true,
    viewOrderStatistics: true,
    viewMemberBalances: false,
    topupMember: false
  },
  Admin: {
    orderOwn: true,
    editOwnOrder: true,
    cancelOwnOrder: true,
    viewOwnBalance: true,
    viewOwnTransactions: true,
    viewAdminOrderSummary: true,
    viewAllOrders: true,
    viewOrderStatistics: true,
    viewMemberBalances: true,
    viewMemberTransactions: true,
    topupMember: true,
    manageCalendar: true,
    manageMenu: true,
    manageUsers: true,
    manageRoles: true,
    viewAsUser: true
  }
};

function hasPermission(role, permission) {
  const rolePermissions = ROLE_PERMISSIONS[String(role || 'User')] || ROLE_PERMISSIONS.User;
  return rolePermissions[permission] === true;
}
