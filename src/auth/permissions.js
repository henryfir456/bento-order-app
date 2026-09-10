export const ROLE_PERMISSIONS = Object.freeze({
  User: Object.freeze({
    orderOwn: true,
    editOwnOrder: true,
    cancelOwnOrder: true,
    viewOwnBalance: true,
    viewOwnTransactions: true,
    viewAdminOrderSummary: true,
    viewAllOrders: true,
    viewOrderStatistics: true,
    viewMemberBalances: false,
    topupMember: false,
    manageAnnouncements: false
  }),
  ProxyAdmin: Object.freeze({
    orderOwn: true,
    editOwnOrder: true,
    cancelOwnOrder: true,
    viewOwnBalance: true,
    viewOwnTransactions: true,
    viewAdminOrderSummary: true,
    viewAllOrders: true,
    viewOrderStatistics: true,
    manageCalendar: true,
    viewMemberBalances: false,
    topupMember: false,
    manageAnnouncements: false
  }),
  Admin: Object.freeze({
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
    viewAsUser: true,
    manageAnnouncements: true
  })
});

export const hasPermission = (role, permission) => Boolean(ROLE_PERMISSIONS[role]?.[permission]);
