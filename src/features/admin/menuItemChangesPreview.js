const keyPart = (value) => String(value ?? '');

export const currentMenuRowKey = (row, fallbackVendor = '', fallbackDate = '') => (
  row?.menu_item_change_id
  || row?.menu_item_id
  || [
    row?.vendor || fallbackVendor,
    row?.item_code,
    row?.variant_key || '',
    row?.effective_date || fallbackDate
  ].map(keyPart).join(':')
);

export const shouldApplyPreviewResult = ({
  requestId,
  latestRequestId,
  requestVendor,
  requestDate,
  result
}) => (
  requestId === latestRequestId
  && result?.vendor === requestVendor
  && result?.targetDate === requestDate
);
