const firstSelectionValue = (item) => (
  [item?.selection_key, item?.menu_item_id, item?.item_id]
    .find((value) => value !== null && value !== undefined && String(value).trim() !== '')
);

export const getWorkerSelectionKey = (item) => {
  const value = firstSelectionValue(item);
  return value === undefined ? '' : String(value);
};

export const normalizeWorkerOrderMenu = (items) => (
  (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    item_id: getWorkerSelectionKey(item)
  }))
);
