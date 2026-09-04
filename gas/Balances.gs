function getUserCurrentBalance(userId) {
  const user = getRegisteredUser(userId);
  return user ? user.balance : null;
}

function applyBalanceChange(userId, amount, ledgerMeta) {
  const user = getRegisteredUser(userId);
  if (!user) throw new Error(UNREGISTERED_USER_MESSAGE);

  const numericAmount = Number(amount);
  if (!isFinite(numericAmount)) throw new Error("餘額異動金額不正確");

  const previousBalance = user.balance;
  const newBalance = previousBalance + numericAmount;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  userSheet.getRange(user.rowIndex, 4).setValue(newBalance);
  appendBalanceLedger(user, numericAmount, newBalance, ledgerMeta);
  return newBalance;
}

function ensureTopupHistorySchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!historySheet) {
    historySheet = ss.insertSheet(BALANCE_LEDGER_SHEET);
    historySheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "LINE_UserID", "姓名", "樓層", "異動金額", "結餘", "備註"
    ]]);
  } else if (!historySheet.getRange(1, 1).getValue()) {
    historySheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "LINE_UserID", "姓名", "樓層", "異動金額", "結餘", "備註"
    ]]);
  }

  const headers = ["TransactionID", "Type", "ReferenceID", "OperatorUserID", "OperatorName"];
  const headerValues = historySheet.getRange(1, 8, 1, 5).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (!headerValues[i]) historySheet.getRange(1, 8 + i).setValue(headers[i]);
  }

  const lastRow = historySheet.getLastRow();
  if (lastRow > 1) {
    const metadataRange = historySheet.getRange(2, 8, lastRow - 1, 5);
    const metadata = metadataRange.getValues();
    const notes = historySheet.getRange(2, 7, lastRow - 1, 1).getValues();
    let changed = false;

    for (let i = 0; i < metadata.length; i++) {
      if (!metadata[i][0]) {
        metadata[i][0] = 'TXN-LEGACY-' + Utilities.getUuid();
        changed = true;
      }
      if (!metadata[i][1]) {
        metadata[i][1] = inferLegacyLedgerType(notes[i][0]);
        changed = true;
      }
      if (!metadata[i][3]) {
        metadata[i][3] = 'LEGACY';
        changed = true;
      }
      if (!metadata[i][4]) {
        metadata[i][4] = 'LEGACY';
        changed = true;
      }
    }

    if (changed) metadataRange.setValues(metadata);
  }

  return historySheet;
}

function inferLegacyLedgerType(note) {
  const text = String(note || '').trim();
  if (text.indexOf('Admin 手動儲值') === 0) return 'TOPUP';
  if (text.indexOf('訂餐扣款') === 0) return 'ORDER';
  if (text.indexOf('取消訂單退款') === 0) return 'REFUND';
  return '';
}

function appendBalanceLedger(user, amount, newBalance, ledgerMeta) {
  const validTypes = ['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT'];
  if (validTypes.indexOf(ledgerMeta.type) < 0) throw new Error("Ledger Type 不正確");

  const historySheet = ensureTopupHistorySchema();
  const nowStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  historySheet.appendRow([
    nowStr,
    user.userId,
    user.name,
    ledgerMeta.floor || user.defaultFloor,
    amount,
    newBalance,
    ledgerMeta.note || '',
    'TXN-' + Utilities.getUuid(),
    ledgerMeta.type,
    ledgerMeta.referenceId || '',
    ledgerMeta.operatorUserId || '',
    ledgerMeta.operatorName || ''
  ]);
}

function getBalanceHistory(userId) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!historySheet) return { success: true, history: [] };

  const values = historySheet.getDataRange().getValues().slice(1);
  const userHistory = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const r = values[i];
    if (String(r[1] || '').trim() === user.userId) {
      userHistory.push({
        timestamp: Utilities.formatDate(new Date(r[0]), TIMEZONE, "yyyy-MM-dd HH:mm"),
        changeAmount: Number(r[4]),
        balance: Number(r[5]),
        note: r[6] || "",
        transactionId: r[7] || "",
        type: r[8] || "",
        referenceId: r[9] || ""
      });
    }
  }

  return { success: true, history: userHistory };
}

