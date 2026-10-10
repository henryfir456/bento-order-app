import { badRequest } from '../http/errors.js';
import { isDateOnly } from './deadlines.js';

export const boundedText = (value, max = 200) => {
  // Reject control characters in identifiers and manually approved supplier text.
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) throw badRequest('VENDOR_ORDER_INPUT_INVALID');
  return value.trim();
};
export const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) throw badRequest('VENDOR_ORDER_AMOUNT_INVALID');
  return value;
};
export const dateOnly = value => {
  if (!isDateOnly(value)) throw badRequest('VENDOR_ORDER_DATE_INVALID');
  return value;
};
const time = value => {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw badRequest('VENDOR_ORDER_TIME_INVALID');
  return value;
};
export const stringList = (value,max=30) => {
  if (!Array.isArray(value) || value.length > max) throw badRequest('VENDOR_ORDER_LIST_INVALID');
  return [...new Set(value.map(x=>boundedText(x)))].sort();
};
export const validatePolicy = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('VENDOR_ORDER_POLICY_INVALID');
  if (!['A','B'].includes(value.internalMode) || value.paymentResponsibility !== 'ORGANIZER_SETTLES_VENDOR') throw badRequest('VENDOR_ORDER_POLICY_INVALID');
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.some(x=>!Number.isInteger(x)||x<0||x>6)) throw badRequest('VENDOR_ORDER_WEEKDAYS_INVALID');
  const result={
    enabled:value.enabled===true,onlineOrderingConfirmed:value.onlineOrderingConfirmed===true,addressConfirmed:value.addressConfirmed===true,
    address:boundedText(value.address,500),floors:stringList(value.floors),serviceDates:stringList(value.serviceDates,366).map(dateOnly),
    weekdays:[...new Set(value.weekdays)].sort(),closedDates:stringList(value.closedDates,366).map(dateOnly),
    internalMode:value.internalMode,internalCutoff:time(value.internalCutoff || (value.internalMode==='A'?'10:00':'18:00')),
    externalCutoff:time(value.externalCutoff||'10:30'),deliveryStart:time(value.deliveryStart||'11:00'),deliveryEnd:time(value.deliveryEnd||'13:00'),
    minimumAmount:integer(value.minimumAmount),freeShippingThreshold:integer(value.freeShippingThreshold),shippingFee:integer(value.shippingFee),
    paymentResponsibility:value.paymentResponsibility,supplierNote:value.supplierNote ? boundedText(value.supplierNote,500):''
  };
  if (!result.floors.length || result.deliveryStart >= result.deliveryEnd || result.externalCutoff > result.deliveryStart) throw badRequest('VENDOR_ORDER_POLICY_INVALID');
  return result;
};
export const policyWindow = (policy,date) => {
  const day= new Date(date+'T00:00:00+08:00');
  if (policy.internalMode==='B') day.setUTCDate(day.getUTCDate()-1);
  const localDate=new Date(day.getTime()+8*3600000).toISOString().slice(0,10);
  return {
    internalClose:new Date(localDate+'T'+policy.internalCutoff+':00+08:00').toISOString(),
    externalClose:new Date(date+'T'+policy.externalCutoff+':00+08:00').toISOString()
  };
};
export const policyWarnings = (policy,date,floors,amount,now) => {
  const warnings=[];
  if (!policy.enabled || !policy.onlineOrderingConfirmed) warnings.push('BRANCH_UNCONFIRMED');
  if (!policy.addressConfirmed || floors.some(f=>!policy.floors.includes(f))) warnings.push('ADDRESS_UNSUPPORTED');
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  if (!policy.serviceDates.includes(date) || !policy.weekdays.includes(weekday) || policy.closedDates.includes(date)) warnings.push('SERVICE_UNAVAILABLE');
  if (amount < policy.minimumAmount) warnings.push('MINIMUM_NOT_MET');
  const window=policyWindow(policy,date);
  if (now.getTime() < Date.parse(window.internalClose)) warnings.push('COLLECTION_OPEN');
  if (now.getTime() >= Date.parse(window.externalClose)) warnings.push('EXTERNAL_CUTOFF_PASSED');
  return warnings;
};
