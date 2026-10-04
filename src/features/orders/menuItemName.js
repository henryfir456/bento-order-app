export const parseMenuItemName = (itemName = '') => {
  const fullName = String(itemName).trim();
  const match = fullName.match(/^(.*?)\s*(?:\(([^()]*)\)|（([^（）]*)）)\s*$/);

  if (!match || !match[1].trim()) {
    return { baseName: fullName, variant: '' };
  }

  return {
    baseName: match[1].trim(),
    variant: (match[2] ?? match[3] ?? '').trim()
  };
};
