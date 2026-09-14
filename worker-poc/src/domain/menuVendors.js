export const HISTORICAL_SQL_VENDOR = '蔡老師';
export const CANONICAL_HE_SHI_VENDOR = '禾拾';
export const LEGACY_HE_SHI_VENDOR = '合十';

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
  return isHistoricalMenuVendor(normalized)
    ? [HISTORICAL_SQL_VENDOR, CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR]
    : [normalized];
};

export const compatibilityVendorCandidates = (value) => {
  const normalized = normalizeMenuVendor(value);
  return normalized === CANONICAL_HE_SHI_VENDOR
    ? [CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR]
    : [normalized];
};

export const canonicalMenuRowVendor = ({ vendor, itemCode } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedItemCode = text(itemCode);
  if (isHistoricalMenuVendor(normalizedVendor) && /^H/i.test(normalizedItemCode)) {
    return CANONICAL_HE_SHI_VENDOR;
  }
  return normalizedVendor;
};

export const normalizeMenuItemName = (value) => text(value)
  .normalize('NFKC')
  .replace(/\s+/gu, ' ');
