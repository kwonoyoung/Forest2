/* 트리샘 EcoLenses — 기본 생태 상태 분석 화면, 측정 도구, 트리샘 관리 연동 */
(() => {
  'use strict';
  const E = window.EcoAnalysis;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => Math.round((v || 0) * 100) + '%';
  const client = window.forestSupabase || null;
  const state = { trees: [], tree: null, last: null, baseData: null, mapOn: true, compareToken: 0 };

  /* ---------------- 촬영 방식 ---------------- */
  const MODE_HINT = {
    tree: '나무 전체나 잎이 무성한 부분을 화면 가득 찍어 주세요.',
    leaf: '잎 몇 장을 가까이(20~30cm) 찍으면 반점까지 셉니다.',
    sky: '나무 바로 아래에서 휴대폰을 하늘로 향해 찍으면 잎·가지가 하늘을 가린 비율(수관 피복률)을 잽니다.'
  };
  const MODE_NAME = { tree: '나무 전체', leaf: '잎 가까이', sky: '하늘 향해' };
  const mode = () => document.querySelector('input[name="shotMode"]:checked')?.value || 'tree';
  document.querySelectorAll('input[name="shotMode"]').forEach(r => r.addEventListener('change', () => {
    $('modeHint').textContent = MODE_HINT[mode()];
    if ($('localResult').classList.contains('show')) runLocal();
  }));
  $('modeHint').textContent = MODE_HINT.tree;

  /* ---------------- 이미지 → 픽셀 ---------------- */
  function pixelsOf(img, max) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    return x.getImageData(0, 0, c.width, c.height);
  }

  /* ---------------- 결과 그리기 ---------------- */
  const METRIC_INFO = {
    green: ['녹색 식생', '사진에서 초록 잎으로 보이는 부분의 비율'],
    yellow: ['노란 잎', '노랗게 변한 잎. 물·영양 부족이나 단풍의 신호'],
    autumn: ['단풍색', '선명한 주황·빨강 잎. 가을에는 자연스러운 변화'],
    brown: ['잎 갈변', '잎 사이에서 마르거나 갈색으로 변한 부분(줄기·흙은 최대한 뺌)'],
    brightness: ['평균 밝기', '사진 전체의 밝기. 너무 어둡거나 밝으면 결과가 흔들림'],
    canopy: ['수관 피복률', '하늘을 향해 찍었을 때 잎·가지가 하늘을 가린 비율'],
    spots: ['잎 반점', '잎 위에서 찾은 갈색·검은 얼룩(벌레 무리·병반)의 개수'],
    pale: ['흰 잔점·탈색', '잎 위 하얗게 바랜 작은 점. 흡즙 해충·흰가루병의 신호'],
    vitality: ['추정 활력도', '위 지표를 합쳐 계산한 종합 점수']
  };
  function metricCard(key, valueText, ratio) {
    const [k, d] = METRIC_INFO[key];
    const bar = ratio == null ? '' : `<div class="bar"><i style="width:${Math.max(0, Math.min(100, ratio * 100))}%"></i></div>`;
    return `<div class="metric"><div class="v">${valueText}</div><div class="k">${k}</div>${bar}<div class="d">${d}</div></div>`;
  }

  function drawMap() {
    const r = state.last; if (!r) return;
    const c = $('mapCanvas'), x = c.getContext('2d');
    c.width = r.width; c.height = r.height;
    const px = state.mapOn ? E.overlayPixels(r, state.baseData) : state.baseData;
    x.putImageData(new ImageData(new Uint8ClampedArray(px), r.width, r.height), 0, 0);
    if (state.mapOn && r.spotList.length) {
      x.lineWidth = Math.max(2, r.width / 260); x.strokeStyle = '#ff2d55';
      r.spotList.forEach(s => { x.beginPath(); x.arc(s.x, s.y, s.r + 3, 0, Math.PI * 2); x.stroke(); });
    }
    $('mapToggle').textContent = state.mapOn ? '원본 사진 보기' : '분석 지도 보기';
    $('mapLegend').classList.toggle('hidden', !state.mapOn);
  }
  $('mapToggle').onclick = () => { state.mapOn = !state.mapOn; drawMap(); };

  function interpret(r) {
    const m = r.metrics, md = r.mode;
    let summary, detail, tips;
    if (md === 'sky') {
      const cov = m.canopyCover;
      summary = `잎과 가지가 하늘의 ${pct(cov)}를 가리고 있습니다.`;
      detail = cov >= 0.6 ? '수관이 빽빽한 편입니다. 그늘과 생태적 가치가 큰 상태입니다.' : cov >= 0.4 ? '수관이 보통 수준입니다. 계절(잎이 나는 시기)을 함께 고려해 주세요.' : '하늘이 많이 보입니다. 낙엽기이거나 가지 고사·과도한 전정일 수 있습니다.';
      tips = ['같은 자리·같은 방향에서 계절마다 촬영', '하늘이 많이 보이는 쪽 가지의 고사 여부 확인', '흐린 날 찍으면 하늘 구분이 더 정확'];
    } else if (m.plantRatio >= 0.08 && md === 'leaf' && m.spots >= 5) {
      summary = `잎에 검은·갈색 점이 ${m.spots}개 보입니다.`;
      detail = '진딧물·깍지벌레 같은 작은 벌레 무리이거나, 점무늬병·탄저병 같은 병반일 수 있습니다. 점이 움직이거나 손으로 밀리면 벌레, 잎 조직이 변한 것이면 병반입니다.';
      tips = ['돋보기로 점이 벌레인지 병반인지 확인', '잎 뒷면과 새순 끝 확인(진딧물이 모이는 곳)', '끈적한 물질·개미가 있는지 확인', '"AI 병해충 진단"으로 후보 확인'];
    } else if (m.plantRatio >= 0.08 && ((m.paleDensity || 0) >= 150 || (m.pale || 0) >= 0.05)) {
      summary = '잎에 하얗게 바랜 잔점이 많이 보입니다.';
      detail = '방패벌레·응애·매미충 같은 흡즙 해충이 즙을 빨아 먹은 자리이거나, 흰가루병 초기일 수 있습니다.';
      tips = ['잎 뒷면에 작은 벌레·검은 배설물·허물이 있는지 확인', '손가락으로 문질러 흰 가루가 묻어나는지 확인(흰가루병)', '같은 수종의 주변 나무도 확인', '"AI 병해충 진단"으로 후보 확인'];
    } else if (m.plantRatio < 0.08) {
      summary = '녹색 식생 영역이 적게 감지되었습니다.';
      detail = '수간·낙엽·꽃·겨울철 수목일 수 있으므로 잎이나 수관이 더 크게 보이게 다시 찍으면 좋습니다.';
      tips = ['잎 또는 수관을 가까이 촬영', '역광을 피해 자연광에서 촬영', '수피·열매·꽃 사진도 함께 확보'];
    } else if (m.brown / m.plantRatio > 0.15) {
      summary = '갈변·건조색 영역이 비교적 많이 관찰됩니다.';
      detail = '계절적 변화일 수도 있으나 잎 마름, 수분 부족, 병해충 여부를 현장에서 확인해 주세요.';
      tips = ['잎 뒷면과 가지 끝 확인', '토양 수분·배수 상태 확인', '반점·구멍·해충 흔적 확인'];
    } else if ((m.yellow + m.autumn) / m.plantRatio > 0.18 && m.autumnSeason) {
      summary = '가을 단풍이 들고 있습니다.';
      detail = '노란·주황 잎은 낙엽수가 겨울을 준비하는 자연스러운 변화입니다. 같은 시기 다른 나무보다 유난히 빠르거나 잎이 말라 떨어진다면 확인이 필요합니다.';
      tips = ['같은 수종의 다른 나무와 단풍 시기 비교', '갈색으로 말라 붙은 잎이 많은지 확인', '내년 봄 새잎이 나면 다시 촬영해 비교'];
    } else if ((m.yellow + m.autumn) / m.plantRatio > 0.18) {
      summary = '노랗거나 주황으로 변한 잎이 눈에 띕니다.';
      detail = '생장기(봄·여름)라면 물 부족, 배수 불량, 영양 부족을 의심해 볼 수 있습니다.';
      tips = ['같은 나무의 다른 가지와 비교', '최근 가뭄·과습 여부 확인', '주변 같은 수종의 잎 색 비교'];
    } else if (m.vitality > 0.62) {
      summary = '사진상 녹색 식생과 활력이 비교적 양호합니다.';
      detail = '현재 사진에서는 뚜렷한 갈변·황화 신호가 크게 나타나지 않습니다.';
      tips = ['정기 점검 사진 누적', '수관 고사 가지 확인', '계절별 변화 비교'];
    } else {
      summary = '보통 수준의 식생 상태로 추정됩니다.';
      detail = '사진만으로 단정하기 어려우므로 잎·가지·수피 상태를 함께 확인해 주세요.';
      tips = ['가까운 잎 사진 추가(잎 가까이 방식)', '나무 아래에서 하늘 사진 추가(수관 방식)', '이상 부위가 있다면 확대 촬영'];
    }
    if (md === 'tree') tips = tips.concat('병해충이 의심되면 피해 부위를 가까이 찍고 "잎 가까이"로 다시 분석');
    if (md === 'leaf' && m.spots < 5) {
      detail += m.spots ? ` 잎에서 반점 ${m.spots}개를 찾았습니다(지도에 빨간 원).` : ' 잎에서 뚜렷한 반점은 찾지 못했습니다.';
    }
    return { summary, detail, tips };
  }

  const STATUS_CLASS = { '양호': 'st-good', '보통': 'st-fair', '주의': 'st-warn', '위험': 'st-bad' };
  const LEVELS = ['양호', '보통', '주의', '위험'];

  /* 눈으로 본 증상 체크 → 단계 */
  function checklist() {
    const items = [...document.querySelectorAll('#symptomList input:checked')].map(x => ({ label: x.dataset.label, w: +x.dataset.w, report: x.dataset.report === '1' }));
    const sum = items.reduce((a, b) => a + b.w, 0), maxW = items.reduce((a, b) => Math.max(a, b.w), 0);
    const level = !items.length ? -1 : (maxW >= 3 || sum >= 5) ? 3 : sum >= 3 ? 2 : 1;
    return { items, level, report: items.some(i => i.report) };
  }
  document.querySelectorAll('#symptomList input').forEach(x => x.addEventListener('change', () => { if (state.last) renderRecommendation(state.last); }));

  /* 사진 색 + 증상 체크 + AI 병해충 진단을 합친 최종 추천 */
  function finalRec(r) {
    const base = r.recommendation, ck = checklist(), ai = state.pest;
    let level = base.status ? LEVELS.indexOf(base.status) : -1;
    const reasons = base.reasons.map(x => '[사진 색] ' + x);
    if (ck.level >= 0) { level = Math.max(level, ck.level); reasons.push('[증상 체크] ' + ck.items.map(i => i.label).join(', ')); }
    if (ai && LEVELS.includes(ai.status)) { level = Math.max(level, LEVELS.indexOf(ai.status)); reasons.push('[AI 병해충 진단] ' + (ai.summaryLine || ai.status)); }
    const report = ck.report || !!(ai && ai.report && ai.report.needed);
    const onlyColor = ck.level < 0 && !ai;
    const status = level >= 0 ? LEVELS[level] : null;
    return { status, label: status ? (onlyColor && level <= 1 ? status + ' (색 기준)' : status) : base.label, reasons, report, onlyColor };
  }

  /* 사진 색·증상 체크로 짐작한 검색어 (AI 진단 전) */
  function guessKeywords(r) {
    const m = r.metrics, k = [];
    const ck = checklist().items.map(i => i.label);
    if (ck.some(l => /소나무|솔잎/.test(l))) k.push('소나무재선충병');
    if (ck.some(l => /흰 가루/.test(l))) k.push('흰가루병');
    if (ck.some(l => /거미줄/.test(l))) k.push('미국흰불나방');
    if (ck.some(l => /벌레가 모여|끈적/.test(l))) k.push('진딧물');
    if (ck.some(l => /줄기·가지 구멍/.test(l))) k.push('천공성 해충');
    if ((m.paleDensity || 0) >= 150 || ck.some(l => /하얗게 바래/.test(l))) k.push('방패벌레');
    if (r.mode === 'leaf' && m.spots >= 5) k.push('점무늬병');
    return [...new Set(k)];
  }

  function renderRecommendation(r) {
    const rec = finalRec(r);
    state.final = rec;
    $('recBadge').textContent = rec.label;
    $('recBadge').className = 'recBadge ' + (STATUS_CLASS[rec.status] || 'st-hold');
    $('recReasons').innerHTML = rec.reasons.map(x => `<li>${esc(x)}</li>`).join('');
    $('recCaution').innerHTML = rec.report ? '<b>신고 대상 병해충이 의심됩니다.</b> 소나무재선충병 같은 법정 병해충은 나무를 임의로 베거나 옮기지 말고, 시·군·구 산림 담당 부서에 신고해 주세요.' : rec.onlyColor && rec.status && LEVELS.indexOf(rec.status) <= 1 ? '사진 색만 본 결과입니다. 벌레·구멍·거미줄·흰 가루처럼 색으로 드러나지 않는 병해충은 놓칠 수 있으니, 아래 증상 체크나 AI 병해충 진단을 함께 해 주세요.' : '';
    $('recCaution').className = 'recCaution' + (rec.report ? ' alert' : '') + ($('recCaution').innerHTML ? '' : ' hidden');
    const lv = rec.status ? LEVELS.indexOf(rec.status) : -1;
    const kw = state.pest && arr(state.pest.suspects).length ? arr(state.pest.suspects).map(x => x.name) : guessKeywords(r);
    $('recSources').innerHTML = lv >= 1 || checklist().level >= 0 ? sourcesPanel(kw) : '';
    const btn = $('sendInspection'), hint = $('recHint');
    if (!rec.status) { btn.classList.add('hidden'); hint.textContent = '다시 촬영하거나 증상을 체크하면 점검 상태를 추천해 드립니다.'; return; }
    if (state.tree) { btn.classList.remove('hidden'); hint.textContent = `'${state.tree.name}' 점검일지에 이 상태와 사진을 넣어 엽니다. 저장 전에 내용을 확인·수정할 수 있습니다.`; }
    else { btn.classList.add('hidden'); hint.textContent = '위쪽 "분석할 나무"를 고르면 점검일지로 바로 보낼 수 있습니다.'; }
  }

  function render(r) {
    const m = r.metrics;
    $('ecoScore').textContent = m.score;
    // 촬영 품질
    const q = r.quality, qb = $('qualityBox');
    qb.className = 'quality ' + (q.ok ? 'ok' : 'warn');
    qb.innerHTML = q.ok ? '<b>촬영 품질 좋음</b> 밝기와 선명도가 분석하기에 알맞습니다.' : '<b>다시 찍으면 더 정확해요</b><ul>' + q.issues.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>';
    // 지표
    const cards = [metricCard('green', pct(m.green), m.green), metricCard('yellow', pct(m.yellow), m.yellow), metricCard('autumn', pct(m.autumn), m.autumn), metricCard('brown', pct(m.brown), m.brown), metricCard('pale', `${pct(m.pale)}<small>${m.paleSpots}점</small>`, Math.min(1, (m.pale || 0) * 4))];
    if (r.mode === 'sky') cards.push(metricCard('canopy', pct(m.canopyCover), m.canopyCover));
    else if (r.mode === 'leaf') cards.push(metricCard('spots', m.spots + '개', Math.min(1, m.spots / 20)));
    else cards.push(metricCard('brightness', pct(m.brightness), m.brightness));
    cards.push(metricCard('vitality', pct(m.vitality), m.vitality));
    $('metricGrid').innerHTML = cards.join('');
    $('modeTag').textContent = MODE_NAME[r.mode];
    // 해석
    const t = interpret(r);
    $('summary').textContent = t.summary; $('detail').textContent = t.detail;
    $('tips').innerHTML = t.tips.map(x => `<li>${esc(x)}</li>`).join('');
    renderRecommendation(r);
    drawMap();
  }

  async function runLocal() {
    const img = $('preview');
    if (!img.naturalWidth) return;
    const data = pixelsOf(img, 720);
    state.baseData = data.data;
    if (state.lastSrc !== img.src) { state.pest = null; $('pestResult').classList.remove('show'); document.querySelectorAll('#symptomList input').forEach(x => { x.checked = false; }); state.lastSrc = img.src; }
    state.last = E.analyze(data, mode());
    state.mapOn = true;
    render(state.last);
    $('localResult').classList.add('show');
    loadCompare();
    return state.last;
  }
  $('localAnalyzeBtn').onclick = async () => {
    await runLocal();
    $('localResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------------- 트리샘 수목 선택 ---------------- */
  async function loadTrees() {
    const sel = $('treeSelect');
    if (!client) { sel.disabled = true; $('treeNote').textContent = '수목 목록을 불러오지 못했습니다(연결 준비 실패).'; return; }
    const { data, error } = await client.from('demo_trees_public').select('id,asset_no,name,photo_url').order('asset_no');
    if (error) { $('treeNote').textContent = '수목 목록을 불러오지 못했습니다.'; return; }
    state.trees = data || [];
    sel.innerHTML = '<option value="">선택 안 함</option>' + state.trees.map(t => `<option value="${esc(t.id)}">${esc(t.name || '(이름 없음)')} · ${esc(t.asset_no || '')}</option>`).join('');
    const want = new URLSearchParams(location.search).get('tree');
    if (want && state.trees.some(t => t.id === want)) { sel.value = want; onTree(); }
  }
  function onTree() {
    state.tree = state.trees.find(t => t.id === $('treeSelect').value) || null;
    $('treeNote').textContent = state.tree ? '분석하면 이 나무의 지난 사진과 비교하고, 점검일지로 보낼 수 있습니다.' : '고르면 지난 기록과 비교하고 점검일지로 보낼 수 있습니다.';
    if (state.last) { renderRecommendation(state.last); loadCompare(); }
  }
  $('treeSelect').addEventListener('change', onTree);

  /* ---------------- 점검일지로 보내기 ---------------- */
  $('sendInspection').onclick = () => {
    const r = state.last, fin = state.final || finalRec(r); if (!r || !state.tree || !fin.status) return;
    const m = r.metrics, today = new Date().toLocaleDateString('ko-KR');
    const parts = [`활력도 ${m.score}점`, `녹색 ${pct(m.green)}`, `노란 잎 ${pct(m.yellow)}`, `갈변 ${pct(m.brown)}`];
    if (r.mode === 'sky') parts.push(`수관 피복률 ${pct(m.canopyCover)}`);
    if (r.mode === 'leaf') parts.push(`잎 반점 ${m.spots}개`);
    if (m.paleSpots) parts.push(`흰 잔점 ${m.paleSpots}점(${pct(m.pale)})`);
    let note = `[생태 분석기 ${today} · ${MODE_NAME[r.mode]}] ${parts.join(', ')}. 추천 ${fin.status}: ${fin.reasons.join(' ')}`;
    if (state.pest && state.pest.suspects && state.pest.suspects.length) note += ` 의심 병해충: ${state.pest.suspects.map(x => x.name + (x.likelihood != null ? `(${x.likelihood}%)` : '')).join(', ')}.`;
    if (fin.report) note += ' ※ 신고 대상 병해충 의심 — 산림 담당 부서 신고 필요.';
    let photo = null;
    try { const img = $('preview'), c = document.createElement('canvas'), s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL('image/jpeg', 0.85); } catch (e) { photo = null; }
    const payload = { treeId: state.tree.id, status: fin.status, note, photo, at: Date.now() };
    try { sessionStorage.setItem('treesamEcoHandoff', JSON.stringify(payload)); }
    catch (e) { payload.photo = null; try { sessionStorage.setItem('treesamEcoHandoff', JSON.stringify(payload)); } catch (e2) { /* 저장 공간 부족 */ } }
    location.href = 'inspection.html?tree=' + encodeURIComponent(state.tree.id) + '&from=eco';
  };

  /* ---------------- 같은 나무 시기별 비교 ---------------- */
  function loadImage(url) {
    return new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => no(new Error('사진을 열 수 없습니다.')); i.src = url; });
  }
  async function loadCompare() {
    const box = $('compareBox'), token = ++state.compareToken;
    if (!state.tree || !state.last) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('compareBody').innerHTML = '<p class="muted">지난 사진을 불러와 같은 방법으로 분석하는 중입니다…</p>';
    const sources = [];
    if (state.tree.photo_url) sources.push({ label: '등록 사진', date: null, status: null, url: state.tree.photo_url });
    let loggedIn = false;
    if (client) {
      try {
        const { data: s } = await client.auth.getSession();
        loggedIn = !!s?.session;
        if (loggedIn) {
          const { data } = await client.from('demo_tree_management_logs').select('inspection_date,inspection_status,state_photo_url').eq('tree_id', state.tree.id).order('inspection_date', { ascending: true });
          (data || []).forEach(l => { if (l.state_photo_url) sources.push({ label: '점검', date: l.inspection_date, status: l.inspection_status, url: l.state_photo_url }); });
        }
      } catch (e) { /* 비교는 가능한 범위에서만 */ }
    }
    const rows = [];
    for (const s of sources.slice(-12)) {
      try { const img = await loadImage(s.url); const r = E.analyze(pixelsOf(img, 360), 'tree'); rows.push({ ...s, score: r.metrics.score, green: r.metrics.green, brown: r.metrics.brown, yellow: r.metrics.yellow }); }
      catch (e) { /* 열 수 없는 사진은 건너뜀 */ }
      if (token !== state.compareToken) return;
    }
    const now = state.last.metrics;
    rows.push({ label: '오늘', date: new Date().toISOString().slice(0, 10), status: state.last.recommendation.status, score: now.score, green: now.green, brown: now.brown, yellow: now.yellow, today: true });
    renderCompare(rows, loggedIn);
  }
  function renderCompare(rows, loggedIn) {
    const body = $('compareBody');
    const note = loggedIn ? '' : '<p class="muted">로그인한 관리자는 점검일지 사진까지 함께 비교됩니다. <a href="dashboard/">관리자 로그인</a></p>';
    if (rows.length < 2) { body.innerHTML = '<p class="muted">비교할 지난 사진이 아직 없습니다. 점검일지에 사진을 남기면 다음부터 변화를 볼 수 있습니다.</p>' + note; return; }
    const W = Math.round(Math.min(560, Math.max(300, body.clientWidth || 560))), H = 190, pl = 34, pr = 12, pt = 14, pb = 34, n = rows.length;
    const X = i => pl + (n === 1 ? 0 : i * (W - pl - pr) / (n - 1)), Y = v => pt + (1 - v / 100) * (H - pt - pb);
    const line = key => rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(key === 'score' ? r.score : r[key] * 100).toFixed(1)}`).join(' ');
    const grid = [0, 50, 100].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    const labels = rows.map((r, i) => `<text x="${X(i)}" y="${H - 12}" text-anchor="middle">${esc(r.today ? '오늘' : (r.date ? r.date.slice(2).replace(/-/g, '.') : '등록'))}</text>`).join('');
    const dots = rows.map((r, i) => `<circle cx="${X(i)}" cy="${Y(r.score)}" r="${r.today ? 5.5 : 4}" class="ds${r.today ? ' now' : ''}"/>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="시기별 추정 활력도와 녹색 식생 변화">${grid}<path d="${line('green')}" class="lg"/><path d="${line('score')}" class="ls"/>${dots}${labels}</svg>`;
    const first = rows[0], last = rows[rows.length - 1], diff = last.score - first.score;
    const trend = Math.abs(diff) < 6 ? `처음 기록과 비교해 활력도가 비슷합니다(${diff >= 0 ? '+' : ''}${diff}점).` : diff > 0 ? `처음 기록보다 활력도가 ${diff}점 높아졌습니다.` : `처음 기록보다 활력도가 ${-diff}점 낮아졌습니다. 계절 차이인지 함께 확인해 주세요.`;
    const table = '<table><thead><tr><th>시기</th><th>점검 상태</th><th>활력도</th><th>녹색</th><th>갈변</th></tr></thead><tbody>' + rows.slice().reverse().map(r => `<tr${r.today ? ' class="now"' : ''}><td>${esc(r.today ? '오늘(분석)' : r.date || '등록 사진')}</td><td>${esc(r.status || '-')}</td><td>${r.score}</td><td>${pct(r.green)}</td><td>${pct(r.brown)}</td></tr>`).join('') + '</tbody></table>';
    body.innerHTML = `<p class="trend">${esc(trend)}</p><div class="chartWrap">${svg}<div class="chartKey"><span class="ks"></span>추정 활력도 <span class="kg"></span>녹색 식생(%)</div></div><div class="tableWrap">${table}</div><p class="muted">지난 사진은 '나무 전체' 방식으로 다시 분석합니다. 찍은 거리·계절·날씨가 다르면 차이가 날 수 있습니다.</p>${note}`;
  }

  /* ---------------- 측정 도구: 둘레 → 지름·나이·탄소 ---------------- */
  function calcTrunk() {
    const g = parseFloat($('girth').value), h = parseFloat($('treeH').value), grp = $('growth').value;
    const out = $('trunkOut');
    if (!(g > 0)) { out.innerHTML = '<p class="muted">가슴 높이(약 1.2m)에서 줄자로 잰 줄기 둘레를 입력하세요.</p>'; return; }
    const d = E.trunkFromGirth(g), age = E.estimateAge(d, grp), c = E.estimateCarbon(d, h);
    out.innerHTML = `<div class="mgrid"><div class="metric"><div class="v">${d.toFixed(1)}<small>cm</small></div><div class="k">흉고직경(지름)</div><div class="d">둘레 ÷ 원주율(3.14)</div></div>
      <div class="metric"><div class="v">약 ${age}<small>년</small></div><div class="k">추정 나이</div><div class="d">지름(인치) × 생장계수 ${E.GROWTH[grp]}</div></div>
      <div class="metric"><div class="v">${c ? Math.round(c.co2Kg).toLocaleString() + '<small>kg</small>' : '-'}</div><div class="k">저장한 이산화탄소</div><div class="d">${c ? `탄소 약 ${Math.round(c.carbonKg).toLocaleString()}kg (뿌리 포함)` : '나무 높이를 넣으면 계산합니다'}</div></div></div>
      <p class="muted">나이와 탄소량은 일반 식으로 계산한 대략적인 추정치입니다. 수종·생육 환경에 따라 실제와 크게 다를 수 있습니다.</p>`;
  }
  ['girth', 'treeH', 'growth'].forEach(id => $(id).addEventListener('input', calcTrunk));
  calcTrunk();

  /* ---------------- 측정 도구: 기울기로 나무 높이 ---------------- */
  let liveAngle = null, sensorOn = false, stream = null;
  function onOrient(e) {
    if (e.beta == null) return;
    liveAngle = e.beta - 90; // 휴대폰을 세워 들고 위로 기울이면 0°에서 커집니다
    $('angleLive').textContent = (liveAngle > 0 ? liveAngle.toFixed(1) : '0.0') + '°';
  }
  $('sensorBtn').onclick = async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission(); if (p !== 'granted') throw new Error('기울기 센서 사용을 허용해 주세요.');
      }
      if (!('DeviceOrientationEvent' in window)) throw new Error('이 기기에서는 기울기 센서를 쓸 수 없습니다. 각도를 직접 입력해 주세요.');
      if (!sensorOn) { window.addEventListener('deviceorientation', onOrient); sensorOn = true; }
      $('sensorState').textContent = '센서 켜짐: 휴대폰을 세워 들고 나무 꼭대기를 겨눈 뒤 "각도 고정"을 누르세요.';
      $('lockAngle').disabled = false;
      setTimeout(() => { if (liveAngle == null) $('sensorState').textContent = '센서 값이 들어오지 않습니다. PC라면 각도를 직접 입력해 주세요.'; }, 1500);
    } catch (e) { $('sensorState').textContent = e.message; }
  };
  $('lockAngle').onclick = () => { if (liveAngle != null && liveAngle > 0) { $('angle').value = liveAngle.toFixed(1); calcHeight(); } };
  $('camBtn').onclick = async () => {
    const box = $('camBox');
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; box.classList.add('hidden'); $('camBtn').textContent = '카메라로 조준'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      $('camVideo').srcObject = stream; box.classList.remove('hidden'); $('camBtn').textContent = '카메라 끄기';
      if (!sensorOn) $('sensorBtn').click();
    } catch (e) { $('sensorState').textContent = '카메라를 열 수 없습니다. 휴대폰 윗면을 나무 꼭대기에 맞춰 겨눠도 됩니다.'; }
  };
  function calcHeight() {
    const d = parseFloat($('dist').value), a = parseFloat($('angle').value), eye = parseFloat($('eye').value) || 0;
    const h = E.treeHeight(d, a, eye), out = $('heightOut');
    if (h == null) { out.innerHTML = '<p class="muted">나무까지 거리와 꼭대기를 올려다본 각도(0~89°)를 넣으면 높이를 계산합니다.</p>'; $('useHeight').classList.add('hidden'); return; }
    out.innerHTML = `<div class="bigResult">약 <b>${h.toFixed(1)}</b> m</div><p class="muted">계산: 거리 ${d}m × tan(${a}°) + 눈높이 ${eye}m. 나무와 같은 높이의 평평한 땅에서 재야 정확합니다.</p>`;
    $('useHeight').classList.remove('hidden'); $('useHeight').dataset.h = h.toFixed(1);
  }
  ['dist', 'angle', 'eye'].forEach(id => $(id).addEventListener('input', calcHeight));
  $('useHeight').onclick = () => { $('treeH').value = $('useHeight').dataset.h; calcTrunk(); $('trunkCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  calcHeight();

  /* ---------------- AI 병해충 진단 (Firebase AI Logic) ---------------- */
  const PEST_PROMPT = `당신은 대한민국 학교·도시 수목의 병해충을 진단하는 나무의사입니다. 사진을 보고 병해충 피해 여부를 판단하세요.
규칙:
- 사진에 실제로 보이는 증상만 근거로 삼고 과장하지 마세요. 증상이 없으면 overall은 '이상 없음', status는 '양호'로 답하세요.
- 확신이 없으면 likelihood를 낮게 주고 moreShots에 추가로 찍을 부위를 적으세요.
- 한국에서 통용되는 국명을 쓰세요. 학교 수목에 흔한 예: 미국흰불나방, 진딧물류, 깍지벌레류, 응애류, 방패벌레류(버즘나무방패벌레 등), 매미충류, 회양목명나방, 솔잎혹파리, 꽃매미, 하늘소·나무좀 같은 천공성 해충, 흰가루병, 탄저병, 점무늬병·갈색무늬병, 녹병, 그을음병, 소나무재선충병, 잎떨림병, 생리장해(햇볕데임·건조·과습·염해).
- 소나무재선충병처럼 법으로 신고해야 하는 병해충이 의심되면 report.needed를 true로 하세요.
- 진단 기준과 현장 조치는 농촌진흥청 국가농작물병해충관리시스템(NCPMS)·농사로, 산림청(산림병해충 방제 지침)의 내용에 맞게 쓰세요.
- 약제 이름과 사용량은 쓰지 말고, 약제가 필요하면 '농약안전정보시스템(PSIS)에서 해당 수목·병해충 등록 약제 확인 후, 나무병원·나무의사 상담을 거쳐 방제'로 안내하세요.
반드시 JSON 객체 하나만 반환하세요. 키:
overall: '이상 없음' | '의심' | '뚜렷함'
status: '양호' | '보통' | '주의' | '위험'
severity: '없음' | '경미' | '보통' | '심각'
suspects: [{name, type('해충'|'병'|'생리장해'|'기타'), likelihood(0~100 정수), evidence(사진에서 본 근거 한 문장)}] 최대 3개, 가능성 높은 순
parts: 피해가 보이는 부위 요약 한 문장
actions: 학교 현장에서 할 수 있는 조치 2~4개(짧은 문장 배열)
report: {needed(true/false), reason}
moreShots: 정확한 진단을 위해 추가로 찍으면 좋은 부위 1~3개(배열)
student: 학생이 이해하기 쉬운 2문장 설명
host: 사진 속 수목·식물의 추정 이름(모르면 빈 문자열)
control: 방제 요령 객체 {
  timing: 방제 적기(발생 시기·세대, 언제 하면 효과적인지) 한두 문장,
  monitoring: 예찰 방법(어디를 어떻게 살필지) 배열 1~3개,
  physical: 물리적·경종적 방제(가지·잎 제거, 포살, 끈끈이·유인 트랩, 낙엽 수거, 물주기·통풍 개선 등) 배열 2~4개,
  biological: 천적·생물적 방제 배열 0~2개,
  chemicalNeeded: '필요 없음' | '피해 확산 시 검토' | '필요',
  chemicalType: 약제가 필요하면 약제 종류만(예: '흡즙성 해충용 살충제', '흰가루병용 살균제'). 제품명·성분명·사용량은 쓰지 말 것,
  threshold: 약제 방제를 검토할 기준(피해 정도·밀도) 한 문장,
  prevention: 재발 방지 관리 배열 1~3개
}
psis: PSIS 검색용 {crop: 수목·작물 이름, pest: 병해충 이름}`;

  function waitAI() {
    return window.treesamAI ? Promise.resolve(window.treesamAI) : new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error('AI 연결 준비 시간이 초과되었습니다.')), 15000);
      document.addEventListener('treesam-ai-ready', () => { clearTimeout(t); ok(window.treesamAI); }, { once: true });
      document.addEventListener('treesam-ai-failed', () => { clearTimeout(t); no(new Error('AI 연결에 실패했습니다.')); }, { once: true });
    });
  }
  function photoBase64() {
    const img = $('preview'), c = document.createElement('canvas'), s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  function parseJson(t) { t = String(t || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); return JSON.parse(t.slice(a, b + 1)); }
  const arr = v => Array.isArray(v) ? v : v ? [v] : [];

  /* 진단·치료 정보는 아래 공공·전문 사이트를 우선 안내합니다 (사이트 안 검색으로 바로 연결) */
  const SOURCES = [
    { key: 'ncpms', name: 'NCPMS 병해충 정보', domain: 'ncpms.rda.go.kr', home: 'https://ncpms.rda.go.kr/npms/Main.np', note: '농촌진흥청 병해충 도감·진단' },
    { key: 'nongsaro', name: '농사로', domain: 'nongsaro.go.kr', home: 'https://www.nongsaro.go.kr/portal/portalMain.ps?menuId=PS00001', note: '농업기술 정보' },
    { key: 'forest', name: '산림청', domain: 'forest.go.kr', home: 'https://www.forest.go.kr/kfsweb/kfs/idx/Index.do', note: '산림병해충 방제·신고' },
    { key: 'psis', name: 'PSIS 등록 약제', domain: 'psis.rda.go.kr', home: 'https://psis.rda.go.kr/psis/', note: '농약안전정보시스템' }
  ];
  const MORE_SOURCES = [
    { name: '나무병원119', home: 'http://www.xn--119-9g1mm83b2kc2z1a.kr', note: '수목 진료' },
    { name: 'plant119', home: 'https://www.plant119.kr', note: '식물 상담' },
    { name: '남부지방산림청', home: 'https://south.forest.go.kr', note: '지역 산림 행정' },
    { name: '산림청 ftims', home: 'https://ftims.forest.go.kr/', note: '산림 정보시스템' },
    { name: '한국작물보호협회', home: 'https://www.koreacpa.org/en/kcpa/introduction/', note: '작물보호·농약' }
  ];
  const siteSearch = (domain, q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:' + domain + ' ' + q);
  const cleanName = n => String(n || '').replace(/\(.*?\)/g, '').replace(/류$/, '').trim();
  function sourceLinks(keyword) {
    const k = cleanName(keyword);
    return '<div class="srcRow">' + SOURCES.map(x => `<a class="srcChip" href="${k ? siteSearch(x.domain, k + (x.key === 'psis' ? ' 등록 약제' : '')) : x.home}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join('') + '</div>';
  }
  function sourcesPanel(keywords) {
    const ks = keywords.map(cleanName).filter(Boolean).slice(0, 3);
    const rows = ks.length ? ks.map(k => `<div class="srcItem"><b>${esc(k)}</b>${sourceLinks(k)}</div>`).join('') : `<div class="srcItem">${sourceLinks('')}</div>`;
    return `<div class="srcBox"><h4>공식 정보로 확인하기</h4><p class="muted">진단·방제는 아래 공공·전문 사이트 정보를 먼저 확인하세요. 약제는 PSIS에서 해당 수목·병해충 등록 여부를 확인한 뒤 나무병원·나무의사와 상담해 사용합니다.</p>${rows}<div class="srcMore">${MORE_SOURCES.map(x => `<a href="${x.home}" target="_blank" rel="noopener">${esc(x.name)}<small>${esc(x.note)}</small></a>`).join('')}</div></div>`;
  }

  const CHEM_CLASS = { '필요 없음': 'st-good', '피해 확산 시 검토': 'st-warn', '필요': 'st-bad' };
  const list = a => arr(a).length ? `<ul class="tips">${arr(a).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  function hostName(j) { return state.speciesFix || (state.tree && state.tree.name) || (j && j.host) || ($('species') && $('species').firstChild && $('species').firstChild.textContent.trim() !== '-' ? $('species').firstChild.textContent.trim() : '') || ''; }
  function controlHtml(j) {
    const c = j.control || {}; if (!Object.keys(c).length) return '';
    const pestName = cleanName((j.psis && j.psis.pest) || (arr(j.suspects)[0] || {}).name || '');
    const crop = cleanName((j.psis && j.psis.crop) || hostName(j));
    const psisQ = [crop, pestName].filter(Boolean).join(' ');
    const chem = c.chemicalNeeded || '';
    return `<div class="ctrlBox"><h4>방제 요령</h4>
      ${c.timing ? `<p class="ctrlTiming"><b>방제 적기</b> ${esc(c.timing)}</p>` : ''}
      <div class="ctrlGrid">
        ${arr(c.monitoring).length ? `<div><h5>살펴볼 곳 (예찰)</h5>${list(c.monitoring)}</div>` : ''}
        ${arr(c.physical).length ? `<div><h5>약 없이 하는 방제</h5>${list(c.physical)}</div>` : ''}
        ${arr(c.biological).length ? `<div><h5>천적·생물적 방제</h5>${list(c.biological)}</div>` : ''}
        ${arr(c.prevention).length ? `<div><h5>재발 방지</h5>${list(c.prevention)}</div>` : ''}
      </div></div>
      <div class="chemBox"><div class="chemTop"><h4>약제 방제 안내</h4>${chem ? `<span class="recBadge ${CHEM_CLASS[chem] || 'st-hold'}">${esc(chem)}</span>` : ''}</div>
        ${c.chemicalType && chem !== '필요 없음' ? `<p><b>약제 종류</b> ${esc(c.chemicalType)}</p>` : ''}
        ${c.threshold ? `<p><b>약제를 검토할 기준</b> ${esc(c.threshold)}</p>` : ''}
        <ol class="chemSteps">
          <li><b>등록 약제 확인</b> — 농약안전정보시스템(PSIS)에서 ${esc(psisQ || '해당 수목·병해충')}에 등록된 약제만 쓸 수 있습니다. <a class="srcChip" href="${siteSearch('psis.rda.go.kr', (psisQ || '수목') + ' 등록 약제')}" target="_blank" rel="noopener">PSIS에서 찾기</a> <a href="https://psis.rda.go.kr/psis/" target="_blank" rel="noopener">PSIS 바로가기</a></li>
          <li><b>처방·시행</b> — 학교 수목 방제를 업체에 맡길 때는 등록된 나무병원(나무의사)을 통해야 합니다(산림보호법 제21조의9). 처방전에 따라 약제·사용량·횟수를 정합니다.</li>
          <li><b>라벨 기준 준수</b> — 제품 라벨의 사용량·희석 배수·안전사용기준을 그대로 지키고, 다른 약을 임의로 섞지 않습니다.</li>
        </ol>
        <h5>학교에서 약제를 뿌릴 때</h5>
        <ul class="tips"><li>학생이 없는 시간(방과 후·주말)에, 바람이 약하고 비 예보가 없는 날 실시</li><li>살포 구역에 출입 통제 띠와 안내문을 붙이고 학생·교직원에게 미리 알림</li><li>창문을 닫고, 급식실·텃밭·놀이시설 주변은 특히 주의</li><li>약제 보관은 잠금장치가 있는 곳, 빈 용기는 규정대로 처리</li></ul>
        <p class="muted">AI는 제품명과 사용량을 처방하지 않습니다. 처방은 나무의사의 업무이며, 등록되지 않은 약제 사용은 학생 안전과 법 규정에 어긋날 수 있습니다.</p>
      </div>`;
  }

  /* 나무병원 진료 의뢰서: 진단 내용을 한 장으로 정리해 인쇄·PDF 저장 */
  /* 나무병원 진료 의뢰서: 같은 화면 위에 띄워 편집 → 미리보기 → PDF·이미지 저장·공유·인쇄 (휴대폰 지원) */
  const REF_KEY = 'treesamReferralInfo', REF_SAVE = ['f_org', 'f_place', 'f_name', 'f_tel'];
  const loadScript = src => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = () => no(new Error('저장 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); document.head.appendChild(t); });
  const LIBS = [
    ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js']
  ];
  const loadLib = async urls => { let err; for (const u of urls) { try { await loadScript(u); return; } catch (e) { err = e; } } throw err; };

  function openReferral() {
    const j = state.pest || {}, r = state.last, fin = r ? (state.final || finalRec(r)) : null, m = r ? r.metrics : null;
    let photo = '';
    try { const img = $('preview'), c = document.createElement('canvas'), sc = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight)); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL('image/jpeg', 0.85); } catch (e) { photo = ''; }
    const ck = checklist().items.map(i => i.label);
    const today = new Date().toLocaleDateString('ko-KR');
    const tr = (k, field) => `<tr><th>${esc(k)}</th><td>${field}<div class="val"></div></td></tr>`;
    const inp = (id, ph, type, extra) => `<input id="${id}" type="${type || 'text'}" placeholder="${esc(ph)}" ${extra || ''}>`;
    const area = (id, v, ph) => `<textarea id="${id}" rows="2" placeholder="${esc(ph || '')}">${esc(v)}</textarea>`;
    const host = hostName(j);
    let ov = $('refOverlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'refOverlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '수목 진료 의뢰서'); document.body.appendChild(ov); }
    ov.innerHTML = `<div class="refBar">
        <div class="refSeg" role="group" aria-label="보기 방식"><button type="button" id="refEditBtn" class="on">편집</button><button type="button" id="refPrevBtn">미리보기</button></div>
        <div class="refActs"><button type="button" id="refPdf">PDF 저장</button><button type="button" id="refImg">이미지 저장</button><button type="button" id="refShare" class="hidden">공유</button><button type="button" id="refPrint">인쇄</button><button type="button" id="refClose" aria-label="닫기">닫기</button></div>
      </div>
      <div id="refMsg" class="refMsg" aria-live="polite"></div>
      <div class="refWrap"><div id="refSheet" class="refSheet edit">
        <h1>수목 진료 의뢰서</h1><p class="sub">트리샘 생태 분석기 결과를 바탕으로 작성 · ${esc(today)}</p>
        <p class="tip">노란 칸에 기관·담당자 정보를 입력하고, AI가 채운 진단 내용은 필요하면 고친 뒤 미리보기로 확인하세요. 기관·담당자 정보는 이 기기에 기억됩니다.</p>
        <table>
          ${tr('기관명', inp('f_org', '예: ○○초등학교', 'text', 'autocomplete="organization"'))}
          ${tr('장소(위치)', inp('f_place', '예: 본관 앞 화단, 운동장 북쪽'))}
          ${tr('수목', inp('f_tree', '수종 입력').replace('>', ` value="${esc((host || '') + (state.tree ? ' · 대장번호 ' + (state.tree.asset_no || '') : ''))}">`))}
          ${tr('담당자', inp('f_name', '이름·직위', 'text', 'autocomplete="name"'))}
          ${tr('연락처', inp('f_tel', '예: 063-000-0000', 'tel', 'inputmode="tel" autocomplete="tel"'))}
        </table>
        <table>
          ${tr('점검 상태(추천)', `<select id="e_status">${['양호', '보통', '주의', '위험'].map(v => `<option${(fin && fin.status) === v ? ' selected' : ''}>${v}</option>`).join('')}</select>`)}
          ${tr('AI 의심 병해충', area('e_pest', arr(j.suspects).map(x => `${x.name}${Number.isFinite(+x.likelihood) ? ' (' + Math.round(+x.likelihood) + '%)' : ''} — ${x.evidence || ''}`).join('\n'), '예: 진딧물류 — 새순에 무리 지어 붙어 있음'))}
          ${tr('피해 부위·정도', area('e_parts', [j.parts || '', j.severity ? '피해 정도 ' + j.severity : ''].filter(Boolean).join(' · '), '피해가 보이는 부위와 정도'))}
          ${tr('관찰 증상', area('e_symptoms', ck.join(', '), '현장에서 눈으로 본 증상'))}
          ${tr('사진 색 분석', area('e_color', m ? `활력도 ${m.score}점, 녹색 ${pct(m.green)}, 잎 갈변 ${pct(m.brown)}, 흰 잔점 ${m.paleSpots}점${r.mode === 'leaf' ? `, 잎 반점 ${m.spots}개` : ''}` : ''))}
          ${tr('요청 사항', area('e_request', '현장 진단 및 확진, 방제 필요 여부 판단, 필요 시 처방전 발급(등록 약제·사용량·시기), 학교 내 안전한 방제 일정 협의'))}
        </table>
        ${photo ? `<p class="phLabel"><b>현장 사진</b></p><img class="refPhoto" src="${photo}" alt="현장 사진">` : ''}
        <p class="note">※ 이 의뢰서의 진단 내용은 사진 기반 AI·색 분석 추정이며 확진이 아닙니다. 법정 병해충(소나무재선충병 등)이 의심되면 시·군·구 산림 담당 부서에 신고해야 합니다.</p>
      </div></div>`;
    ov.classList.add('show'); document.body.classList.add('refOpen');
    const sheet = $('refSheet'), msg = t => { $('refMsg').textContent = t || ''; };
    // 기억된 기관·담당자 정보 채우기
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(REF_KEY) || '{}'); } catch (e) { saved = {}; }
    REF_SAVE.forEach(id => { const el = $(id); if (saved[id]) el.value = saved[id]; el.addEventListener('input', () => { saved[id] = el.value; try { localStorage.setItem(REF_KEY, JSON.stringify(saved)); } catch (e) { } }); });
    const fit = t => { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; };
    sheet.querySelectorAll('textarea').forEach(t => { fit(t); t.addEventListener('input', () => fit(t)); });
    // 편집 ↔ 미리보기
    const setPreview = on => {
      sheet.querySelectorAll('td').forEach(td => { const f = td.querySelector('input,textarea,select'), v = td.querySelector('.val'); if (f && v) { v.textContent = f.value.trim() || '-'; } });
      sheet.classList.toggle('preview', on); sheet.classList.toggle('edit', !on);
      $('refPrevBtn').classList.toggle('on', on); $('refEditBtn').classList.toggle('on', !on);
      if (!on) sheet.querySelectorAll('textarea').forEach(fit);
      ov.scrollTop = 0;
    };
    $('refEditBtn').onclick = () => setPreview(false);
    $('refPrevBtn').onclick = () => setPreview(true);
    const close = () => { ov.classList.remove('show'); document.body.classList.remove('refOpen'); };
    $('refClose').onclick = close;
    const fileBase = () => `수목진료의뢰서_${(($('f_tree').value || '수목').split('·')[0].trim() || '수목').replace(/[\\/:*?"<>|\s]+/g, '')}_${new Date().toLocaleDateString('sv-SE')}`;
    // 의뢰서를 그림으로 만들기 (미리보기 상태, A4 폭 기준)
    /* 인쇄와 같은 모양으로 저장: A4 본문 폭(190mm = 718px)으로 다시 그린 사본을 찍습니다 */
    const PAGE_PX = 718, PAGE_MM = { w: 210, h: 297, mg: 10 };
    async function capture() {
      await Promise.all(LIBS.map(loadLib));
      const wasPrev = sheet.classList.contains('preview');
      setPreview(true);
      const box = document.createElement('div');
      box.className = 'printBox';
      const clone = sheet.cloneNode(true);
      clone.removeAttribute('id'); clone.className = 'refSheet preview capture';
      clone.querySelectorAll('input,textarea,select,.tip').forEach(el => el.remove());
      box.appendChild(clone); document.body.appendChild(box);
      try {
        const imgs = [...clone.querySelectorAll('img')];
        await Promise.race([Promise.all(imgs.map(im => im.complete ? 0 : new Promise(ok => { im.onload = im.onerror = ok; }))), new Promise(ok => setTimeout(ok, 3000))]);
        const top = clone.getBoundingClientRect().top;
        // 쪽 나눔 후보: 표의 행, 제목·문단, 사진의 아래쪽 경계 (행 중간이 잘리지 않게)
        const breaks = [...clone.querySelectorAll('tr,h1,p,img,table')].map(el => el.getBoundingClientRect().bottom - top);
        const height = Math.ceil(clone.scrollHeight);
        const cv = await window.html2canvas(clone, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, width: PAGE_PX, height, windowWidth: PAGE_PX, windowHeight: height, scrollX: 0, scrollY: 0 });
        cv.breaks = breaks.map(b => b * cv.width / PAGE_PX).sort((a, b) => a - b);
        return cv;
      } finally { box.remove(); if (!wasPrev) setPreview(false); }
    }
    let lastFile = null;
    function deliver(blob, name) {
      lastFile = new File([blob], name, { type: blob.type });
      const canShare = navigator.canShare && navigator.canShare({ files: [lastFile] });
      $('refShare').classList.toggle('hidden', !canShare);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msg(`'${name}' 파일을 저장했습니다. 휴대폰에서는 '내 파일 → 다운로드'에 있습니다.` + (canShare ? ' 카카오톡 등으로 보내려면 \'공유\'를 누르세요.' : ''));
    }
    async function run(btn, job) {
      const b = $(btn), label = b.textContent; b.disabled = true; b.textContent = '만드는 중…'; msg('');
      try { await job(); } catch (e) { msg((e && e.message) || '저장하지 못했습니다.'); } finally { b.disabled = false; b.textContent = label; }
    }
    $('refPdf').onclick = () => run('refPdf', async () => {
      const cv = await capture(), { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const { w: pw, h: ph, mg } = PAGE_MM, w = pw - mg * 2, pxPerMm = cv.width / w, slice = Math.floor((ph - mg * 2) * pxPerMm);
      for (let y = 0, page = 0; y < cv.height - 2; page++) {
        let end = Math.min(cv.height, y + slice);
        if (end < cv.height) { const ok = (cv.breaks || []).filter(b => b > y + slice * 0.3 && b <= end); if (ok.length) end = Math.ceil(ok[ok.length - 1]) + 2; }
        const h = end - y, part = document.createElement('canvas'); part.width = cv.width; part.height = h;
        const g = part.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, part.width, h); g.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
        if (page) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', mg, mg, w, h / pxPerMm);
        y = end;
      }
      deliver(pdf.output('blob'), fileBase() + '.pdf');
    });
    $('refImg').onclick = () => run('refImg', async () => {
      const cv = await capture(); const blob = await new Promise(ok => cv.toBlob(ok, 'image/png'));
      deliver(blob, fileBase() + '.png');
    });
    $('refShare').onclick = async () => { if (!lastFile) return; try { await navigator.share({ files: [lastFile], title: '수목 진료 의뢰서' }); } catch (e) { if (e && e.name !== 'AbortError') msg('공유하지 못했습니다.'); } };
    $('refPrint').onclick = () => {
      setPreview(true);
      const inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
      if (inApp) { msg('카카오톡·네이버 앱 안에서는 인쇄가 되지 않을 수 있습니다. \'PDF 저장\'을 누르거나, 오른쪽 위 메뉴에서 \'다른 브라우저로 열기\'를 해 주세요.'); }
      setTimeout(() => { try { window.print(); } catch (e) { msg('이 브라우저에서는 인쇄를 지원하지 않습니다. \'PDF 저장\'을 이용해 주세요.'); } }, 150);
    };
    const f = $('f_org'); if (f && !f.value && !/Mobi|Android/i.test(navigator.userAgent)) f.focus();
  }
  document.addEventListener('click', e => { if (e.target && e.target.id === 'referralBtn') openReferral(); });

  /* 수종 바로잡기: 사용자가 고친 수종을 이후 진단·의뢰서에 사용 */
  window.treesamTreeHint = () => state.tree && state.tree.name ? ` 참고: 이 나무는 트리샘 관리대장에 '${state.tree.name}'(으)로 등록되어 있습니다. 사진 특징과 맞는지 확인하고, 다르면 caution에 그 이유를 적으세요.` : '';
  $('speciesFixBtn').onclick = () => {
    const v = $('speciesFix').value.trim(); if (!v) return;
    state.speciesFix = v;
    $('species').innerHTML = esc(v) + '<span class="fixedTag">담당자 수정</span>';
    $('latin').textContent = ''; $('confidence').textContent = '담당자 확인';
    $('speciesFixNote').textContent = `'${v}'(으)로 고쳤습니다. 병해충 진단과 진료 의뢰서에 이 수종이 쓰입니다.`;
    if (state.last) renderRecommendation(state.last);
  };
  ['fileInput', 'cameraInput'].forEach(id => $(id) && $(id).addEventListener('change', () => { state.speciesFix = ''; $('speciesFix').value = ''; $('speciesFixNote').textContent = '고친 수종은 병해충 진단과 진료 의뢰서에 반영됩니다.'; }));
  $('speciesFix').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('speciesFixBtn').click(); } });

  function renderPest(j) {
    const box = $('pestBody');
    const sus = arr(j.suspects).slice(0, 3);
    const susHtml = sus.length ? '<ol class="suspects">' + sus.map(x => `<li><div class="sTop"><b>${esc(x.name)}</b><span class="sType">${esc(x.type || '')}</span><span class="sLike">${Number.isFinite(+x.likelihood) ? Math.round(+x.likelihood) + '%' : ''}</span></div><div class="sBar"><i style="width:${Math.max(0, Math.min(100, +x.likelihood || 0))}%"></i></div><p>${esc(x.evidence || '')}</p></li>`).join('') + '</ol>' : '<p class="muted">사진에서 뚜렷한 병해충 후보를 찾지 못했습니다.</p>';
    box.innerHTML = `<div class="pestTop"><span class="recBadge ${STATUS_CLASS[j.status] || 'st-hold'}">${esc(j.status || '-')}</span><span class="pestOverall">${esc(j.overall || '')}${j.severity ? ' · 피해 정도 ' + esc(j.severity) : ''}</span></div>
      ${j.report && j.report.needed ? `<div class="recCaution alert"><b>신고 대상 병해충 의심</b> ${esc(j.report.reason || '')} 나무를 임의로 베거나 옮기지 말고 시·군·구 산림 담당 부서에 신고해 주세요.</div>` : ''}
      <h4>의심 후보</h4>${susHtml}
      ${j.parts ? `<h4>피해 부위</h4><p>${esc(j.parts)}</p>` : ''}
      ${arr(j.actions).length ? `<h4>현장 조치</h4><ul class="tips">${arr(j.actions).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${arr(j.moreShots).length ? `<h4>더 찍으면 좋은 부위</h4><ul class="tips">${arr(j.moreShots).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${j.student ? `<h4>학생용 설명</h4><p>${esc(j.student)}</p>` : ''}
      ${controlHtml(j)}
      ${sourcesPanel(sus.map(x => x.name))}
      <div class="refCta"><div class="refCtaText"><b>나무병원에 진료를 맡기시나요?</b><span>진단 결과·사진·증상을 한 장으로 정리해 PDF·이미지로 저장하거나 인쇄합니다.</span></div><button type="button" class="refCtaBtn" id="referralBtn"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>나무병원 진료 의뢰서 만들기</button></div>
      <p class="muted">AI 진단은 사진을 바탕으로 한 추정입니다. 방제가 필요하면 나무병원·나무의사와 상담해 주세요.</p>`;
  }

  $('pestBtn').onclick = async () => {
    const img = $('preview'); if (!img.naturalWidth) return;
    if (!state.last || state.lastSrc !== img.src) await runLocal();
    const btn = $('pestBtn'), load = $('pestLoading'), err = $('pestError');
    btn.disabled = true; err.classList.remove('show'); load.classList.add('show');
    load.textContent = 'AI가 잎·줄기의 병해충 흔적을 살펴보고 있습니다…';
    const slow = setTimeout(() => { if (/살펴보고/.test(load.textContent)) load.textContent = '응답이 늦어지고 있습니다. 잠시만 기다려 주세요…'; }, 15000);
    try {
      const ai = await waitAI();
      const hostHint = hostName(null) ? `\n참고: 이 나무(식물)는 '${hostName(null)}'입니다. 이 수종에 주로 생기는 병해충을 우선 고려하세요.` : (window.treesamTreeHint ? window.treesamTreeHint() : '');
      const j = parseJson(await ai.generate(PEST_PROMPT + hostHint, photoBase64()));
      j.status = LEVELS.includes(j.status) ? j.status : (j.overall === '이상 없음' ? '양호' : '주의');
      const top = arr(j.suspects)[0];
      j.summaryLine = j.overall === '이상 없음' ? '뚜렷한 병해충 흔적 없음' : `${top ? top.name + ' 의심' : '병해충 의심'}${j.severity ? ' (피해 ' + j.severity + ')' : ''}`;
      state.pest = j;
      renderPest(j);
      $('pestResult').classList.add('show');
      if (state.last) renderRecommendation(state.last);
      $('pestResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      err.textContent = 'AI 병해충 진단을 완료하지 못했습니다: ' + (e.message || e) + ' 잠시 후 다시 시도해 주세요. 증상 체크는 바로 쓸 수 있습니다.';
      err.classList.add('show');
    } finally { clearTimeout(slow); load.classList.remove('show'); btn.disabled = false; }
  };

  /* 사진을 찍거나 고르면: 사진 표시 → 기본 생태 상태 분석 자동 실행 → (선택) AI 수종 분석 자동 실행 */
  try { const v = localStorage.getItem('treesamAutoAi'); if (v === '0') $('autoAi').checked = false; } catch (e) { }
  $('autoAi').addEventListener('change', () => { try { localStorage.setItem('treesamAutoAi', $('autoAi').checked ? '1' : '0'); } catch (e) { } });
  let pendingAuto = false;
  ['cameraInput', 'fileInput'].forEach(id => $(id).addEventListener('change', e => { if (e.target.files && e.target.files[0]) { pendingAuto = true; $('autoRun').textContent = '사진을 불러오는 중…'; } }));
  $('preview').addEventListener('load', async () => {
    if (!pendingAuto) return; pendingAuto = false;
    $('autoRun').textContent = '기본 생태 상태 분석 중…';
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    try { await runLocal(); } catch (e) { console.warn(e); }
    if ($('autoAi').checked && !$('aiAnalyzeBtn').disabled) {
      $('autoRun').textContent = '기본 분석 완료 · AI 수종 분석을 시작합니다…';
      $('aiAnalyzeBtn').click();
      setTimeout(() => { $('autoRun').textContent = ''; }, 2500);
    } else {
      $('autoRun').textContent = '기본 분석 완료 · 아래에서 결과를 확인하세요.';
      setTimeout(() => { $('autoRun').textContent = ''; }, 4000);
    }
  });
  $('preview').addEventListener('error', () => { pendingAuto = false; $('autoRun').textContent = ''; });

  loadTrees();
})();
