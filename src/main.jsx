import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 強制監聽並移除 Netlify Badge
if (typeof window !== 'undefined') {
  const removeNetlifyBadge = () => {
    const badge = document.querySelector('.nl-wrap');
    if (badge) {
      badge.remove();
    }
  };

  // 立即執行一次
  removeNetlifyBadge();

  // 直接啟動 DOM 變更監聽，無需等待 DOMContentLoaded
  const observer = new MutationObserver(() => {
    removeNetlifyBadge();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)