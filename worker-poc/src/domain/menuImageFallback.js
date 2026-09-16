import { normalizeMenuVendor } from './menuVendors.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeHistoricalImageName = (value) => text(value)
  .normalize('NFKC')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLowerCase();

export const HISTORICAL_IMAGE_MAPPING = Object.freeze({
  'E.風味餐': '風味餐',
  'A.風味便當': '風味便當',
  '風味會議便當': '風味會議',
  'S.小而美便當': '小而美',
  'C.每日特餐': '特餐',
  '會議便當': '會議',
  '蕃茄鷹豆泥': '番茄鷹豆泥',
  '紅麴腐乳板豆腐': '紅麴豆腐',
  '醬燒板豆腐': '醬燒板豆腐',
  '蒜香辣泡菜': '蒜香辣泡菜'
});

export const HISTORICAL_IMAGE_SKIP_NAMES = Object.freeze([
  'B.水煮低醣健康餐',
  '免費加飯',
  '手續費減免',
  '1元'
]);

const historicalImageMappingByName = new Map(
  Object.entries(HISTORICAL_IMAGE_MAPPING).map(([sourceName, targetName]) => [
    normalizeHistoricalImageName(sourceName),
    normalizeHistoricalImageName(targetName)
  ])
);

const historicalImageSkipNames = new Set(
  HISTORICAL_IMAGE_SKIP_NAMES.map(normalizeHistoricalImageName)
);

const currentItemName = (row) => row?.item_name ?? row?.itemName;
const currentImageUrl = (row) => row?.image_url ?? row?.imageUrl;
const historicalImageUrl = (row) => row?.image_url ?? row?.imageUrl;
const imageIndexKey = (vendor, name) => `${normalizeMenuVendor(vendor)}\u0000${name}`;

export const buildHistoricalImageFallbackIndex = (currentRows = []) => {
  const index = new Map();
  for (const row of currentRows) {
    if (row?.enabled === false || row?.enabled === 0) continue;
    const normalizedName = normalizeHistoricalImageName(currentItemName(row));
    if (!normalizedName) continue;
    const key = imageIndexKey(row?.vendor, normalizedName);
    const entry = index.get(key) || {
      rowCount: 0,
      imageUrls: new Set()
    };
    entry.rowCount += 1;
    const imageUrl = text(currentImageUrl(row));
    if (imageUrl) entry.imageUrls.add(imageUrl);
    index.set(key, entry);
  }
  return index;
};

const currentImageForTarget = (vendor, targetName, currentImageIndex) => {
  const entry = currentImageIndex.get(imageIndexKey(vendor, targetName));
  if (!entry || entry.rowCount !== 1 || entry.imageUrls.size !== 1) return '';
  return [...entry.imageUrls][0];
};

export const resolveHistoricalImageDisplayUrl = (historicalRow, currentImageIndex = new Map()) => {
  const explicitImage = text(historicalImageUrl(historicalRow));
  if (explicitImage) return explicitImage;

  const normalizedName = normalizeHistoricalImageName(historicalRow?.item_name ?? historicalRow?.itemName);
  if (!normalizedName || historicalImageSkipNames.has(normalizedName)) return '';
  const targetName = historicalImageMappingByName.get(normalizedName);
  if (!targetName) return '';
  return currentImageForTarget(historicalRow?.vendor, targetName, currentImageIndex);
};
