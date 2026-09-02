import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 強制監聽並徹底移除 Netlify Badge
if (typeof window !== 'undefined') {
  const purgeBadge = () => {
    // 1. 移除 DOM 元素
    const elements = document.querySelectorAll('.nl-wrap, #nl-badge, #nl-card');
    elements.forEach(el => el.remove());

    // 2. 動態注入全域最高權重 CSS 樣式
    if (!document.getElementById('anti-netlify-style')) {
      const style = document.createElement('style');
      style.id = 'anti-netlify-style';
      style.innerHTML = `
        .nl-wrap, #nl-badge, #nl-card, [class*="nl-wrap"] {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  };

  // 立即觸發一次
  purgeBadge();

  // 定時輪詢，防止非同步腳本晚載入
  const timer = setInterval(purgeBadge, 300);

  // 當 DOM 載入後掛載 MutationObserver 監聽
  const initObserver = () => {
    purgeBadge();
    const target = document.body || document.documentElement;
    if (target) {
      const observer = new MutationObserver(purgeBadge);
      observer.observe(target, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }

  // 10 秒後清除輪詢定時器以節省資源
  setTimeout(() => clearInterval(timer), 10000);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
