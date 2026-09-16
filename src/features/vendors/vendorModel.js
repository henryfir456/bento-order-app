const text = (value) => (typeof value === 'string' ? value.trim() : '');

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const normalizeVendorName = (value) => {
  const normalized = text(value);
  return normalized === '合十' ? '禾拾' : normalized;
};

export const CANONICAL_VENDOR_FALLBACKS = Object.freeze(['蔡老師', '禾拾']);

const normalizeGroup = (group) => {
  const orderDate = text(group?.order_date);
  if (!isDateOnly(orderDate)) return null;
  return {
    order_date: orderDate,
    mode: group?.mode === 'B' ? 'B' : 'A',
    deadline: text(group?.deadline) || null,
    is_expired: Boolean(group?.is_expired)
  };
};

export const normalizeVendor = (raw) => {
  const id = text(raw?.id || raw?.vendor_id);
  const name = normalizeVendorName(raw?.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: text(raw?.description),
    phone: text(raw?.phone),
    address: text(raw?.address),
    website_url: text(raw?.website_url),
    menu_source_url: text(raw?.menu_source_url),
    menu_image_url: text(raw?.menu_image_url),
    menu_updated_at: isDateOnly(text(raw?.menu_updated_at))
      ? text(raw.menu_updated_at)
      : null,
    enabled: raw?.enabled === true || Number(raw?.enabled) === 1,
    is_open_for_ordering: Boolean(raw?.is_open_for_ordering),
    recent_groups: Array.isArray(raw?.recent_groups)
      ? raw.recent_groups.map(normalizeGroup).filter(Boolean)
      : []
  };
};

export const normalizeVendorList = (raw) => {
  const values = Array.isArray(raw) ? raw : raw?.vendors;
  if (!Array.isArray(values)) return [];
  const byName = new Map();
  values.forEach((value) => {
    const vendor = normalizeVendor(value);
    if (vendor && !byName.has(vendor.name)) byName.set(vendor.name, vendor);
  });
  return [...byName.values()];
};

export const formatVendorDate = (value) => {
  const normalized = text(value);
  if (!isDateOnly(normalized)) return '';
  return normalized.replaceAll('-', '/');
};

export const isHttpUrl = (value) => {
  const normalized = text(value);
  if (!normalized) return true;
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};
