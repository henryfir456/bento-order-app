export const isVendorEnabled = (vendor) => (
  vendor?.enabled === true || vendor?.enabled === 1 || vendor?.enabled === '1'
);

export const canRecordVendorTransfer = (role, vendor) => (
  role === 'Admin' && isVendorEnabled(vendor)
);

// Admin may preview the Vendor's own layout for a selected vendor. The preview
// only changes what is rendered: data still comes from the Admin read API,
// Admin controls are hidden, and Vendor-only actions stay disabled so an Admin
// can never acknowledge or dispute a transfer on the vendor's behalf.
export const vendorOperationsView = (role, vendorPreview = false) => {
  const isVendor = role === 'Vendor';
  const previewing = role === 'Admin' && vendorPreview === true;
  return {
    previewing,
    vendorLayout: isVendor || previewing,
    adminControls: role === 'Admin' && !previewing,
    vendorActionsEnabled: isVendor
  };
};
