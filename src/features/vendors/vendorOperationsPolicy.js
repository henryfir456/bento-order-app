export const isVendorEnabled = (vendor) => (
  vendor?.enabled === true || vendor?.enabled === 1 || vendor?.enabled === '1'
);

export const canRecordVendorTransfer = (role, vendor) => (
  role === 'Admin' && isVendorEnabled(vendor)
);