function getBalanceHistoryByMonth(userId, year, month) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (!isValidYearMonth(year, month)) {
    return { success: false, message: "查詢月份不正確" };
  }

  const yearValue = Number(year);
  const monthValue = Number(month);
  const monthKey = yearValue + '-' + String(monthValue).padStart(2, '0');
  const historySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BALANCE_LEDGER_SHEET);
  const values = historySheet ? historySheet.getDataRange().getValues().slice(1) : [];
  const userRows = [];
  let hasUserLedgerRows = false;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[1] || '').trim() !== user.userId) continue;
    hasUserLedgerRows = true;

    const timestampKey = ledgerTimestampKey(row[0]);
    const hasAmount = hasNumericValue(row[4]);
    const hasBalance = hasNumericValue(row[5]);
    if (!timestampKey || (!hasAmount && !hasBalance)) continue;

    userRows.push({
      rowIndex: i,
      timestampKey: timestampKey,
      amount: hasAmount ? Number(row[4]) : null,
      balanceAfter: hasBalance ? Number(row[5]) : null,
      row: row
    });
  }

  userRows.sort((a, b) => a.timestampKey.localeCompare(b.timestampKey) || a.rowIndex - b.rowIndex);
  const monthRows = userRows.filter(item => item.amount !== null && item.timestampKey.substring(0, 7) === monthKey);
  const priorRows = userRows.filter(item => item.timestampKey.substring(0, 7) < monthKey);
  const priorWithBalance = priorRows.filter(item => item.balanceAfter !== null);
  const monthStartBalance = priorWithBalance.length > 0
    ? priorWithBalance[priorWithBalance.length - 1].balanceAfter
    : null;

  let openingBalance = monthStartBalance;
  if (openingBalance === null && monthRows.length > 0 && monthRows[0].balanceAfter !== null) {
    openingBalance = monthRows[0].balanceAfter - monthRows[0].amount;
  }
  if (openingBalance === null && !hasUserLedgerRows) {
    openingBalance = user.balance;
  }
  if (openingBalance === null) {
    return { success: false, message: "目前無法重建此月份的餘額明細" };
  }

  let totalCredit = 0;
  let totalDebit = 0;
  monthRows.forEach(item => {
    if (item.amount >= 0) {
      totalCredit += item.amount;
    } else {
      totalDebit += Math.abs(item.amount);
    }
  });

  const lastMonthRow = monthRows[monthRows.length - 1];
  const closingBalance = lastMonthRow && lastMonthRow.balanceAfter !== null
    ? lastMonthRow.balanceAfter
    : openingBalance + totalCredit - totalDebit;

  const transactions = monthRows.slice().reverse().map(item => {
    const row = item.row;
    const occurredAt = item.timestampKey.substring(0, 16);
    return {
      id: row[7] || '',
      transactionId: row[7] || '',
      type: row[8] || '',
      referenceId: row[9] || '',
      description: row[6] || '',
      note: row[6] || '',
      occurredAt: occurredAt,
      timestamp: occurredAt,
      amount: item.amount,
      changeAmount: item.amount,
      balanceAfter: item.balanceAfter,
      balance: item.balanceAfter
    };
  });

  return {
    success: true,
    ok: true,
    year: yearValue,
    month: monthValue,
    openingBalance: openingBalance,
    totalCredit: totalCredit,
    totalDebit: totalDebit,
    closingBalance: closingBalance,
    transactions: transactions
  };
}

function auditBalanceConsistency() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  const historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!userSheet) return { success: false, message: "尚未建立 Users 資料" };

  const userRows = userSheet.getDataRange().getValues().slice(1);
  const ledgerRows = historySheet ? historySheet.getDataRange().getValues().slice(1) : [];
  const latestLedgerByUser = {};

  ledgerRows.forEach(row => {
    const userId = String(row[1] || '').trim();
    const ledgerBalance = Number(row[5]);
    if (userId && isFinite(ledgerBalance)) {
      latestLedgerByUser[userId] = ledgerBalance;
    }
  });

  const results = userRows.map(row => {
    const userId = String(row[0] || '').trim();
    const usersBalance = Number(row[3] || 0);
    const hasLedgerBalance = Object.prototype.hasOwnProperty.call(latestLedgerByUser, userId);
    const latestLedgerBalance = hasLedgerBalance ? latestLedgerByUser[userId] : null;
    const difference = hasLedgerBalance ? usersBalance - latestLedgerBalance : null;
    return {
      lineUserId: userId,
      name: row[1] || '',
      usersBalance: usersBalance,
      latestLedgerBalance: latestLedgerBalance,
      difference: difference,
      isConsistent: hasLedgerBalance && difference === 0
    };
  });

  return {
    success: true,
    allConsistent: results.every(result => result.isConsistent),
    results: results
  };
}

function getMemberBalances(requestUserId) {
  const requester = getRegisteredUser(requestUserId);
  if (!requester) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (!hasPermission(requester.role, 'viewMemberBalances')) {
    return { success: false, message: "權限不足：目前角色無法查看成員餘額" };
  }

  const userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!userSheet) return { success: false, message: "尚未建立 Users 資料" };

  return {
    success: true,
    requesterRole: requester.role,
    members: getAllUserSummaries(userSheet)
  };
}

function topUpBalance(adminUserId, targetUserId, amount, note) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const operator = getRegisteredUser(adminUserId);
    if (!operator) return { success: false, message: UNREGISTERED_USER_MESSAGE };
    if (!hasPermission(operator.role, 'topupMember')) {
      return { success: false, message: "權限不足：目前角色無法進行人工儲值" };
    }

    const targetUser = getRegisteredUser(targetUserId);
    if (!targetUser) return { success: false, message: UNREGISTERED_USER_MESSAGE };

    const amountText = String(amount === undefined || amount === null ? '' : amount).trim();
    const topUpVal = Number(amountText);
    if (!amountText || !isFinite(topUpVal) || topUpVal <= 0) {
      return { success: false, message: "儲值金額必須大於 0" };
    }

    const newBalance = applyBalanceChange(targetUser.userId, topUpVal, {
      type: 'TOPUP',
      referenceId: '',
      operatorUserId: operator.userId,
      operatorName: operator.name,
      note: String(note || '').trim() || "Admin 手動儲值"
    });

    return {
      success: true,
      message: "儲值成功！",
      newBalance: newBalance,
      targetUserId: targetUser.userId
    };
  } catch (err) {
    return { success: false, message: "儲值失敗：" + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

