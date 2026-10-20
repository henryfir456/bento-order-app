const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const getActiveVendorIdsForPrincipal = async (database, userId) => {
  const result = await database.prepare(`
    SELECT vm.vendor_id
    FROM vendor_principals vp
    JOIN vendor_memberships vm ON vm.user_id = vp.user_id
    JOIN vendors v ON v.vendor_id = vm.vendor_id
    WHERE vp.user_id = ?
      AND vp.principal_role = 'Vendor'
      AND vp.status = 'ACTIVE'
      AND vm.status = 'ACTIVE'
      AND v.enabled = 1
    ORDER BY vm.vendor_id ASC
  `).bind(userId).all();
  return rowsFrom(result).map((row) => String(row.vendor_id));
};
