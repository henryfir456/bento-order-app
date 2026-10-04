import { persistCalendarSetting } from './calendar.js';
import { scheduledBusinessDates } from './businessDays.js';
import { CANONICAL_HE_SHI_VENDOR } from './menuVendors.js';
import { loadNonWorkingDates } from './taiwanHolidays.js';
import { getTaipeiDate } from './deadlines.js';
import { resolveClock } from '../db/transactions.js';

const addDays = (dateOnly, days) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const runAutomaticDailyOpening = async (database, scheduledTime) => {
  const businessDate = getTaipeiDate(resolveClock(scheduledTime));
  const nonWorkingDates = await loadNonWorkingDates(
    database,
    businessDate,
    addDays(businessDate, 31)
  );
  const { targetDate } = scheduledBusinessDates(scheduledTime, nonWorkingDates);
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
