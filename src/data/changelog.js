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
