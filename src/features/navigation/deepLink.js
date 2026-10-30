// Pages a LINE menu button or shared link may open directly (?go=<key>).
// Keys match the bottom-navigation tab keys handled by navigateBottomTab.
export const DEEP_LINK_TARGETS = Object.freeze([
  'calendar',
  'myOrders',
  'footprints',
  'wallet',
  'vendor',
  'vendorFootprints'
]);

const readGo = (search) => {
  const value = new URLSearchParams(search || '').get('go');
  return DEEP_LINK_TARGETS.includes(value) ? value : '';
};

// LIFF delivers a deep link as `?go=x` once initialized, but the first load of
// https://liff.line.me/<id>/?go=x carries it inside `liff.state`, so check both.
export const parseDeepLinkTarget = (search = '') => {
  const direct = readGo(search);
  if (direct) return direct;
  const state = new URLSearchParams(search || '').get('liff.state') || '';
  const queryStart = state.indexOf('?');
  return queryStart >= 0 ? readGo(state.slice(queryStart)) : '';
};
