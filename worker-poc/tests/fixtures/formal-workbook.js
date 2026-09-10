const source = (sheet, row, values) => ({
  ...values,
  source: { sheet, row },
  raw: { ...values }
});

export const makeFormalWorkbook = () => ({
  shapeIssues: [],
  sheets: {
    Settings: {
      headers: ['order_date', 'vendor', 'mode'],
      rows: [
        source('Settings', 2, {
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          mode: null
        })
      ]
    },
    Likes: {
      headers: ['Date', 'employee_id', 'LINE_UserID', 'Created_At'],
      rows: [
        source('Likes', 2, {
          order_date: '2026-09-08',
          employee_id: '000001',
          line_user_id: 'user-1',
          created_at: '2026-09-07T10:00:00.000Z'
        })
      ]
    },
    TopupHistory: {
      headers: [
        'Timestamp',
        'employee_id',
        'LINE_UserID',
        '姓名',
        '樓層',
        '異動金額',
        '結餘',
        '備註',
        'TransactionID',
        'Type',
        'ReferenceID',
        'OperatorUserID',
        'operator_employee_id',
        'OperatorName'
      ],
      rows: [
        source('TopupHistory', 2, {
          timestamp: '2026-09-07T09:00:00.000Z',
          employee_id: '000001',
          line_user_id: 'user-1',
          display_name: 'Synthetic User',
          pickup_floor: '1樓',
          amount: 100,
          balance_after: 100,
          note: 'Synthetic top-up',
          transaction_id: 'tx-1',
          type: 'TOPUP',
          reference_id: 'ref-1',
          operator_line_user_id: 'admin-1',
          operator_employee_id: '000002',
          operator_name: 'Synthetic Admin'
        })
      ]
    },
    Users: {
      headers: ['employee_id', 'UserID', 'DisplayName', '樓層', 'Balance', 'Role'],
      rows: [
        source('Users', 2, {
          employee_id: '000001',
          line_user_id: 'user-1',
          display_name: 'Synthetic User',
          pickup_floor: '1樓',
          balance: 100,
          role: 'User'
        }),
        source('Users', 3, {
          employee_id: '000002',
          line_user_id: 'admin-1',
          display_name: 'Synthetic Admin',
          pickup_floor: '9樓',
          balance: -20,
          role: 'Admin'
        })
      ]
    },
    Menu: {
      headers: ['date', 'vendor', 'item_id', 'item_name', 'price', 'enabled', 'note', ''],
      rows: [
        source('Menu', 2, {
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          legacy_item_id: 'legacy-duplicate',
          item_name: 'Synthetic Bento A',
          price: 80,
          enabled: true,
          note: '',
          image_url: ''
        }),
        source('Menu', 3, {
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          legacy_item_id: 'legacy-duplicate',
          item_name: 'Synthetic Bento B',
          price: 90,
          enabled: true,
          note: 'duplicate source key',
          image_url: ''
        }),
        source('Menu', 4, {
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          legacy_item_id: 'legacy-disabled',
          item_name: 'Synthetic Disabled',
          price: 100,
          enabled: false,
          note: '',
          image_url: ''
        })
      ]
    },
    Announcements: {
      headers: ['id', 'title', 'content', 'start_date', 'end_date', 'enabled'],
      rows: [
        source('Announcements', 2, {
          announcement_id: 'announcement-1',
          title: 'Synthetic announcement',
          content: 'Synthetic content',
          start_date: '2026-09-01',
          end_date: '2026-09-30',
          enabled: true
        })
      ]
    },
    Orders: {
      headers: [
        'order_id',
        'order_date',
        'vendor',
        'name',
        'pickup_floor',
        'item_id',
        'item_name',
        'quantity',
        'unit_price',
        'subtotal',
        'created_at',
        'updated_at',
        'employee_id',
        '',
        'LINE_UserID',
        'BalanceAfter',
        ''
      ],
      rows: [
        source('Orders', 2, {
          order_id: 'order-1',
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          display_name: 'Synthetic User',
          pickup_floor: '1樓',
          legacy_item_id: 'legacy-duplicate',
          item_name: 'Synthetic Bento A',
          quantity: 1,
          unit_price: 80,
          subtotal: 80,
          created_at: '2026-09-07T08:00:00.000Z',
          updated_at: '2026-09-07T08:00:00.000Z',
          status: 'ACTIVE',
          employee_id: '000001',
          line_user_id: 'user-1',
          balance_after: 20,
          note: ''
        }),
        source('Orders', 3, {
          order_id: 'order-orphan',
          order_date: '2026-09-08',
          vendor: 'Vendor A',
          display_name: 'Unknown source',
          pickup_floor: '1樓',
          legacy_item_id: 'legacy-duplicate',
          item_name: 'Synthetic Bento A',
          quantity: 1,
          unit_price: 80,
          subtotal: 80,
          created_at: '2026-09-07T08:01:00.000Z',
          updated_at: '2026-09-07T08:01:00.000Z',
          status: 'ACTIVE',
          line_user_id: null,
          balance_after: null,
          note: ''
        })
      ]
    }
  }
});
