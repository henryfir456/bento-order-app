const TIMEZONE = "Asia/Taipei";
const USERS_SHEET = "Users";
const ORDERS_SHEET = "Orders";
const BALANCE_LEDGER_SHEET = "TopupHistory";
const VALID_PICKUP_FLOORS = ["1樓", "9樓"];
const UNREGISTERED_USER_MESSAGE = "此 LINE 帳號尚未註冊，請聯絡管理員。";
function normalizeOrderDate(rawDate) {
  if (rawDate instanceof Date) {
    return Utilities.formatDate(rawDate, TIMEZONE, "yyyy-MM-dd");
  }
  return String(rawDate || '').trim().substring(0, 10);
}

function isValidYearMonth(year, month) {
  const yearText = String(year === undefined || year === null ? '' : year).trim();
  const monthText = String(month === undefined || month === null ? '' : month).trim();
  if (!/^\d{4}$/.test(yearText) || !/^\d{1,2}$/.test(monthText)) return false;

  const yearValue = Number(yearText);
  const monthValue = Number(monthText);
  return isFinite(yearValue)
    && isFinite(monthValue)
    && Math.floor(yearValue) === yearValue
    && Math.floor(monthValue) === monthValue
    && yearValue >= 1900
    && yearValue <= 2100
    && monthValue >= 1
    && monthValue <= 12;
}

function isValidDateString(dateString) {
  const text = String(dateString || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function ledgerTimestampKey(rawTimestamp) {
  if (rawTimestamp instanceof Date) {
    return Utilities.formatDate(rawTimestamp, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  }

  const text = String(rawTimestamp || '').trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const zonedDate = new Date(text);
    if (!isNaN(zonedDate.getTime())) {
      return Utilities.formatDate(zonedDate, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    }
  }

  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
  if (match) {
    const time = match[2] || '00:00:00';
    return match[1] + ' ' + (time.length === 5 ? time + ':00' : time);
  }

  return '';
}

function hasNumericValue(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text !== '' && isFinite(Number(text));
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
