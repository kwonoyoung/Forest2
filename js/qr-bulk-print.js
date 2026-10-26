/* 트리샘 - 등록 수목 QR 일괄출력 / A4 라벨 인쇄 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const client = window.forestSupabase;
  const QR_SRC = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
  const state = { trees: [], selected: new Set(), loading: false };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function addStyle() {
    if ($('qrBulkPrintStyle')) return;
    const style = document.createElement('style');
    style.id = 'qrBulkPrintStyle';
    style.textContent = `
      .qr-bulk{margin-top:18px;padding:18px;border:1px solid #dce5df;border-radius:12px;background:#f8fbf9}
      .qr-bulk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .qr-bulk-head h3{margin:0;color:#174b3b;font-size:17px}.qr-bulk-head p{margin:5px 0 0;color:#5f6662;font-size:13px;line-height:1.55}
      .qr-bulk-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
      .qr-bulk-actions button{min-height:40px;padding:0 14px;border:1px solid #b9c7c0;border-radius:8px;background:#fff;color:#28443a;font-weight:700}
      .qr-bulk-actions .primary{background:#18533f;color:#fff;border-color:#18533f}.qr-bulk-actions button:disabled{opacity:.45;cursor:not-allowed}
      .qr-select-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
      .qr-select-tools button{min-height:34px;padding:0 10px;border:1px solid #c8d5ce;border-radius:7px;background:#fff;color:#315246;font-size:12px}
      .qr-select-count{margin-left:auto;color:#52615a;font-size:12px;font-weight:700}
      .qr-tree-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;max-height:250px;overflow:auto;padding:2px}
      .qr-tree-choice{display:flex;align-items:center;gap:8px;min-width:0;padding:9px 10px;border:1px solid #e0e7e3;border-radius:8px;background:#fff;cursor:pointer}
      .qr-tree-choice input{width:18px;height:18px;flex:0 0 auto;margin:0}.qr-tree-choice span{min-width:0;font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qr-tree-choice b{color:#174b3b}.qr-tree-choice small{color:#69736e}
      .qr-bulk-status{margin-top:12px;padding:11px 12px;border-radius:8px;background:#eef4f0;color:#425249;font-size:13px;line-height:1.55}.qr-bulk-status.error{background:#fff0f0;color:#9f1f1f}.qr-bulk-status.ok{background:#eaf8ef;color:#0f6534}
      .qr-bulk-note{margin-top:9px;color:#68716c;font-size:12px;line-height:1.55}
      @media(max-width:900px){.qr-tree-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:650px){.qr-tree-list{grid-template-columns:1fr}.qr-bulk-actions>*{flex:1 1 calc(50% - 8px)}.qr-bulk-actions .primary{flex-basis:100%}.qr-select-count{width:100%;margin-left:0}}
    `;
    document.head.appendChild(style);
  }

  function injectUI() {
    if ($('qrBulkPrintPanel')) return true;
    const host = document.querySelector('.operations');
    if (!host) return false;
    const box = document.createElement('div');
    box.className = 'qr-bulk';
    box.id = 'qrBulkPrintPanel';
    box.innerHTML = `
      <div class="qr-bulk-head">
        <div><h3>QR 일괄출력</h3><p>등록된 수목 QR을 선택하거나 전체 선택하여 A4 라벨형으로 한 번에 출력할 수 있습니다.</p></div>
      </div>
      <div class="qr-bulk-actions">
        <button type="button" id="qrRefreshButton">목록 새로고침</button>
        <button type="button" id="qrPrintSelectedButton" class="primary" disabled>선택 QR 출력</button>
        <button type="button" id="qrPrintAllButton">전체 QR 출력</button>
      </div>
      <div class="qr-select-tools">
        <button type="button" id="qrSelectAllButton">전체 선택</button>
        <button type="button" id="qrSelectNoneButton">선택 해제</button>
        <span class="qr-select-count" id="qrSelectCount">선택 0개</span>
      </div>
      <div id="qrTreeList" class="qr-tree-list" aria-label="QR 출력 수목 선택 목록"><div style="grid-column:1/-1;padding:14px;color:#68716c">등록 수목 목록을 불러오는 중입니다.</div></div>
      <div id="qrBulkStatus" class="qr-bulk-status">A4 기준 3열 × 4행, 한 페이지 최대 12개 라벨로 자동 배치합니다.</div>
      <div class="qr-bulk-note">라벨에는 수목명, 대장번호, QR코드가 표시됩니다. 인쇄창에서 배율은 100%로 두고 머리글/바닥글을 끄는 것을 권장합니다.</div>`;
    const bulk = $('bulkImportPanel');
    if (bulk && bulk.parentElement === host) bulk.insertAdjacentElement('afterend', box);
    else host.appendChild(box);
    bindEvents();
    loadTrees();
    return true;
  }

  function setStatus(text, type = '') {
    const el = $('qrBulkStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'qr-bulk-status' + (type ? ' ' + type : '');
  }

  async function loadTrees() {
    if (state.loading) return;
    state.loading = true;
    $('qrRefreshButton').disabled = true;
    setStatus('등록된 수목 목록을 불러오는 중입니다…');
    try {
      if (!client) throw new Error('데이터베이스 연결이 준비되지 않았습니다. 페이지를 새로고침해 주세요.');
      const { data, error } = await client.from('demo_trees').select('id,asset_no,name').order('asset_no');
      if (error) throw error;
      state.trees = data || [];
      const validIds = new Set(state.trees.map(t => String(t.id)));
      state.selected = new Set([...state.selected].filter(id => validIds.has(id)));
      renderList();
      setStatus(`등록 수목 ${state.trees.length}개를 불러왔습니다. 출력할 수목을 선택해 주세요.`, 'ok');
    } catch (e) {
      state.trees = [];
      state.selected.clear();
      renderList();
      setStatus('수목 목록을 불러오지 못했습니다: ' + (e?.message || e), 'error');
    } finally {
      state.loading = false;
      $('qrRefreshButton').disabled = false;
      updateButtons();
    }
  }

  function renderList() {
    const el = $('qrTreeList');
    if (!state.trees.length) {
      el.innerHTML = '<div style="grid-column:1/-1;padding:14px;color:#68716c">등록된 수목이 없습니다.</div>';
      updateButtons();
      return;
    }
    el.innerHTML = state.trees.map(t => {
      const id = String(t.id);
      const checked = state.selected.has(id) ? ' checked' : '';
      return `<label class="qr-tree-choice"><input type="checkbox" data-qr-tree-id="${esc(id)}"${checked}><span><b>${esc(t.name || '-')}</b> <small>· ${esc(t.asset_no || '-')}</small></span></label>`;
    }).join('');
    updateButtons();
  }

  function updateButtons() {
    if (!$('qrSelectCount')) return;
    $('qrSelectCount').textContent = `선택 ${state.selected.size}개 / 전체 ${state.trees.length}개`;
    $('qrPrintSelectedButton').disabled = !state.selected.size;
    $('qrPrintAllButton').disabled = !state.trees.length;
    $('qrSelectAllButton').disabled = !state.trees.length;
    $('qrSelectNoneButton').disabled = !state.selected.size;
  }

  function bindEvents() {
    $('qrRefreshButton').addEventListener('click', loadTrees);
    $('qrTreeList').addEventListener('change', e => {
      const input = e.target.closest('[data-qr-tree-id]');
      if (!input) return;
      const id = String(input.dataset.qrTreeId);
      if (input.checked) state.selected.add(id); else state.selected.delete(id);
      updateButtons();
    });
    $('qrSelectAllButton').addEventListener('click', () => {
      state.selected = new Set(state.trees.map(t => String(t.id)));
      renderList();
    });
    $('qrSelectNoneButton').addEventListener('click', () => {
      state.selected.clear();
      renderList();
    });
    $('qrPrintSelectedButton').addEventListener('click', () => {
      const list = state.trees.filter(t => state.selected.has(String(t.id)));
      printLabels(list, '선택 QR');
    });
    $('qrPrintAllButton').addEventListener('click', () => printLabels(state.trees, '전체 QR'));
  }

  function loadQrLib() {
    if (window.QRCode) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src && s.src.includes('qrcodejs'));
      if (existing) {
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', () => reject(new Error('QR 생성 프로그램을 불러오지 못했습니다.')), { once:true });
        if (window.QRCode) resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = QR_SRC;
      s.onload = resolve;
      s.onerror = () => reject(new Error('QR 생성 프로그램을 불러오지 못했습니다.'));
      document.head.appendChild(s);
    });
  }

  function publicUrl(id) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('tree', id);
    return u.href;
  }

  async function makeQrDataUrl(text) {
    await loadQrLib();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:220px;height:220px;background:white;padding:0;';
    document.body.appendChild(holder);
    try {
      new QRCode(holder, { text, width:220, height:220, correctLevel: QRCode.CorrectLevel.M });
      await new Promise(r => setTimeout(r, 30));
      const canvas = holder.querySelector('canvas');
      if (canvas) return canvas.toDataURL('image/png');
      const img = holder.querySelector('img');
      if (img?.src) return img.src;
      throw new Error('QR 이미지를 만들지 못했습니다.');
    } finally {
      holder.remove();
    }
  }

  async function printLabels(trees, title) {
    if (!trees?.length) { setStatus('출력할 수목을 선택해 주세요.', 'error'); return; }
    const printWin = window.open('', '_blank');
    if (!printWin) { setStatus('인쇄창이 차단되었습니다. 브라우저 팝업을 허용한 뒤 다시 시도해 주세요.', 'error'); return; }
    printWin.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>트리샘 QR 라벨 출력</title></head><body style="font-family:Arial,sans-serif;padding:24px">QR 라벨을 준비하는 중입니다…</body></html>');
    printWin.document.close();
    $('qrPrintSelectedButton').disabled = true;
    $('qrPrintAllButton').disabled = true;
    setStatus(`${title} ${trees.length}개 QR 라벨을 생성하는 중입니다…`);
    try {
      const labels = [];
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const qr = await makeQrDataUrl(publicUrl(String(t.id)));
        labels.push(`<article class="label"><div class="name">${esc(t.name || '-')}</div><img src="${qr}" alt="QR"><div class="asset">대장번호 ${esc(t.asset_no || '-')}</div><div class="brand">트리샘 · 수목관리</div></article>`);
      }
      const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} - 트리샘 QR 라벨</title><style>
        @page{size:A4 portrait;margin:8mm}
        *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#17251f;font-family:"Malgun Gothic","Apple SD Gothic Neo",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;background:#174b3b;color:#fff}.toolbar button{border:0;border-radius:7px;padding:9px 18px;background:#fff;color:#174b3b;font-weight:700;cursor:pointer}.toolbar span{font-size:13px}
        .sheet{width:194mm;margin:8mm auto;display:grid;grid-template-columns:repeat(3,60mm);grid-auto-rows:67mm;gap:4mm 7mm;align-content:start}
        .label{width:60mm;height:67mm;border:0.35mm solid #bfcac4;border-radius:3mm;padding:3.2mm 3mm 2.5mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;break-inside:avoid;page-break-inside:avoid;overflow:hidden}
        .label .name{width:100%;height:8mm;display:flex;align-items:center;justify-content:center;font-size:13pt;font-weight:800;color:#174b3b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
        .label img{width:38mm;height:38mm;object-fit:contain;display:block;margin:1mm auto}
        .label .asset{font-size:9pt;font-weight:700;line-height:1.4}.label .brand{margin-top:1mm;font-size:7.5pt;color:#617068}
        @media print{.toolbar{display:none!important}.sheet{margin:0;width:194mm}.label{break-inside:avoid;page-break-inside:avoid}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">인쇄하기</button><span>A4 · 3열 × 4행 · 총 ${trees.length}개</span></div><main class="sheet">${labels.join('')}</main></body></html>`;
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      setStatus(`${title} ${trees.length}개를 A4 라벨 레이아웃으로 준비했습니다. 새 창에서 인쇄하세요.`, 'ok');
    } catch (e) {
      printWin.close();
      setStatus('QR 라벨을 만들지 못했습니다: ' + (e?.message || e), 'error');
    } finally {
      updateButtons();
    }
  }

  addStyle();
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (injectUI() || tries > 80) clearInterval(timer);
  }, 100);
})();
