export const TIME_ZONE = 'Asia/Taipei';
export const BOOT_ID_PATTERN = /^BOOT-\d{8,17}-[a-z0-9]{4,12}$/i;

export const asText = (value) => (
  value === null || value === undefined ? '' : String(value)
);

export const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const asBoolean = (value) => value === true || Number(value) === 1;

export const isDateOnly = (value) => {
  const text = asText(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const [year, month, day] = text.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const normalizeDateOnly = (value) => {
  const text = asText(value).trim();
  return isDateOnly(text) ? text : null;
};

export const getTaipeiDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: TIME_ZONE,
    year: 'numeric'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const dateToTaipeiDeadline = (orderDate, mode) => {
  const [year, month, day] = orderDate.split('-').map(Number);
  const deadlineDate = new Date(Date.UTC(year, month - 1, day));

  if (mode === 'B') {
    deadlineDate.setUTCDate(deadlineDate.getUTCDate() - 1);
    deadlineDate.setUTCHours(10, 0, 0, 0);
  } else {
    deadlineDate.setUTCHours(2, 0, 0, 0);
  }

  return deadlineDate;
};

export const getDeadlineInfo = (orderDate, mode, now = new Date()) => {
  const normalizedDate = normalizeDateOnly(orderDate);
  const normalizedMode = asText(mode).trim() === 'B' ? 'B' : 'A';
  if (!normalizedDate) return null;

  const deadline = dateToTaipeiDeadline(normalizedDate, normalizedMode);
  return {
    now: now.toISOString(),
    deadline: deadline.toISOString(),
    isExpired: now > deadline
  };
};

export const getLunarLabel = (dateOnly) => {
  if (!isDateOnly(dateOnly)) return null;

  try {
    const [year, month, day] = dateOnly.split('-').map(Number);
    const label = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', { day: 'numeric' })
      .format(new Date(Date.UTC(year, month - 1, day)))
      .replace(/\s/g, '');
    if (label === '1') return '初一';
    if (label === '15') return '十五';
  } catch {
    return null;
  }

  return null;
};

export const resolveMode = (vendor, mode) => {
  const explicitMode = asText(mode).trim();
  if (explicitMode) return explicitMode;
  return vendor === '禾拾' || vendor === '合十' ? 'B' : 'A';
};

export const normalizeUser = (row) => {
  const lineUserId = asText(row?.line_user_id).trim();
  const displayName = asText(row?.display_name).trim();
  const pickupFloor = asText(row?.pickup_floor).trim();
  return {
    userId: lineUserId,
    name: displayName,
    floor: pickupFloor,
    defaultFloor: pickupFloor,
    balance: asNumber(row?.balance),
    role: asText(row?.role).trim() || 'User',
    lineUserId,
    displayName
  };
};

export const normalizeAnnouncement = (row) => ({
  id: asText(row?.id).trim(),
  title: asText(row?.title).trim(),
  content: asText(row?.content),
  start_date: asText(row?.start_date).trim(),
  end_date: asText(row?.end_date).trim()
});

export const normalizeOrderLine = (row) => ({
  order_id: asText(row?.order_id),
  order_date: asText(row?.order_date),
  vendor: asText(row?.vendor),
  line_user_id: asText(row?.line_user_id),
  item_id: asText(row?.item_id),
  item_name: asText(row?.item_name),
  quantity: asNumber(row?.quantity),
  unit_price: asNumber(row?.unit_price),
  subtotal: asNumber(row?.subtotal),
  pickup_floor: asText(row?.pickup_floor),
  note: asText(row?.note),
  created_at: asText(row?.created_at)
});

export const normalizeMenuItem = (row) => ({
  item_id: asText(row?.item_id),
  item_name: asText(row?.item_name),
  price: asNumber(row?.price),
  note: asText(row?.note),
  image_url: asText(row?.image_url)
});

export const normalizeBootId = (value, fallback = null) => {
  const text = asText(value).trim();
  return BOOT_ID_PATTERN.test(text) ? text : fallback;
};

