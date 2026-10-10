import { forbidden } from '../http/errors.js';
import { prepareVendorBatch,reviewVendorBatch,handoffVendorBatch,getVendorBatch,reportVendorBatch } from './vendorOrders.js';

// This interface performs internal bookkeeping only. MANUAL.submit reserves
// a handoff; it never creates an external order or charges a payment.
export const MANUAL = Object.freeze({
  enabled:true,prepare:prepareVendorBatch,validate:reviewVendorBatch,
  submit:handoffVendorBatch,status:getVendorBatch,reconcile:reportVendorBatch
});
const disabled=()=>{throw forbidden('VENDOR_ORDER_ADAPTER_DISABLED');};
// No credential, URL, environment toggle or fetch implementation can enable
// this stub. A future reviewed implementation requires written authorization.
export const MAIFOOD_OFFICIAL_API=Object.freeze({
  enabled:false,prepare:disabled,validate:disabled,submit:disabled,status:disabled,reconcile:disabled
});
