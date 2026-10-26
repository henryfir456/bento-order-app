import packageJson from '../../package.json';
import changelogMarkdown from '../../CHANGELOG.md?raw';
import { isFormalRelease, parseChangelog } from './changelogParser';

export const CHANGELOG = parseChangelog(changelogMarkdown);

// The footer is a user-visible release label. Numbered releases are sourced
// from CHANGELOG; package.json remains the fallback when no release exists.
export const APP_VERSION = CHANGELOG.find(isFormalRelease)?.version || packageJson.version;

// CHANGELOG.md is the English developer/release record. Keep user-facing
// Traditional Chinese copy here so the UI does not render the raw Markdown.
const UI_CHANGELOG_TRANSLATIONS = Object.freeze({
  '0.19.12': [
    { name: '修正', changes: [
      '修正禾拾「半飯」餐點下單後沒有記錄品項編號，導致管理者訂單總覽與廠商畫面無法辨識該品項的問題；新訂單會正確綁定半飯品項。'
    ] }
  ],
  '0.19.11': [
    { name: '修正', changes: [
      '修正 Android LINE 登入點「繼續」沒反應的問題：登入改以乾淨的返回網址發起；若 6 秒內沒有跳轉，會提示再按一次或從 LINE 重新開啟連結。'
    ] }
  ],
  '0.19.10': [
    { name: '修正', changes: [
      '管理者查看已過截止的日期時，點餐頁狀態改顯示「已截止・管理者可修改」，不再顯示「訂餐中」。'
    ] }
  ],
  '0.19.9': [
    { name: '變更', changes: [
      '點餐頁直接顯示截止時間與倒數（例如「今天 10:00 截止・剩 1 小時 20 分」），最後一小時改為紅字；樓層與備註維持同一列，樓層欄縮窄、備註放寬。'
    ] }
  ],
  '0.19.8': [
    { name: '變更', changes: [
      '各頁的載入中、錯誤與頁首改用共用元件：載入文字統一為「〇〇載入中…」，錯誤提示統一為一句說明加「重試」按鈕，錯誤碼收進「詳細資訊」。',
      '按鈕與標題上的裝飾性表情符號已移除（狀態標籤仍保留），並新增 UI 文案與按鈕規範文件供之後新增畫面使用。'
    ] }
  ],
  '0.19.7': [
    { name: '變更', changes: [
      '頁首的姓名與預設領取樓層合併成同一個可點按鈕，點開即可修改個人資料。',
      '管理中心把每日常用的「訂單總覽」「開團管理」「廠商對帳」排在最前面（原「廠商每日訂單與轉帳對帳」簡化為「廠商對帳」），所有管理子頁最上方都有「← 管理中心」返回連結。'
    ] }
  ],
  '0.19.6': [
    { name: '變更', changes: [
      '底部導覽的「足跡」改名：員工為「我的足跡」、廠商為「售出足跡」，不再兩邊同名。',
      '點餐頁數量加減鈕放大為 40px，手機更好點；空狀態文字統一為「尚無…」，我的訂單空月份會提示如何下單；錯誤區的重試按鈕統一為「重試」。',
      '刪除公告改用與其他操作一致的確認視窗（預設聚焦取消），不再使用瀏覽器內建對話框。'
    ] }
  ],
  '0.19.5': [
    { name: '修正', changes: [
      '補回廠商「訂單總覽」與「對帳」分頁的月份切換（0.19.3 移除標題卡片時一併被拿掉）。'
    ] }
  ],
  '0.19.4': [
    { name: '變更', changes: [
      '廠商的店家名稱改顯示在畫面上方、登出按鈕的左邊，所有廠商頁面都看得到目前登入的店家；工作台內原本只有店名的卡片已移除。'
    ] }
  ],
  '0.19.3': [
    { name: '變更', changes: [
      '廠商畫面移除「廠商工作台」字樣、「重新整理」按鈕與最後更新時間，標題只顯示店家名稱；切換分頁會自動重新載入。',
      '使用者管理中，廠商帳號原本員編顯示「未綁定」，改為顯示廠商代號（只有 LINE 管理員看得到）。'
    ] }
  ],
  '0.19.2': [
    { name: '變更', changes: [
      '大幅降低廠商頁面的資料庫讀取量：舊訂單的廠商歸屬改成預先算好的快取，新增或審核對照後會自動重建；月曆的訂購份數統計也只讀需要的日期範圍。'
    ] }
  ],
  '0.19.1': [
    { name: '新增', changes: [
      '每個 API 回應的 Server-Timing 會附上這次讀取的資料筆數與查詢數，讀取 5,000 筆以上的請求也會寫入日誌，用來找出耗用 D1 每日讀取額度的查詢。'
    ] }
  ],
  '0.19.0': [
    { name: '新增', changes: [
      '小鈴鐺除了公告，也會收到系統通知：管理員取消開團並退款時，受影響的訂購人與該團廠商都會收到通知；每天 18:00 收單後，廠商會收到一則明天訂單的彙總通知。',
      '廠商也有小鈴鐺。'
    ] },
    { name: '變更', changes: [
      '小鈴鐺移到標題列最右邊；「已綁定 LINE」標籤不再顯示，只有尚未綁定時才會出現。'
    ] }
  ],
  '0.18.0': [
    { name: '新增', changes: [
      '廠商新增「訂餐」月曆與「足跡」：月曆只能查看，點自家團的日期可看當天訂單總覽；足跡可切換全部、今年、本月，顯示售出餐點的份數、金額與排行（統計到昨天）。',
      '廠商工作台分成「今日」「訂單」「結算」三個分頁；管理員可唯讀預覽廠商畫面，不會有廠商操作。',
      '管理員可匯入廠商上線前的過往訂單：先預覽數量、確認後寫入，這些日子顯示為「歷史已結清」，不產生轉帳紀錄。',
      '新增暫時開放、唯讀的廠商代號登入（可用開關鎖回），方便測試；不能確認或爭議轉帳。',
      '新增本機 Windows 廠商預覽啟動檔，本機測試會自動挑選可用連接埠。',
      '舊訂單品項身分報表與已審核的身分對照，讓足跡、管理員訂單總覽與廠商月份讀到正確的品項。'
    ] },
    { name: '變更', changes: [
      '品名一律顯示中文規格（半飯、加量），不再出現 BASE、HALF，同一道餐在各畫面顯示現行菜單名稱。',
      '足跡、登入與廠商月份載入大幅加速：廠商月份從十幾秒降到約一秒（模擬測試）。'
    ] },
    { name: '修正', changes: [
      '廠商端現在會計入匯入的舊訂單（已完成），與管理員訂單總覽的份數一致。',
      '足跡中身分未確認的舊品項依原始名稱分組，舊的基本代號半飯品項計為半飯。'
    ] }
  ],
  '0.17.3': [
    { name: '修正', changes: [
      '無法確認菜單身份的訂單會保留原始名稱並各自計算，管理頁與足跡排行也會標示身份尚未確認。',
      '足跡份數、排行與餐點種類改依有效日期、店家、穩定品項識別及規格重算；不同身份、店家或規格不會被合併。',
      '訂單總覽保留原始餐點快照；身份核實後，明細、樓層數與總數顯示一致的有效名稱。'
    ] }
  ],
  '0.17.2': [
    { name: '新增', changes: [
      '使用者明細新增誤建員編修復預覽、覆寫姓名二次確認、來源停用及管理員稽核查詢；目標帳號資料與 LINE 綁定會保留。'
    ] },
    { name: '修正', changes: [
      '訂單總覽與便當足跡依店家、日期、品項及規格同步有效餐點名稱；無法唯一配對時保留原名稱，不更動訂單或帳務。'
    ] }
  ],
  '0.17.1': [
    { name: '修正', changes: [
      '修正管理員檢視其他使用者時，便當足跡誤顯示自己資料的問題，並避免切換身分時殘留舊統計。'
    ] },
    { name: '變更', changes: [
      '店家份數圓餅圖載入後逐步繪製，尊重減少動態效果的系統設定。'
    ] }
  ],
  '0.17.0': [
    { name: '新增', changes: [
      '新增「我的便當足跡」統計頁，依台北日期顯示便當份數、訂購天數、餐點種類、店家分布與餐點排行。'
    ] }
  ],
  '0.16.9': [
    { name: '變更', changes: [
      '「我的訂單」的領取樓層改為廠商旁的小標籤，移除獨立樓層文字列。'
    ] }
  ],
  '0.16.8': [
    { name: '變更', changes: [
      '「我的訂單」改成單月份直接展開所有明細，移除「顯示所有月份」及收合箭頭。',
      '精簡重複的「已訂餐」狀態與操作提示，仍保留特殊狀態、樓層、餐點、金額及備註。'
    ] }
  ],
  '0.16.7': [
    { name: '變更', changes: [
      '餘額交易明細改以月份範圍查詢，減少非當月資料載入；歷史對帳與金額規則維持不變。',
      '優化帳務查詢索引條件，並新增跨月退款及完整後端回歸測試。'
    ] }
  ],
  '0.16.6': [
    { name: '變更', changes: [
      '月曆餐點縮圖延後載入並以非同步方式解碼，降低非必要圖片工作的干擾。',
      '新增前端資源大小比較及瀏覽器效能測試；真實 LINE 手機載入速度尚需實機驗證。'
    ] }
  ],
  '0.16.5': [
    { name: '修正', changes: [
      '點餐及退款交易明細顯示實際訂餐日期，與交易時間分開；無關聯資料時顯示未提供。',
      '交易金額正數改為綠字、負數為紅字、零元維持中性色。',
      '將 GROUP_CANCELLED 等交易代碼改為易讀的繁體中文。'
    ] }
  ],
  '0.16.4': [
    { name: '變更', changes: [
      '縮減月曆頁頁尾多餘留白，保留底部導覽安全間距。',
      '餘額交易明細移除重複的更新按鈕；進入頁面與切換月份仍會自動讀取。',
      '沒有相關管理權限時，不再顯示空白的「使用者與帳務」分類。'
    ] }
  ],
  '0.16.3': [
    { name: '變更', changes: [
      '月曆狀態精簡為「已訂」、「截止」、「可訂」，不影響原有已訂與截止判斷。',
      '點餐畫面新增「返回」按鈕，可以直接回到月曆，不會送出或取消訂單。',
      '「我的訂單」移除重新整理按鈕；進入分頁仍自動更新，讀取失敗時可重試。'
    ] }
  ],
  '0.16.2': [
    { name: '變更', changes: [
      '管理中心依訂餐管理、使用者與帳務、系統設定分組，保留原有權限與功能入口。',
      '「介面切換」改稱「月曆樣式」，選項仍為「經典／極簡」；「使用者管理中心」改稱「使用者管理」。'
    ] }
  ],
  '0.16.1': [
    { name: '變更', changes: [
      '管理中心「介面切換」按鈕改名為「經典」與「極簡」，既有選取狀態及介面偏好不變。'
    ] }
  ],
  '0.16.0': [
    { name: '變更', changes: [
      '新版四分頁、經典與新版介面切換、我的訂單、即時餘額與管理功能整合為 0.16.0 里程碑。',
      '移除首頁上方可見的系統標題列，將姓名、樓層與 LINE 綁定狀態集中靠右排列；保留輔助閱讀標題。'
    ] }
  ],
  '0.15.27': [
    { name: '變更', changes: [
      '訂餐頁移除查看店家菜單快捷按鈕；店家專區保留於管理中心。',
      '我的訂單預設顯示台北時區當月份，保留月份切換，移除冗長說明與篩選月份標題。',
      '餘額頁與介面切換移除重複說明文字。',
      'Admin 管理中心不再重複顯示檢視身分和選擇代點餐，既有授權操作與 ProxyAdmin 不變。'
    ] }
  ],
  '0.15.26': [
    { name: '變更', changes: [
      '首頁上方僅保留系統名稱、使用者與 LINE 狀態；移除重複的餘額與管理快捷按鈕。',
      '底部錢包分頁直接顯示目前帳戶金額，不再出現「餘額」字樣；負數以紅色顯示，點擊仍可看交易明細。',
      '管理分頁集中店家專區、訂單總覽、使用者管理、開團與其他權限操作，並可切換經典／新版月曆介面。',
      '所有使用者都可由訂餐月曆的「查看店家菜單」進入店家專區。'
    ] }
  ],
  '0.15.25': [
    { name: '新增', changes: [
      '蔡老師便當依 9 月 17 日正規化菜單啟用後的有效訂單，自動計算近 30 天及 90 天熱門度，風味餐固定置頂。',
      '小而美、特餐及其半飯規格合併熱門度，同主品項集中顯示；目前資料較少時優先顯示小而美與特餐。'
    ] },
    { name: '變更', changes: [
      '排序不納入移轉前歷史訂單、取消訂單及手續費等非餐點資料；不變更價格、訂單或餘額。'
    ] }
  ],
  '0.15.24': [
    { name: '新增', changes: [
      '首頁底部新增可操作的訂餐、我的訂單、餘額與管理導覽，支援手機底部安全區與清楚的選取狀態。',
      '我的訂單可依月份查詢，展開正式系統保存的歷史餐點、數量與金額。',
      '餘額頁直接查看本人目前餘額、每月收支與交易明細。'
    ] },
    { name: '變更', changes: [
      '管理入口依角色與權限顯示，檢視身分不能修改他人訂單或餘額。',
      '切換分頁保留新版月曆選取日期，保留原有訂餐、取消與管理功能。'
    ] }
  ],
  '0.15.23': [
    { name: '變更', changes: [
      '使用者管理中心的姓名修改與交易明細改為彈跳視窗，不再把表單插入列表上方。',
      '管理員結束檢視身分或代點餐後，回到使用者管理中心。',
      '新版月曆未開團日期若已有蔡老師風味餐資料，顯示風味餐名稱但仍標示未開團。'
    ] }
  ],
  '0.15.22': [
    { name: '變更', changes: [
      '管理員可點使用者姓名修改姓名，透過管理員專用授權 API 儲存並留下稽核紀錄。',
      '使用者管理中心的 LINE 已綁定標籤改為「已綁定」，操作按鈕移除小圖示並統一簡短名稱。',
      '新版月曆的禾拾只顯示店家名稱，不顯示餐點名稱與圖片；蔡老師維持顯示風味餐名稱與對應照片。'
    ] }
  ],
  '0.15.21': [
    { name: '變更', changes: [
      '使用者管理中心桌面版整併成五欄，員編與姓名、角色與 LINE 綁定改為上下呈現。',
      '每位使用者的操作欄加入交易明細；Admin 首頁移除重複的檢視身分與選擇代點餐入口，ProxyAdmin 仍保留代點餐入口。'
    ] }
  ],
  '0.15.20': [
    { name: '修正', changes: [
      '餘額管理入口明確標示使用者管理中心，保留檢視身分、代點餐、餘額與交易明細的原有權限。',
      '新版月曆移除下一個可訂餐日區塊，日期格顯示便當或店家摘要，下方顯示星期與當日正式菜單。',
      '禾拾餐點改讀取當日禾拾菜單與圖片，不再誤用蔡老師風味餐資訊。'
    ] }
  ],
  '0.15.19': [
    { name: '新增', changes: [
      '新增管理員專用的新版月曆預覽，日期狀態更簡潔，並可查看完整餐點資訊與下一個可訂餐日。',
      '管理員可以切換經典版與新版介面；其他使用者仍使用經典版，訂餐及餘額資料不受影響。'
    ] }
  ],
  '0.15.18': [
    {
      name: '新增',
      changes: [
        '管理者可以唯讀查詢指定使用者的餘額、每月交易紀錄與交易後餘額，並記錄管理查詢稽核。',
        '「檢視身分」的選人視窗新增員編篩選與餘額交易明細查詢，不需要切換成使用者身分。',
        '新增「使用者管理中心」第一階段：在同一份清單提供檢視身分、代點餐、儲值及交易明細入口，保留原本權限限制。'
      ]
    },
    {
      name: '變更',
      changes: [
        '餘額管理取消「全部／負餘額」切換，改為點選欄位標題排序，預設餘額由小到大；手機版順序一致。',
        '餘額管理、檢視身分及代點餐名單不再顯示重複的身份狀態標籤，LINE 綁定資訊仍保留。',
        '舊的操作入口暫時保留，待新介面正式部署及驗收後再移除。'
      ]
    }
  ],
  '0.15.17': [
    {
      name: '修正',
      changes: [
        '改善 Android LINE 首次登入返回時的狀態恢復，避免登入過程中返回事件遭忽略。',
        '登入整體等待上限從 60 秒縮短為 30 秒，逾時可重新連線；Android 實機驗收仍待確認。'
      ]
    }
  ],
  '0.15.16': [
    {
      name: '修正',
      changes: [
        '修正 Admin「目前菜單」建立菜單變更時，HALF 品項錯誤帶入 BASE 的問題，並確保兩種規格各自保存。'
      ]
    }
  ],
  '0.15.15': [
    {
      name: '修正',
      changes: [
        '首頁與會員卡依會員資料顯示 LINE 綁定狀態，員編登入不再誤顯示綁定按鈕。',
        '改善 LINE 與員編登入切換、登入失效及回到前景時的綁定狀態更新。'
      ]
    }
  ],
  '0.15.14': [
    {
      name: '修正',
      changes: [
        '登入連線逾時會顯示錯誤與重新連線按鈕，可直接重試，不必關閉網頁。',
        '改善 LINE 返回、背景切回與網路恢復時的登入處理，避免舊回應覆蓋新選擇或重複送出綁定。'
      ]
    }
  ],
  '0.15.13': [
    {
      name: '變更',
      changes: [
        'Admin 將某日設為「不開團」時，現在會取消該日全部有效訂單並將款項全額退回使用者餘額；即使已超過一般訂餐截止時間也可執行。',
        '取消開團前會顯示高風險確認，包含訂單筆數、餐點份數、總金額，以及「全部取消並退款」警告。'
      ]
    },
    {
      name: '修正',
      changes: [
        '整團取消會在同一個安全交易中完成退款、訂單狀態歷程、訂單取消、關閉開團與管理稽核，避免留下部分退款或半套狀態。',
        '重複執行取消開團不會二次退款；沒有有效訂單的日期仍可正常設為不開團。'
      ]
    }
  ],
  '0.15.12': [
    {
      name: '修正',
      changes: [
        '修正已有空店家設定的未開團日期，仍會顯示該日對應的風味餐圖片。'
      ]
    }
  ],
  '0.15.11': [
    {
      name: '修正',
      changes: [
        '未開團日期也會顯示同日期對應的蔡老師風味餐圖片；假日與補假仍不顯示圖片。'
      ]
    }
  ],
  '0.15.10': [
    {
      name: '新增',
      changes: [
        '月曆在對應日期且開蔡老師團時，會在風味餐名稱下方顯示當日餐點縮圖。',
        '點擊縮圖可放大查看；假日、補假與未開團日期不顯示縮圖。'
      ]
    }
  ],
  '0.15.9': [
    {
      name: '新增',
      changes: [
        '蔡老師每日風味餐會依日期同步官方名稱、介紹與圖片，既有餐點代號與價格維持不變。',
        '公告支援圖片快照，可在公告管理與公告詳情中查看。',
        '餘額與身份管理新增員編搜尋。',
        '點餐頁新增上一個／下一個開團日按鈕，可快速切換其他已開團日期。',
        '主月曆在未開團或已開蔡老師團的日期顯示當日風味餐名稱，方便先判斷是否要投票或點餐。',
        '點餐頁日期區移除重複的「預訂日期」小標，畫面更精簡。'
      ]
    },
    {
      name: '修正',
      changes: [
        '一般 User 以 LINE 搭配員編解析後會保留有效 LINE 綁定，後續 LINE 登入可直接進入。',
        '修正公告管理更新圖片後，同一個 session 的公告詳情仍顯示舊內容。',
        '修正蔡老師官方網站阻擋 Cloudflare 極簡請求造成每日風味餐同步失敗。'
      ]
    },
    {
      name: '重構',
      changes: [
        '將 App.jsx 部分純函式拆分到 auth、bootstrap、orders 與 balances 模組，維持既有行為。'
      ]
    }
  ],
  '0.15.8': [
    {
      name: '修正',
      changes: [
        '修正一般 User 使用員編登入時看不到訂單總覽的問題，現在與 LINE 登入具有相同的唯讀訂單總覽權限。',
        '補強權限回歸測試，確保員編登入仍無法取得餘額管理、儲值、開團、角色管理與 View As 等管理能力。'
      ]
    },
    {
      name: '變更',
      changes: [
        '「訂單管理」更名為「訂單總覽」，讓名稱符合目前僅提供查詢與統計的唯讀功能。'
      ]
    }
  ],
  '0.15.7': [
    {
      name: '新增',
      changes: [
        'README 新增實際系統畫面展示，包含開團月曆、點餐流程與訂單管理。',
        '新增最佳化的 README 截圖資產，讓專案流程與實際使用情境更容易理解。'
      ]
    }
  ],
  '0.15.6': [
    {
      name: '變更',
      changes: [
        '訂單管理新增「全部明細／樓層明細／餐點匯總」分頁，預設顯示全部明細，既有內容與匯總邏輯維持不變。',
        '儲值預設方式改為台灣 Pay，備註預設為當日台北日期的 M/D收款，且仍可手動修改。'
      ]
    }
  ],
  '0.15.5': [
    {
      name: '修正',
      changes: [
        '修正尚未註冊的員編完成 onboarding 後仍被導向 LINE 綁定流程的問題。',
        '一般 User 首次使用員編註冊完成後，可直接進入主畫面並使用一般點餐功能。',
        'LINE 綁定維持為選用，不再作為一般 User 首次員編註冊的必要條件。'
      ]
    }
  ],
  '0.15.4': [
    {
      name: '變更',
      changes: [
        '手機個人儲值／交易明細改為預設收合的本月摘要，展開後仍可查看完整四項統計，月份與餘額語意不變。',
        '一般 User 現在可使用 LINE 或員編登入並交替使用，兩種 entry 共用同一個 canonical user，不建立 duplicate user。',
        '一般 User 完成員編 onboarding 後即可使用一般點餐功能，LINE binding 不再是強制前置條件。',
        'ProxyAdmin 代點餐支援今天與未來已開團且尚未截止的日期；既有 cutoff、授權與 mutation protection 維持不變。',
        'Vendor Hub 列表與詳細頁新增由 canonical calendar deadline 投影的最後點餐時間。'
      ]
    },
    {
      name: '安全',
      changes: [
        'Admin／ProxyAdmin 維持嚴格身份驗證；employee-only／employee_guest 不可取得 elevated role、capability 或 admin bootstrap。',
        'ownership conflict 不再阻擋一般 User session resolution，但不會自動覆寫既有 LINE ownership。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正一般 User 員編登入後仍被殘留狀態導向 LINE binding 的問題。'
      ]
    }
  ],
  '0.15.3': [
    {
      name: '變更',
      changes: [
        '一般 User 現在可使用 LINE 或員編登入，兩種 entry 可交替使用並共用同一個 canonical user。',
        '已有 LINE 綁定的 User 仍可使用員編登入；員編登入後也可再使用 LINE。',
        '一般 User 完成員編查詢、顯示名稱與領取樓層設定後即可使用一般點餐功能，LINE 綁定為選用功能。'
      ]
    },
    {
      name: '安全',
      changes: [
        'ownership conflict 不再阻擋一般 User 的 session resolution，但不會自動覆寫既有 LINE ownership。',
        'employee-only／employee_guest 不可取得 Admin／ProxyAdmin elevated privileges；管理角色仍維持嚴格身份驗證。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正 LINE completion 後按繼續無法直接進入主畫面的問題，補上 callback／state refresh 並修正 lineUserId state。',
        '修正 9/21 normalized menu overlay 遺失既有 menu_item_id，避免 synthetic menu item ID 導致 order FK failure／MUTATION_CONFLICT。',
        '保留既有 concurrency／mutation protection 不變。'
      ]
    }
  ],
  '0.15.2': [
    {
      name: '變更',
      changes: [
        '餘額管理改為「全部／負餘額」',
        'Admin / ProxyAdmin header role 顯示調整',
        '個人資料可修改姓名與預設取餐樓層',
        '訂單管理日期快速前後切換',
        '便購種類匯總改為依樓層分組',
        '店家專區卡片版面改善'
      ]
    },
    {
      name: '新增',
      changes: [
        '代點餐新增員編即時篩選'
      ]
    }
  ],
  '0.15.1': [
    {
      name: '新增',
      changes: [
        '新增 legacy/raw 與 normalized 菜單 identity 邊界，新的菜單變更支援 BASE／HALF／PLUS variant。',
        '新增 normalized 菜單同日 append-only revision 與 variant 搬移的原子處理。'
      ]
    },
    {
      name: '變更',
      changes: [
        '保留歷史菜單、快照與訂單資料不變，只在新的生效日起將 legacy code 投影為 normalized identity。',
        'Admin 目前菜單改為依供應商與日期自動載入，既有品項代號唯讀並移除手動查詢按鈕。'
      ]
    }
  ],
  '0.15.0': [
    {
      name: '新增',
      changes: [
        '新增「店家專區」，集中查看店家介紹、菜單圖片與最新菜單連結。',
        '新增店家資料管理，Admin／ProxyAdmin 可維護店家 metadata。',
        '店家名稱統一使用 canonical vendor，避免同一店家重複顯示。'
      ]
    },
    {
      name: '變更',
      changes: [
        '菜單圖片支援點擊放大檢視。',
        '店家列表新增菜單縮圖，可直接點擊放大，不必進入店家頁即可快速查看菜單。',
        '優化桌機與手機上的菜單預覽及關閉操作。'
      ]
    }
  ],
  '0.14.2': [
    {
      name: '新增',
      changes: [
        '菜單品項維護新增「目前菜單」與「變更歷程」分頁；目前菜單沿用正式點餐頁的生效日 canonical resolver。',
        '供應商選項改由 Worker 提供的 canonical vendor source 載入。'
      ]
    },
    {
      name: '變更',
      changes: [
        '變更歷程移除重複的供應商欄位，改由上方供應商篩選決定。',
        '菜單維護表格改為桌面表格與手機 compact cards，減少不必要的橫向捲動。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正匯入的目前有效品項（包含咖哩鷹豆泥）雖可供使用者點餐，卻未出現在 Admin 菜單維護主畫面的問題。'
      ]
    }
  ],
  '0.14.1': [
    {
      name: '變更',
      changes: [
        '代點餐支援未綁定 LINE 的有效會員',
        '個人交易明細顯示中文點餐狀態、用餐日期、店家與品項',
        '修正點餐與取消後畫面餘額未即時更新'
      ]
    }
  ],
  '0.14.0': [
    {
      name: '新增',
      changes: [
        '新增 Admin／ProxyAdmin 代點餐，並將代點模式與 View-As 維持獨立；View-As 仍為唯讀。'
      ]
    },
    {
      name: '變更',
      changes: [
        'Admin 本人點餐與代點餐皆不受一般日期／截止時間限制，可處理其他有效訂餐日期。',
        'ProxyAdmin 僅限台北當日代點，但可突破一般截止時間；本人點餐仍遵循一般日期／截止時間規則。',
        '代點訂單 ownership 仍屬於被代點成員；代點扣款與退款仍作用於被代點成員。',
        'Admin／ProxyAdmin 本人餘額不受代點影響。',
        'COMPLETED／readOnly／finalized 歷史訂單仍不可修改。'
      ]
    }
  ],
  '0.13.0': [
    {
      name: '新增',
      changes: [
        '新增 Worker + D1 authoritative identity 與安全的 provisional employee claim；claim 會保留 audit/history、撤銷有效 guest sessions，並退休 provisional row。',
        'Admin 綁定員編沿用 central authorization、canonical ownership 與 authoritative readback。'
      ]
    },
    {
      name: '變更',
      changes: [
        'active LINE canonical user 綁定員編後立即視為已註冊，沿用既有 canonical role 與權限；verificationStatus 僅保留為歷史相容欄位。',
        'employee_guest 維持訪客專用邊界；employee_roster 不再是 LINE 登入、綁定、授權或正常功能的前置條件。',
        'LINE user 未綁員編時顯示綁定提示；綁定完成後直接進入系統，不進入 pending verification 或 Admin approval 流程。'
      ]
    }
  ],
  '0.12.1': [
    {
      name: '變更',
      changes: [
        'Admin「切換身分」顯示伺服器回傳的姓名、員編、樓層與角色；沒有員編時顯示「未綁定」。',
        '若 legacy GAS 的 Users source 明確提供員工編號欄位，管理清單會沿用該伺服器欄位；沒有欄位時不猜測員編。',
        '餘額管理新增員編欄位，保留既有角色、樓層、餘額與操作行為，並沿用手機版的局部橫向滾動。'
      ]
    }
  ],
  '0.12.0': [
    {
      name: '新增',
      changes: [
        '新增「尚未綁定員編」身份狀態，LINE 已登入但 canonical user 尚無員編時，改顯示明確的員編綁定入口。',
        '沿用伺服器驗證的 LINE 員編綁定流程，不建立另一個 Employee Guest session。'
      ]
    },
    {
      name: '變更',
      changes: [
        '員編綁定只補上同一個 canonical user 的員編，不會改變核驗狀態、角色、餘額或使用者所有權。',
        '尚未綁定員編的 LINE identity 僅保留員編綁定與查看 onboarding 狀態所需權限。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正 LINE canonical user 缺少員編時被誤判為已綁定或落入錯誤未註冊流程的問題。',
        '補強員編 collision 的拒絕行為，並保留同一身份重試的冪等處理。'
      ]
    }
  ],
  '0.11.3': [
    {
      name: '修正',
      changes: [
        '修正 Worker 啟動時先還原快取 Employee Guest session 的問題，改由可信的 LINE／LIFF 身份優先解析。',
        'LINE 身份取得優先權後會清除過期或陳舊的 guest credential，避免 line 與 employee_guest 狀態混用。',
        '已有 canonical UNVERIFIED LINE 身份時改走基本資料更新與待核驗流程，不再重複建立 Employee Guest onboarding。',
        '還原 guest session 時會解析既有的 UNVERIFIED canonical 員工身份，明確區分新 provisional user 與既有待核驗 user。',
        '保留 EMPLOYEE_ONBOARDING_CONFLICT 防護，既有待核驗身份改走基本資料更新，不再重複建立 onboarding。'
      ]
    }
  ],
  '0.11.2': [
    {
      name: '變更',
      changes: [
        'LINE 綁定或完成基本資料的 UNVERIFIED 身份，在完成正式核驗前仍維持 onboarding-only 流程。',
        '基本資料更新會同時保存顯示名稱與領取樓層，重新整理後仍保留待核驗資料。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正 UNVERIFIED 基本資料更新後沒有成功回饋的問題，並清楚顯示員工身分仍待核驗。',
        '將誤導性的 LINE onboarding 完成文案改為「LINE 綁定完成」與「員工身分待核驗」。'
      ]
    }
  ],
  '0.11.1': [
    {
      name: '新增',
      changes: [
        '新增 Employee Guest provisional onboarding 完成 API，無 LINE 驗證脈絡時也可完成 onboarding。'
      ]
    },
    {
      name: '變更',
      changes: [
        'Employee Guest 的 UNVERIFIED onboarding 不再要求 LINE 驗證或建立 LINE binding；LINE 綁定僅保留給 LINE-authenticated onboarding flow。'
      ]
    },
    {
      name: '修正',
      changes: [
        '修正 provisional onboarding 介面，不再把 LINE 綁定顯示或呼叫為 guest fallback 的必要完成步驟。'
      ]
    }
  ],
  '0.11.0': [
    {
      name: '新增',
      changes: [
        'LINE 首次登入新增伺服器驗證的員工身份查詢與明確綁定流程。',
        '格式正確但尚未有 mapping 的員工編號可進入 UNVERIFIED onboarding。',
        '新增集中式 verification-aware authorization 與 capability derivation。',
        '新增 provisional identity migration 0003，支援核驗狀態與 onboarding session。'
      ]
    },
    {
      name: '變更',
      changes: [
        '員工編號完成 LINE 綁定後，禁止純員編登入並要求使用 LINE。',
        'Employee Guest Login 僅保留為沒有 LINE auth context 時的 fallback。',
        'UNVERIFIED 身份僅允許 onboarding capabilities，預設拒絕一般 application-data 與 privileged capabilities。',
        '完成 remote canonical identity migration，並將 provisional identity migration 0003 套用至 formal D1。'
      ]
    },
    {
      name: '修正',
      changes: [
        '強化 LINE binding、employee collision 與 silent rebind protection，採 fail-closed 行為。'
      ]
    },
    {
      name: '已知限制',
      changes: [
        '目前 workbook 仍缺少 employee_id 與 approved mapping，production employee import 仍為 BLOCKED。'
      ]
    }
  ],
  '0.10.1': [
    {
      name: '修正',
      changes: [
        '修正取消訂單失敗問題',
        '改善取消訂單時的錯誤訊息'
      ]
    },
    {
      name: '新增',
      changes: [
        '取消訂單前新增訂單明細確認',
        '取消完成後顯示完成提示，再返回月曆'
      ]
    },
    {
      name: '變更',
      changes: [
        '避免重複送出取消請求',
        '取消成功後重新整理訂單、月曆與餘額狀態'
      ]
    }
  ],
  '0.10.0': [
    {
      name: '新增',
      changes: [
        '新增僅限 Admin 使用的 Worker 公告新增、查詢、更新與刪除功能。',
        '已註冊使用者可進入並讀取訂單摘要，不會因此取得其他管理權限。'
      ]
    },
    {
      name: '變更',
      changes: [
        '移除頁首餘額標籤，但保留餘額資料、格式、帳務紀錄與管理行為。',
        '改以 Markdown 檔案作為完整版本歷程的正式來源。'
      ]
    }
  ]
});

const uiCategoryName = Object.freeze({
  Added: '新增',
  Changed: '變更',
  Changes: '異動',
  Fixed: '修正',
  'Known Limitations': '已知限制'
});

const LEGACY_UI_RELEASES = new Set([
  '0.9.0',
  '0.8.0',
  '0.7.1',
  '0.7.0',
  '0.6.0',
  '0.5.0',
  '0.4.1',
  '0.4.0',
  '0.3.0',
  '0.2.1',
  '0.1.0'
]);

const localizeRelease = (release) => {
  const translation = UI_CHANGELOG_TRANSLATIONS[release.version || 'unreleased'];
  if (translation) {
    return {
      ...release,
      categories: translation,
      changes: translation.flatMap((category) => category.changes)
    };
  }

  if (!LEGACY_UI_RELEASES.has(release.version)) {
    throw new Error(`Missing Traditional Chinese changelog translation for ${release.version || 'unreleased'}`);
  }

  return {
    ...release,
    categories: release.categories.map((category) => ({
      ...category,
      name: uiCategoryName[category.name] || category.name
    }))
  };
};

export const UI_CHANGELOG = CHANGELOG.filter(isFormalRelease).map(localizeRelease);
