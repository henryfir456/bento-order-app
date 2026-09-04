function getAnnouncementDate(rawDate) {
  if (rawDate instanceof Date) {
    if (isNaN(rawDate.getTime())) return '';
    return Utilities.formatDate(rawDate, TIMEZONE, 'yyyy-MM-dd');
  }

  const dateText = String(rawDate === undefined || rawDate === null ? '' : rawDate).trim();
  return isValidDateString(dateText) ? dateText : '';
}

function warnMalformedAnnouncement(rowNumber, reason) {
  console.warn(`[ANNOUNCEMENT] Ignored malformed row ${rowNumber}: ${reason}`);
}

function getActiveAnnouncements(now) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Announcements');
  if (!sheet) {
    console.warn('[ANNOUNCEMENT] Announcements sheet not found');
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(now || new Date(), TIMEZONE, 'yyyy-MM-dd');
  const activeAnnouncements = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowNumber = i + 1;
    const id = String(row[0] === undefined || row[0] === null ? '' : row[0]).trim();
    const title = String(row[1] === undefined || row[1] === null ? '' : row[1]).trim();
    const content = String(row[2] === undefined || row[2] === null ? '' : row[2]);
    const startDate = getAnnouncementDate(row[3]);
    const endDate = getAnnouncementDate(row[4]);
    const missingFields = [];

    if (!id) missingFields.push('id');
    if (!title) missingFields.push('title');
    if (!content.trim()) missingFields.push('content');
    if (!startDate) missingFields.push('start_date');
    if (!endDate) missingFields.push('end_date');

    if (missingFields.length > 0) {
      warnMalformedAnnouncement(rowNumber, `missing or invalid ${missingFields.join(', ')}`);
      continue;
    }
    if (endDate < startDate) {
      warnMalformedAnnouncement(rowNumber, 'end_date is before start_date');
      continue;
    }

    const enabledValue = row[5];
    const enabledText = String(enabledValue === undefined || enabledValue === null ? '' : enabledValue).trim().toUpperCase();
    if (enabledValue === false || enabledText === 'FALSE') continue;
    if (!(enabledValue === true || enabledText === 'TRUE')) {
      warnMalformedAnnouncement(rowNumber, 'enabled must be TRUE');
      continue;
    }

    if (today < startDate || today > endDate) continue;

    activeAnnouncements.push({
      id,
      title,
      content,
      start_date: startDate,
      end_date: endDate,
      rowNumber
    });
  }

  return activeAnnouncements
    .sort((left, right) => (
      right.start_date.localeCompare(left.start_date)
      || right.rowNumber - left.rowNumber
    ))
    .map(({ rowNumber, ...announcement }) => announcement);
}

function getLatestAnnouncement(now) {
  return getActiveAnnouncements(now)[0] || null;
}
