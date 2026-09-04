function getBootstrapData(accessToken, targetDateStr) {
  const totalStart = Date.now();
  let authMs = 0;
  let usersMs = 0;
  let settingsMs = 0;
  let likesMs = 0;
  let announcementsMs = 0;
  let ordersMs = 0;
  let calendarMs = 0;

  try {
    const authStart = Date.now();
    const profile = getLineProfile(accessToken);
    authMs = Date.now() - authStart;
    if (!profile.success) return profile;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    const usersStart = Date.now();
    const usersData = usersSheet ? usersSheet.getDataRange().getValues() : [];
    const user = getRegisteredUser(profile.userId, usersData);
    usersMs = Date.now() - usersStart;

    if (!user) {
      return {
        success: true,
        registered: false,
        lineUserId: profile.userId,
        displayName: profile.displayName
      };
    }

    const settingsSheet = ss.getSheetByName('Settings');
    const likesSheet = ss.getSheetByName('Likes');
    const ordersSheet = ss.getSheetByName(ORDERS_SHEET);

    const settingsStart = Date.now();
    const settingsData = settingsSheet ? settingsSheet.getDataRange().getValues() : [];
    settingsMs = Date.now() - settingsStart;

    const likesStart = Date.now();
    const likesData = likesSheet ? likesSheet.getDataRange().getValues() : [];
    likesMs = Date.now() - likesStart;

    const announcementsStart = Date.now();
    const announcements = getActiveAnnouncements();
    announcementsMs = Date.now() - announcementsStart;

    const ordersStart = Date.now();
    const orderValues = ordersSheet ? ordersSheet.getDataRange().getValues() : [];
    const ordersMap = getUserAllOrdersMap(user.userId, user, orderValues);
    ordersMs = Date.now() - ordersStart;
    if (!ordersMap.success) return ordersMap;

    const calendarStart = Date.now();
    const calendar = getCalendarEvents(user.userId, {
      settingsData: settingsData,
      likesData: likesData,
      announcements: announcements
    });
    calendarMs = Date.now() - calendarStart;
    if (!calendar.success) return calendar;

    return {
      success: true,
      registered: true,
      user: Object.assign({}, toPublicUser(user), {
        lineUserId: profile.userId,
        displayName: profile.displayName
      }),
      calendar: {
        events: calendar.events,
        announcements: calendar.announcements,
        announcement: calendar.announcement
      },
      ordersMap: ordersMap.ordersMap,
      targetDate: String(targetDateStr || '').trim() || null
    };
  } finally {
    logPerformanceTiming('BOOTSTRAP_AUTH', authMs);
    logPerformanceTiming('BOOTSTRAP_USERS', usersMs);
    logPerformanceTiming('BOOTSTRAP_SETTINGS', settingsMs);
    logPerformanceTiming('BOOTSTRAP_LIKES', likesMs);
    logPerformanceTiming('BOOTSTRAP_ANNOUNCEMENTS', announcementsMs);
    logPerformanceTiming('BOOTSTRAP_ORDERS', ordersMs);
    logPerformanceTiming('BOOTSTRAP_CALENDAR', calendarMs);
    logPerformanceTiming('BOOTSTRAP_TOTAL', Date.now() - totalStart);
  }
}
