import { persistCalendarSetting } from './calendar.js';
import { scheduledBusinessDates } from './businessDays.js';
import { CANONICAL_HE_SHI_VENDOR } from './menuVendors.js';

export const runAutomaticDailyOpening = async (database, scheduledTime) => {
  const { businessDate, targetDate } = scheduledBusinessDates(scheduledTime);
  if (!targetDate) {
    return {
      status: 'SKIP_NON_BUSINESS_DAY',
      businessDate,
      targetDate: null
    };
  }

  const result = await persistCalendarSetting(database, {
    orderDate: targetDate,
    vendor: CANONICAL_HE_SHI_VENDOR,
    mode: 'B',
    onlyIfUnassigned: true
  }, scheduledTime);
  const vendor = result.changed
    ? CANONICAL_HE_SHI_VENDOR
    : (result.setting?.vendor || null);
  return {
    status: result.changed ? 'OPENED' : 'SKIP_ALREADY_OPEN',
    businessDate,
    targetDate,
    vendor
  };
};
