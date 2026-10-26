/* 트리샘 - 기존 입목죽 관리대장 엑셀 일괄등록 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const client = window.forestSupabase;
  const visitor = window.forestDemoVisitor;
  const XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const REQUIRED_HEADERS = ['대장번호', '명칭'];
  const TEMPLATE_HEADERS = ['대장번호','명칭','재산종류','재산종목','재산구분','취득일자','취득금액','현재금액','학교·기관명','상세 위치','GPS 위도','GPS 경도','학교 배치도상의 위치'];
  const state = { file: null, rows: [], validated: false, errors: 0 };

  function addStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .bulk-import{margin-top:18px;padding:18px;border:1px solid #dce5df;border-radius:12px;background:#f8fbf9}
      .bulk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .bulk-head h3{margin:0;color:#174b3b;font-size:17px}.bulk-head p{margin:5px 0 0;color:#5f6662;font-size:13px;line-height:1.55}
      .bulk-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
      .bulk-actions button,.bulk-file-label{min-height:40px;padding:0 14px;border:1px solid #b9c7c0;border-radius:8px;background:#fff;color:#28443a;display:inline-flex;align-items:center;justify-content:center;font-weight:700;cursor:pointer}
      .bulk-actions .bulk-primary{background:#18533f;color:#fff;border-color:#18533f}.bulk-actions button:disabled{opacity:.45;cursor:not-allowed}
      .bulk-file-label input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
      .bulk-status{margin-top:12px;padding:11px 12px;border-radius:8px;background:#eef4f0;color:#425249;font-size:13px;line-height:1.55}
      .bulk-status.error{background:#fff0f0;color:#9f1f1f}.bulk-status.ok{background:#eaf8ef;color:#0f6534}
      .bulk-preview{margin-top:12px;overflow:auto;border:1px solid #e1e7e3;border-radius:8px;background:#fff;max-height:340px}
      .bulk-preview table{width:100%;border-collapse:collapse;font-size:12px;min-width:720px}.bulk-preview th,.bulk-preview td{padding:8px 9px;border-bottom:1px solid #edf0ee;text-align:left;white-space:nowrap}.bulk-preview th{position:sticky;top:0;background:#f4f8f5;color:#365548}.bulk-preview tr.bad{background:#fff5f5}.bulk-preview td.err{color:#b02525;font-weight:700;white-space:normal;min-width:220px}
      .bulk-note{margin-top:10px;color:#68716c;font-size:12px;line-height:1.55}
      @media(max-width:650px){.bulk-actions>*{flex:1 1 calc(50% - 8px)}.bulk-actions .bulk-primary{flex-basis:100%}}
    `;
    document.head.appendChild(style);
  }

  function injectUI() {
    const host = document.querySelector('.operations');
    if (!host || $('bulkImportPanel')) return false;
    const box = document.createElement('div');
    box.className = 'bulk-import';
    box.id = 'bulkImportPanel';
    box.innerHTML = `
      <div class="bulk-head">
        <div><h3>엑셀 일괄등록</h3><p>기존 입목죽 관리대장을 한 번에 업로드해 초기 구축 시간을 줄일 수 있습니다.</p></div>
      </div>
      <div class="bulk-actions">
        <button type="button" id="bulkTemplateButton">① 서식 다운로드</button>
        <label class="bulk-file-label">② 엑셀 파일 선택<input id="bulkFileInput" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"></label>
        <button type="button" id="bulkValidateButton" disabled>③ 오류 자동검증</button>
        <button type="button" id="bulkSaveButton" class="bulk-primary" disabled>④ 일괄 저장</button>
      </div>
      <div id="bulkStatus" class="bulk-status">먼저 서식을 내려받아 기존 관리대장 내용을 붙여넣거나, 같은 열 이름을 가진 엑셀 파일을 선택해 주세요.</div>
      <div id="bulkPreview" class="bulk-preview" hidden></div>
      <div class="bulk-note">필수항목: 대장번호, 명칭 · 취득일자: YYYY-MM-DD · 금액은 0 이상의 숫자 · GPS 위도 -90~90 / 경도 -180~180</div>`;
    host.appendChild(box);
    return true;
  }

  function setStatus(text, type = '') {
    const el = $('bulkStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'bulk-status' + (type ? ' ' + type : '');
  }

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_SRC;
      s.onload = resolve;
      s.onerror = () => reject(new Error('엑셀 처리 프로그램을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      document.head.appendChild(s);
    });
  }

  function safeText(v) { return v == null ? '' : String(v).trim(); }
  function numberValue(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const n = Number(String(v).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }
  function dateValue(v) {
    if (v === '' || v == null) return null;
    if (v instanceof Date && !isNaN(v)) return [v.getFullYear(), String(v.getMonth()+1).padStart(2,'0'), String(v.getDate()).padStart(2,'0')].join('-');
    if (typeof v === 'number' && window.XLSX?.SSF) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    const s = String(v).trim().replace(/[./]/g, '-');
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return '__INVALID__';
    const y = +m[1], mo = +m[2], d = +m[3];
    const test = new Date(y, mo-1, d);
    if (test.getFullYear() !== y || test.getMonth() !== mo-1 || test.getDate() !== d) return '__INVALID__';
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function downloadTemplate() {
    loadXlsx().then(() => {
      const sample = ['K-001','은행나무','행정재산','입목죽','교육용','2026-03-01',500000,500000,'전주○○초등학교','본관 정문 오른쪽 화단',35.8242,127.1480,'A-3 구역'];
      const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, sample]);
      ws['!cols'] = [14,14,14,14,14,14,14,14,22,30,14,14,22].map(w => ({wch:w}));
      const guide = XLSX.utils.aoa_to_sheet([
        ['트리샘 입목죽 일괄등록 안내'],
        ['필수항목','대장번호, 명칭'],
        ['취득일자','YYYY-MM-DD 형식 (예: 2026-10-26)'],
        ['금액','숫자만 입력, 0 이상'],
        ['GPS 위도','-90 ~ 90'],
        ['GPS 경도','-180 ~ 180'],
        ['주의','대장번호는 기존 시스템 및 업로드 파일 안에서 중복될 수 없습니다.']
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '입목죽 등록서식');
      XLSX.utils.book_append_sheet(wb, guide, '작성안내');
      XLSX.writeFile(wb, '트리샘_입목죽_일괄등록_서식.xlsx');
      setStatus('일괄등록 서식을 다운로드했습니다.', 'ok');
    }).catch(e => setStatus(e.message, 'error'));
  }

  async function readFile(file) {
    await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array', cellDates:true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('엑셀 첫 번째 시트를 읽을 수 없습니다.');
    const rows = XLSX.utils.sheet_to_json(sheet, { defval:'', raw:true });
    if (!rows.length) throw new Error('등록할 데이터가 없습니다.');
    const headers = Object.keys(rows[0]).map(h => String(h).trim());
    const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
    if (missing.length) throw new Error('필수 열이 없습니다: ' + missing.join(', '));
    return rows;
  }

  async function validateRows(rawRows) {
    if (!client) throw new Error('데이터베이스 연결이 준비되지 않았습니다. 페이지를 새로고침해 주세요.');
    const { data: existing, error } = await client.from('demo_trees').select('asset_no');
    if (error) throw error;
    const existingSet = new Set((existing || []).map(r => safeText(r.asset_no)).filter(Boolean));
    const fileSet = new Set();
    const result = [];
    rawRows.forEach((r, i) => {
      const rowNo = i + 2;
      const errors = [];
      const assetNo = safeText(r['대장번호']);
      const name = safeText(r['명칭']);
      if (!assetNo) errors.push('대장번호 누락');
      if (!name) errors.push('명칭 누락');
      if (assetNo && existingSet.has(assetNo)) errors.push('기존 대장번호와 중복');
      if (assetNo && fileSet.has(assetNo)) errors.push('파일 내부 대장번호 중복');
      if (assetNo) fileSet.add(assetNo);

      const acquisitionDate = dateValue(r['취득일자']);
      if (acquisitionDate === '__INVALID__') errors.push('취득일자 형식 오류');
      const acquisitionAmount = numberValue(r['취득금액']);
      const currentAmount = numberValue(r['현재금액']);
      if (Number.isNaN(acquisitionAmount) || (acquisitionAmount != null && acquisitionAmount < 0)) errors.push('취득금액 오류');
      if (Number.isNaN(currentAmount) || (currentAmount != null && currentAmount < 0)) errors.push('현재금액 오류');
      const lat = numberValue(r['GPS 위도']);
      const lng = numberValue(r['GPS 경도']);
      if (Number.isNaN(lat) || (lat != null && (lat < -90 || lat > 90))) errors.push('GPS 위도 오류');
      if (Number.isNaN(lng) || (lng != null && (lng < -180 || lng > 180))) errors.push('GPS 경도 오류');

      result.push({
        rowNo, errors,
        payload: {
          asset_no: assetNo,
          name,
          property_type: safeText(r['재산종류']) || null,
          property_item: safeText(r['재산종목']) || null,
          property_classification: safeText(r['재산구분']) || null,
          acquisition_date: acquisitionDate && acquisitionDate !== '__INVALID__' ? acquisitionDate : null,
          acquisition_amount: Number.isNaN(acquisitionAmount) ? null : acquisitionAmount,
          current_amount: Number.isNaN(currentAmount) ? null : currentAmount,
          organization_name: safeText(r['학교·기관명']) || null,
          detailed_location: safeText(r['상세 위치']) || null,
          latitude: Number.isNaN(lat) ? null : lat,
          longitude: Number.isNaN(lng) ? null : lng,
          school_map_location: safeText(r['학교 배치도상의 위치']) || null,
          visitor_token: visitor
        }
      });
    });
    return result;
  }

  function renderPreview(rows) {
    const el = $('bulkPreview');
    if (!rows.length) { el.hidden = true; return; }
    const shown = rows.slice(0, 50);
    el.innerHTML = `<table><thead><tr><th>행</th><th>대장번호</th><th>명칭</th><th>취득일자</th><th>학교·기관명</th><th>검증 결과</th></tr></thead><tbody>${shown.map(r => `<tr class="${r.errors.length ? 'bad':''}"><td>${r.rowNo}</td><td>${escapeHtml(r.payload.asset_no)}</td><td>${escapeHtml(r.payload.name)}</td><td>${escapeHtml(r.payload.acquisition_date || '')}</td><td>${escapeHtml(r.payload.organization_name || '')}</td><td class="${r.errors.length ? 'err':''}">${r.errors.length ? escapeHtml(r.errors.join(', ')) : '정상'}</td></tr>`).join('')}</tbody></table>${rows.length > 50 ? `<div style="padding:10px;font-size:12px;color:#666">처음 50행만 미리보기로 표시합니다. 전체 ${rows.length}행</div>`:''}`;
    el.hidden = false;
  }
  function escapeHtml(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function doValidate() {
    if (!state.file) return;
    const btn = $('bulkValidateButton');
    const save = $('bulkSaveButton');
    btn.disabled = true; save.disabled = true;
    setStatus('엑셀 파일을 읽고 오류를 검사하는 중입니다…');
    try {
      const raw = await readFile(state.file);
      const rows = await validateRows(raw);
      state.rows = rows;
      state.errors = rows.reduce((n,r) => n + r.errors.length, 0);
      state.validated = true;
      renderPreview(rows);
      const badRows = rows.filter(r => r.errors.length).length;
      if (badRows) {
        setStatus(`총 ${rows.length}행 중 ${badRows}행에서 오류가 발견되었습니다. 오류를 수정한 뒤 파일을 다시 선택해 검증해 주세요.`, 'error');
        save.disabled = true;
      } else {
        setStatus(`검증 완료: ${rows.length}행 모두 정상입니다. 이제 ‘일괄 저장’을 누르세요.`, 'ok');
        save.disabled = false;
      }
    } catch (e) {
      state.validated = false; state.rows = [];
      renderPreview([]);
      setStatus('검증 실패: ' + (e?.message || e), 'error');
    } finally { btn.disabled = false; }
  }

  async function bulkSave() {
    if (!state.validated || !state.rows.length || state.rows.some(r => r.errors.length)) return;
    const btn = $('bulkSaveButton');
    const validateBtn = $('bulkValidateButton');
    btn.disabled = true; validateBtn.disabled = true;
    let saved = 0;
    try {
      const payloads = state.rows.map(r => r.payload);
      for (let i=0; i<payloads.length; i+=100) {
        const chunk = payloads.slice(i, i+100);
        setStatus(`일괄 저장 중… ${Math.min(i+chunk.length, payloads.length)} / ${payloads.length}행`);
        const { error } = await client.from('demo_trees').insert(chunk);
        if (error) throw error;
        saved += chunk.length;
      }
      setStatus(`${saved}건을 일괄 저장했습니다. 목록을 새로 불러옵니다.`, 'ok');
      setTimeout(() => location.reload(), 700);
    } catch (e) {
      setStatus(`일괄 저장 중 오류가 발생했습니다. ${saved}건까지 저장되었을 수 있습니다. 새로고침 후 대장번호 중복 여부를 확인해 주세요. 오류: ${e?.message || e}`, 'error');
      btn.disabled = false; validateBtn.disabled = false;
    }
  }

  function wire() {
    $('bulkTemplateButton').addEventListener('click', downloadTemplate);
    $('bulkFileInput').addEventListener('change', e => {
      state.file = e.target.files?.[0] || null;
      state.rows = []; state.validated = false; state.errors = 0;
      $('bulkSaveButton').disabled = true;
      $('bulkValidateButton').disabled = !state.file;
      $('bulkPreview').hidden = true;
      setStatus(state.file ? `선택한 파일: ${state.file.name} · ‘오류 자동검증’을 눌러 주세요.` : '파일을 선택해 주세요.');
    });
    $('bulkValidateButton').addEventListener('click', doValidate);
    $('bulkSaveButton').addEventListener('click', bulkSave);
  }

  function start() {
    addStyle();
    if (injectUI()) { wire(); return; }
    let count = 0;
    const timer = setInterval(() => {
      count++;
      if (injectUI()) { clearInterval(timer); wire(); }
      else if (count > 40) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
