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

  function renderRecommendation(r) {
    const rec = finalRec(r);
    state.final = rec;
    $('recBadge').textContent = rec.label;
    $('recBadge').className = 'recBadge ' + (STATUS_CLASS[rec.status] || 'st-hold');
    $('recReasons').innerHTML = rec.reasons.map(x => `<li>${esc(x)}</li>`).join('');
    $('recCaution').innerHTML = rec.report ? '<b>신고 대상 병해충이 의심됩니다.</b> 소나무재선충병 같은 법정 병해충은 나무를 임의로 베거나 옮기지 말고, 시·군·구 산림 담당 부서에 신고해 주세요.' : rec.onlyColor && rec.status && LEVELS.indexOf(rec.status) <= 1 ? '사진 색만 본 결과입니다. 벌레·구멍·거미줄·흰 가루처럼 색으로 드러나지 않는 병해충은 놓칠 수 있으니, 아래 증상 체크나 AI 병해충 진단을 함께 해 주세요.' : '';
    $('recCaution').className = 'recCaution' + (rec.report ? ' alert' : '') + ($('recCaution').innerHTML ? '' : ' hidden');
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
- 약제 이름과 사용량은 쓰지 말고, 약제가 필요하면 '나무병원·나무의사 상담 후 방제'로 안내하세요.
반드시 JSON 객체 하나만 반환하세요. 키:
overall: '이상 없음' | '의심' | '뚜렷함'
status: '양호' | '보통' | '주의' | '위험'
severity: '없음' | '경미' | '보통' | '심각'
suspects: [{name, type('해충'|'병'|'생리장해'|'기타'), likelihood(0~100 정수), evidence(사진에서 본 근거 한 문장)}] 최대 3개, 가능성 높은 순
parts: 피해가 보이는 부위 요약 한 문장
actions: 학교 현장에서 할 수 있는 조치 2~4개(짧은 문장 배열)
report: {needed(true/false), reason}
moreShots: 정확한 진단을 위해 추가로 찍으면 좋은 부위 1~3개(배열)
student: 학생이 이해하기 쉬운 2문장 설명`;

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
      <p class="muted">AI 진단은 사진을 바탕으로 한 추정입니다. 방제가 필요하면 나무병원·나무의사와 상담해 주세요.</p>`;
  }

  $('pestBtn').onclick = async () => {
    const img = $('preview'); if (!img.naturalWidth) return;
    if (!state.last || state.lastSrc !== img.src) await runLocal();
    const btn = $('pestBtn'), load = $('pestLoading'), err = $('pestError');
    btn.disabled = true; err.classList.remove('show'); load.classList.add('show');
    load.textContent = 'AI가 잎·줄기의 병해충 흔적을 살펴보고 있습니다…';
    const slow = setTimeout(() => { load.textContent = '응답이 늦어지고 있습니다. 혼잡할 때는 1~3분 걸릴 수 있으니 잠시만 기다려 주세요…'; }, 20000);
    try {
      const ai = await waitAI();
      const j = parseJson(await ai.generate(PEST_PROMPT, photoBase64()));
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

  loadTrees();
})();
