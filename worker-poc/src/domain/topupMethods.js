import { badRequest } from '../http/errors.js';

export const TOPUP_METHOD_VALUES = Object.freeze([
  'TAIWAN_PAY',
  'LINE_PAY_MONEY',
  'BANK_TRANSFER',
  'CASH',
  'IPASS_MONEY'
]);

const TOPUP_METHOD_SET = new Set(TOPUP_METHOD_VALUES);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export const isAllowedTopupMethod = (value) => TOPUP_METHOD_SET.has(text(value));

export const requireTopupMethod = (value) => {
  const method = text(value);
  if (!method) throw badRequest('TOP_UP_METHOD_REQUIRED');
  if (!isAllowedTopupMethod(method)) throw badRequest('TOP_UP_METHOD_INVALID');
  return method;
};
