import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 在最上層對 HTML 節點進行暴力清掃
if (typeof window !== 'undefined') {
  const killBadge = () => {
    const targets = document.querySelectorAll('.nl-wrap, #nl-badge, #nl-card');
    targets.forEach(el => el.parentNode && el.parentNode.removeChild(el));
  };

  // 1. 立即清掃
  killBadge();

  // 2. 針對頂層 html 掛載觀察器（防止 body 還沒誕生時注入）
  const observer = new MutationObserver(killBadge);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // 3. 頁面載入完成後持續檢查 3 秒
  window.addEventListener('load', () => {
    killBadge();
    setTimeout(killBadge, 500);
    setTimeout(killBadge, 1500);
    setTimeout(killBadge, 3000);
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
