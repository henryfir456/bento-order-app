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
    bindEmployee: true,
    manageRoles: true,
    viewAsUser: true,
    manageAnnouncements: true
  })
});

export const GUEST_PERMISSIONS = Object.freeze({
  orderOwn: true,
  editOwnOrder: true,
  cancelOwnOrder: true,
  viewOwnBalance: true,
  viewOwnTransactions: true,
  viewAdminOrderSummary: false,
  viewAllOrders: false,
  viewOrderStatistics: false,
  viewMemberBalances: false,
  topupMember: false,
  manageAnnouncements: false,
  manageCalendar: false,
  manageMenu: false,
  manageUsers: false,
  bindEmployee: false,
  manageRoles: false,
  viewAsUser: false
});

export const hasPermission = (role, permission, authMode = 'line') => (
  Boolean((authMode === 'employee_guest' ? GUEST_PERMISSIONS : ROLE_PERMISSIONS[role])?.[permission])
);
