export const HISTORICAL_SQL_VENDOR = '蔡老師';
export const CANONICAL_HE_SHI_VENDOR = '禾拾';
export const LEGACY_HE_SHI_VENDOR = '合十';
export const CANONICAL_MENU_VENDORS = Object.freeze([
  HISTORICAL_SQL_VENDOR,
  CANONICAL_HE_SHI_VENDOR
]);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeMenuVendor = (value) => {
  const normalized = text(value);
  return normalized === LEGACY_HE_SHI_VENDOR ? CANONICAL_HE_SHI_VENDOR : normalized;
};

export const isHistoricalMenuVendor = (value) => {
  const normalized = normalizeMenuVendor(value);
  return normalized === HISTORICAL_SQL_VENDOR || normalized === CANONICAL_HE_SHI_VENDOR;
};

export const historicalMenuRowVendorCandidates = (value) => {
  const normalized = normalizeMenuVendor(value);
  if (normalized === CANONICAL_HE_SHI_VENDOR) {
    return [CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR];
  }
  return [normalized];
};

export const compatibilityVendorCandidates = (value) => {
  const normalized = normalizeMenuVendor(value);
  return normalized === CANONICAL_HE_SHI_VENDOR
    ? [CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR]
    : [normalized];
};

export const canonicalMenuRowVendor = ({ vendor } = {}) => normalizeMenuVendor(vendor);

export const normalizeMenuItemName = (value) => text(value)
  .normalize('NFKC')
  .replace(/\s+/gu, ' ');
