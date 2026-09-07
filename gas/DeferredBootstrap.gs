const DEFERRED_UI_METRICS = {
  DEFERRED_UI_TOTAL_MS: true,
  LIKES_MS: true,
  ANNOUNCEMENTS_MS: true
};

function logDeferredBootstrapTiming(bootId, metric, elapsedMs, status) {
  if (!DEFERRED_UI_METRICS[metric] || elapsedMs === null || elapsedMs === undefined) return;

  const payload = {
    status: BOOTSTRAP_STATUSES[status] ? status : 'error',
    metric: metric,
    durationMs: Math.max(0, Math.round(Number(elapsedMs) || 0))
  };
  const message = '[PERF][BOOT][' + resolveBootId(bootId) + '] deferred-backend ' + JSON.stringify(payload);
  if (typeof console !== 'undefined') {
    if (typeof console.info === 'function') {
      console.info(message);
      return;
    }
    if (typeof console.log === 'function') {
      console.log(message);
      return;
    }
  }
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(message);
  }
}

function getDeferredBootstrapData(accessToken, bootId) {
  const resolvedBootId = resolveBootId(bootId);
  const totalStart = Date.now();
  let likesMs = null;
  let announcementsMs = null;
  let deferredStatus = 'error';
  const timingSummary = {
    status: 'error',
    metrics: {}
  };

  const recordTiming = (metric, elapsedMs) => {
    if (!DEFERRED_UI_METRICS[metric]) return;
    timingSummary.metrics[metric] = Math.max(0, Math.round(Number(elapsedMs) || 0));
  };

  const finish = (result, status) => {
    deferredStatus = BOOTSTRAP_STATUSES[status] ? status : 'error';
    timingSummary.status = deferredStatus;
    return Object.assign({}, result, {
      bootId: resolvedBootId,
      observability: {
        timing: timingSummary
      }
    });
  };

  try {
    const profile = getLineProfile(accessToken);
    if (!profile.success) return finish(profile, 'error');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    const usersData = usersSheet ? usersSheet.getDataRange().getValues() : [];
    const user = getRegisteredUser(profile.userId, usersData);
    if (!user) {
      return finish({
        success: false,
        message: UNREGISTERED_USER_MESSAGE
      }, 'error');
    }

    const likesSheet = ss.getSheetByName('Likes');
    const announcementsStart = Date.now();
    const announcements = getActiveAnnouncements(ss);
    announcementsMs = Date.now() - announcementsStart;

    const likesStart = Date.now();
    const likesData = likesSheet ? likesSheet.getDataRange().getValues() : [];
    const likes = getDeferredCalendarLikeState(user.userId, likesData);
    likesMs = Date.now() - likesStart;

    return finish({
      success: true,
      registered: true,
      likes: likes,
      announcements: announcements,
      announcement: announcements[0] || null
    }, 'success');
  } catch (err) {
    const errorType = err && err.name ? String(err.name) : typeof err;
    console.error('[IDENTITY] DEFERRED_UI_BACKEND_ERROR type=' + errorType);
    return finish(identityError('DEFERRED_UI_BACKEND_ERROR'), 'error');
  } finally {
    if (likesMs !== null) recordTiming('LIKES_MS', likesMs);
    if (announcementsMs !== null) recordTiming('ANNOUNCEMENTS_MS', announcementsMs);
    const totalMs = Date.now() - totalStart;
    recordTiming('DEFERRED_UI_TOTAL_MS', totalMs);
    logDeferredBootstrapTiming(resolvedBootId, 'LIKES_MS', likesMs, deferredStatus);
    logDeferredBootstrapTiming(resolvedBootId, 'ANNOUNCEMENTS_MS', announcementsMs, deferredStatus);
    logDeferredBootstrapTiming(resolvedBootId, 'DEFERRED_UI_TOTAL_MS', totalMs, deferredStatus);
  }
}
