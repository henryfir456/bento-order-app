// People read dish names, not variant codes: BASE is the plain dish, and the
// other variants get their Chinese label unless the name already says it.
const VARIANT_LABELS = { BASE: '', HALF: '半飯', PLUS: '加量' };

export const dishLabel = ({ name, variantKey } = {}) => {
  const rawName = String(name || '');
  // A bracketed 半飯 is rewritten in the standard full-width form below.
  const dishName = rawName.replace(/\s*[（(]\s*半飯\s*[）)]/gu, '');
  const key = String(variantKey || '').trim();
  const label = Object.hasOwn(VARIANT_LABELS, key.toUpperCase()) ? VARIANT_LABELS[key.toUpperCase()] : key;
  return label && !dishName.includes(label) ? `${dishName}（${label}）` : dishName;
};
