export const CAI_TEACHER_VENDOR = '蔡老師';

const DAILY_FLAVOR_ITEM_LABELS = Object.freeze({
  E: '風味餐',
  A: '風味便當',
  AM: '風味會議便當'
});

const normalizedFlavorCode = (item) => String(item?.legacy_item_id || '').trim().toUpperCase();

export const isDailyFlavorMenuItem = (item) => (
  Object.hasOwn(DAILY_FLAVOR_ITEM_LABELS, normalizedFlavorCode(item))
);

export const getCalendarDailyFlavorImage = (event, dateStr) => {
  if (
    !event
    || event.order_date !== dateStr
    || String(event.vendor || '').trim() !== CAI_TEACHER_VENDOR
    || !String(event.dailyFlavorName || '').trim()
  ) return '';
  return String(event.dailyFlavorImageUrl || '').trim();
};

export const buildDailyFlavorCardModel = ({
  vendor,
  targetDate,
  dailyFlavor,
  menu
} = {}) => {
  if (
    String(vendor || '').trim() !== CAI_TEACHER_VENDOR
    || !targetDate
    || dailyFlavor?.service_date !== targetDate
    || !Array.isArray(menu)
  ) return null;

  const items = menu
    .filter(isDailyFlavorMenuItem)
    .map((item) => {
      const label = DAILY_FLAVOR_ITEM_LABELS[normalizedFlavorCode(item)];
      const variant = String(item.variant_key || '').trim().toUpperCase();
      return {
        ...item,
        dailyFlavorLabel: variant === 'PLUS' ? `${label}（加量）` : label
      };
    });
  if (!items.length) return null;

  const name = String(dailyFlavor.name || '').trim();
  const imageUrl = String(dailyFlavor.image_url || '').trim();
  if (!name || !imageUrl) return null;

  return {
    serviceDate: dailyFlavor.service_date,
    name,
    description: String(dailyFlavor.description || '').trim(),
    imageUrl,
    items
  };
};
