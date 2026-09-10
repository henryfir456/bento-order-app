import packageJson from '../../package.json';
import changelogMarkdown from '../../CHANGELOG.md?raw';
import { parseChangelog } from './changelogParser';

export const APP_VERSION = packageJson.version;

export const CHANGELOG = parseChangelog(changelogMarkdown);

// CHANGELOG.md is the English developer/release record. Keep user-facing
// Traditional Chinese copy here so the UI does not render the raw Markdown.
const UI_CHANGELOG_TRANSLATIONS = Object.freeze({
  unreleased: [
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
  Fixed: '修正'
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

export const UI_CHANGELOG = CHANGELOG.map(localizeRelease);
