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
    spots: ['잎 반점', '잎 위에서 찾은 갈색·검은 얼룩의 개수'],
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
    if (md === 'leaf') {
      detail += m.spots ? ` 잎에서 반점 ${m.spots}개를 찾았습니다(지도에 빨간 원).` : ' 잎에서 뚜렷한 반점은 찾지 못했습니다.';
      if (m.spots >= 5) tips = ['반점 부위를 확대 촬영해 AI 정밀 분석', '잎 뒷면의 해충·알 확인', '같은 증상이 다른 나무에도 있는지 확인'];
    }
    return { summary, detail, tips };
  }

  const STATUS_CLASS = { '양호': 'st-good', '보통': 'st-fair', '주의': 'st-warn', '위험': 'st-bad' };
  function renderRecommendation(r) {
    const rec = r.recommendation;
    $('recBadge').textContent = rec.label;
    $('recBadge').className = 'recBadge ' + (STATUS_CLASS[rec.status] || 'st-hold');
    $('recReasons').innerHTML = rec.reasons.map(x => `<li>${esc(x)}</li>`).join('');
    const btn = $('sendInspection'), hint = $('recHint');
    if (!rec.status) { btn.classList.add('hidden'); hint.textContent = '다시 촬영하면 점검 상태를 추천해 드립니다.'; return; }
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
    const cards = [metricCard('green', pct(m.green), m.green), metricCard('yellow', pct(m.yellow), m.yellow), metricCard('autumn', pct(m.autumn), m.autumn), metricCard('brown', pct(m.brown), m.brown)];
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
    const r = state.last; if (!r || !state.tree || !r.recommendation.status) return;
    const m = r.metrics, today = new Date().toLocaleDateString('ko-KR');
    const parts = [`활력도 ${m.score}점`, `녹색 ${pct(m.green)}`, `노란 잎 ${pct(m.yellow)}`, `갈변 ${pct(m.brown)}`];
    if (r.mode === 'sky') parts.push(`수관 피복률 ${pct(m.canopyCover)}`);
    if (r.mode === 'leaf') parts.push(`잎 반점 ${m.spots}개`);
    const note = `[생태 분석기 ${today} · ${MODE_NAME[r.mode]}] ${parts.join(', ')}. 추천 ${r.recommendation.label}: ${r.recommendation.reasons.join(' ')}`;
    let photo = null;
    try { const img = $('preview'), c = document.createElement('canvas'), s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL('image/jpeg', 0.85); } catch (e) { photo = null; }
    const payload = { treeId: state.tree.id, status: r.recommendation.status, note, photo, at: Date.now() };
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

  loadTrees();
})();
