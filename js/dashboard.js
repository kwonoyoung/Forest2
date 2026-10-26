/* Forest2 dashboard loader: 기존 대시보드 기능을 먼저 불러온 뒤 엑셀 일괄등록 모듈을 연결합니다. */
(() => {
  'use strict';
  const current = document.currentScript;
  const base = current ? new URL('.', current.src) : new URL('../js/', location.href);
  const load = (name, onload) => {
    const s = document.createElement('script');
    s.src = new URL(name, base).href + '?v=20261026c';
    s.async = false;
    s.onload = onload || null;
    s.onerror = () => console.error('[TreeSam] 스크립트 로드 실패:', s.src);
    document.head.appendChild(s);
  };
  load('dashboard-core.js', () => load('bulk-import.js'));
})();
