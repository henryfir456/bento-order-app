const NORMALIZED_MENU_START_DATE = '2026-09-17';
const NORMALIZED_VARIANT_KEYS = ['BASE', 'HALF', 'PLUS'];

export const normalizedIdentityForRow = (row) => {
  const code = String(row?.item_code || '').trim();
  const codeKey = code.toUpperCase();
  const name = String(row?.item_name || '').trim();
  const variantKey = String(row?.variant_key || '').trim().toUpperCase();

  // Schema 2 codes are already canonical. Legacy aliases must never
  // reinterpret an established normalized identity (for example H1/HALF).
  if (row?.identity_schema_version === 2 && NORMALIZED_VARIANT_KEYS.includes(variantKey)) {
    return [code, variantKey];
  }

  if (['FR1', 'REVERT1'].includes(codeKey)) return null;
  const direct = {
    S: ['S', 'BASE'], SH: ['S', 'HALF'], S_HALF: ['S', 'HALF'],
    C: ['C', 'BASE'], CH: ['C', 'HALF'], C95: ['C', 'BASE'], C95_HALF: ['C', 'HALF'],
    CP: ['CM', 'BASE'], CPH: ['CM', 'HALF'], C120: ['CM', 'BASE'], C120_HALF: ['CM', 'HALF'],
    E: ['E', 'BASE'], EP: ['E', 'PLUS'], E_PLUS: ['E', 'PLUS'],
    A: ['A', 'BASE'], A95: ['A', 'BASE'], A95_PLUS: ['A', 'PLUS'],
    A120: ['AM', 'BASE'], A120_PLUS: ['AM', 'PLUS'], APP: ['AM', 'PLUS'],
    B: ['B', 'BASE'], B_HALF: ['B', 'HALF'], FR: ['FR', 'BASE'], R: ['FR', 'BASE']
  };
  if (codeKey === 'AP') {
    if (name.includes('風味便當')) return ['A', 'PLUS'];
    if (name.includes('風味會議')) return ['AM', 'BASE'];
    return null;
  }
  if (/^H[1-5]H$/.test(codeKey)) return [codeKey.slice(0, -1), 'HALF'];
  if (/^H[1-5]$/.test(codeKey)) return [codeKey, 'BASE'];
  return direct[codeKey] || (NORMALIZED_VARIANT_KEYS.includes(variantKey)
    ? [code, variantKey]
    : [code, 'BASE']);
};

/**
 * @typedef {Object} MenuChangeRow
 * @property {string} [item_code]
 * @property {string} [variant_key]
 * @property {number} [identity_schema_version]
 * @property {string} [item_name]
 * @property {string} [effective_date]
 * @property {string} [vendor]
 * @property {number|string} [price]
 * @property {boolean|number} [enabled]
 * @property {string} [image_url]
 * @property {string} [note]
 * @property {number} [display_order]
 */

/**
 * @param {MenuChangeRow|null} row
 * @param {{currentDate?: string, selectedCurrentVendor?: string}} [context]
 * @returns {Record<string, any>}
 */
export const buildMenuChangeDraft = (row, { currentDate = '', selectedCurrentVendor = '' } = {}) => {
  const mappedIdentity = row ? normalizedIdentityForRow(row) : null;
  const useNormalizedIdentity = !row || row.identity_schema_version === 2 || Boolean(mappedIdentity);
  const mappedDate = row && row.effective_date >= NORMALIZED_MENU_START_DATE
    ? row.effective_date
    : NORMALIZED_MENU_START_DATE;
  return {
    effective_date: row ? mappedDate : (currentDate >= NORMALIZED_MENU_START_DATE ? currentDate : NORMALIZED_MENU_START_DATE),
    vendor: row?.vendor || selectedCurrentVendor || '',
    item_code: useNormalizedIdentity ? (mappedIdentity?.[0] || row?.item_code || '') : (row?.item_code || ''),
    item_code_locked: Boolean(row),
    variant_key: useNormalizedIdentity ? (mappedIdentity?.[1] || 'BASE') : (row?.variant_key || ''),
    item_name: row?.item_name || '',
    price: row?.price ?? '',
    enabled: row ? Boolean(row.enabled) : true,
    image_url: row?.image_url || '',
    note: row?.note || '',
    display_order: row?.display_order || 0,
    identity_schema_version: useNormalizedIdentity ? 2 : 1,
    previous_variant_key: row?.identity_schema_version === 2 ? row.variant_key || '' : '',
    previous_identity_schema_version: row?.identity_schema_version === 2 ? 2 : null
  };
};
