import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;

export const CHANGELOG = [
  {
    version: '0.9.0',
    date: '2026-09-09',
    changes: [
      '改善頁首資訊與功能操作區的分層配置',
      '送出訂單前新增訂單內容確認流程',
      'ProxyAdmin 新增開團設定權限',
      '月曆管理更名為開團'
    ],
    commits: []
  },
  {
    version: '0.8.0',
    date: '2026-09-09',
    changes: [
      '後端由 Google Apps Script 遷移至 Cloudflare Workers，正式資料遷移至 Cloudflare D1，GAS 保留作回滾傳輸',
      '啟用 Worker bootstrap、訂單、開團、餘額與管理 API，完成 Admin View As 讀取傳遞，Worker 模式不再靜默回退至 GAS',
      '新增正式環境替換匯入與驗證流程，完成生產 workbook 匯入與 reconciliation，保留 opening-balance policy 與 quarantine 語意，未捏造歷史 ledger',
      'Bearer 身份由伺服器驗證、View As 授權由伺服器控管，正式 CORS 限制為 production Netlify origin'
    ],
    commits: ['3305217', '195a619', '4821970', '7317dc5', 'd145f16', '691cc59', 'de5f152', '2641c6d', '7fc7bee', '03f54c4']
  },
  {
    version: '0.7.1',
    date: '2026-09-04',
    changes: [
      '修正月份起始於週末時的月曆空白列',
      '優化頁尾資訊與作者標示',
      '公告詳情新增公告日期'
    ],
    commits: []
  },
  {
    version: '0.7.0',
    date: '2026-09-04',
    changes: [
      '新增首頁公告與公告詳情',
      '支援同時查看多則有效公告',
      '修正切換月份時月曆寬度不一致',
      '統一已截止日期視覺狀態'
    ],
    commits: []
  },
  {
    version: '0.6.0',
    date: '2026-09-04',
    changes: [
      '預設領取樓層改為可點擊設定',
      'ProxyAdmin 移除餘額管理權限',
      '新增版本號與開發歷程',
      '放大餐點圖片並支援圖片預覽'
    ],
    commits: []
  },
  {
    version: '0.5.0',
    date: '2026-09-03',
    changes: [
      '建立集中式角色與權限模型',
      '新增 Admin 的 View As 預覽功能',
      '強化不同角色的操作隔離',
      'View As 模式禁止代替其他使用者執行寫入操作'
    ],
    commits: ['8f4d148']
  },
  {
    version: '0.4.1',
    date: '2026-09-03',
    changes: [
      '優化訂餐畫面更新體驗與訂單視覺提示',
      '補強網站分享 metadata 與 OG 預覽圖片'
    ],
    commits: ['fbfdfb0', '1efe300']
  },
  {
    version: '0.4.0',
    date: '2026-09-03',
    changes: [
      '交易明細支援依年份與月份查詢',
      '增加月初餘額、月底餘額與當月收支統計'
    ],
    commits: ['e669e04']
  },
  {
    version: '0.3.0',
    date: '2026-09-03',
    changes: [
      '增加 LINE 身份驗證與註冊狀態管理',
      '強化未註冊、登入失敗與驗證異常處理',
      '限制訂餐及資料操作必須通過身份驗證'
    ],
    commits: ['fefde43']
  },
  {
    version: '0.2.1',
    date: '2026-09-03',
    changes: [
      '餐點支援圖片與菜單變體顯示',
      '月曆排除週末，並支援特殊日期開團',
      '增加訂購人資訊與餘額操作入口'
    ],
    commits: ['7be031b', 'd9cee3d']
  },
  {
    version: '0.1.0',
    date: '2026-09-02',
    changes: [
      '建立蔬食便當訂購核心流程',
      '提供月曆、開團日期與菜單瀏覽',
      '支援訂餐、取消訂單與基本管理資訊'
    ],
    commits: ['fc3d963']
  }
];
