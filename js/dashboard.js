/* Forest2 dashboard loader: 기존 대시보드 기능을 먼저 불러온 뒤 확장 모듈을 연결합니다. */
(() => {
  'use strict';
  const current = document.currentScript;
  const base = current ? new URL('.', current.src) : new URL('../js/', location.href);
  const version = '20261026d';
  const load = (name, onload) => {
    const s = document.createElement('script');
    s.src = new URL(name, base).href + '?v=' + version;
    s.async = false;
    s.onload = onload || null;
    s.onerror = () => console.error('[TreeSam] 스크립트 로드 실패:', s.src);
    document.head.appendChild(s);
  };
  load('dashboard-core.js', () => {
    load('bulk-import.js', () => load('qr-bulk-print.js'));
  });
})();
