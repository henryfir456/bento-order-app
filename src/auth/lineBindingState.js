// Binding is canonical member state, independent of the current login channel.
export const getLineBindingState = (user) => {
  if (typeof user?.lineBound === 'boolean') return user.lineBound ? 'BOUND' : 'UNBOUND';
  // Compatibility with older Worker projections: only an explicit canonical
  // member field is evidence. Auth mode, source and registration are not.
  if (user && Object.hasOwn(user, 'lineUserId') && user.lineUserId !== undefined) {
    return String(user.lineUserId || '').trim() ? 'BOUND' : 'UNBOUND';
  }
  return 'UNKNOWN';
};

export const getLineBindingBadge = (user) => {
  const value = getLineBindingState(user);
  return {
    key: 'lineBinding', value,
    label: value === 'BOUND' ? '已綁定 LINE' : value === 'UNBOUND' ? '未綁定 LINE' : 'LINE 綁定待確認',
    tone: value === 'BOUND' ? 'line' : value === 'UNBOUND' ? 'bind' : 'unknown'
  };
};

export const canOfferLineBinding = ({ user, registered, transport, authMode, isViewAsMode }) => (
  registered && transport === 'worker' && authMode === 'employee_guest'
  && !isViewAsMode && getLineBindingState(user) === 'UNBOUND'
);
