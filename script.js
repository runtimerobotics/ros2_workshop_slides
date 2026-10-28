(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const currentEl = document.getElementById('current-slide');
  const totalEl = document.getElementById('total-slides');
  const chapterEl = document.getElementById('chapter-label');
  const progress = document.getElementById('progress-bar');
  const notesPanel = document.getElementById('notes-panel');
  const notesContent = document.getElementById('notes-content');
  const overview = document.getElementById('overview');
  const overviewGrid = document.getElementById('overview-grid');
  const help = document.getElementById('help');
  const stepIndicator = document.getElementById('step-indicator');
  const stepLabel = document.getElementById('step-label');
  const stepBar = document.getElementById('step-bar');
  const slideSelect = document.getElementById('slide-select');
  const stepState = slides.map(() => 0);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;

  document.documentElement.classList.add('js-ready');

  // Chapter dividers: a drifting ROS graph behind the title. Seeded per slide so it is the same every visit.
  const NS = 'http://www.w3.org/2000/svg';
  slides.forEach((slide, k) => {
    if (!slide.classList.contains('section-break') || slide.querySelector('.ros-anim')) return;
    let seed = k * 7919 + 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ros-anim deco'); svg.setAttribute('viewBox', '0 0 600 600'); svg.setAttribute('aria-hidden', 'true');
    const pts = Array.from({ length: 13 }, () => [60 + rnd() * 480, 60 + rnd() * 480]);
    const edges = [];
    pts.forEach((p, i) => pts.map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1])]).filter(([j]) => j > i).sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([j]) => edges.push([i, j])));
    let body = edges.map(([i, j]) => `<line class="deco-edge" x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}"/>`).join('');
    body += pts.map(([x, y], i) => `<circle class="deco-node" cx="${x}" cy="${y}" r="${i % 4 ? 7 : 12}"><animate attributeName="r" dur="${(3 + rnd() * 3).toFixed(1)}s" repeatCount="indefinite" values="${i % 4 ? '7;9;7' : '12;15;12'}"/></circle>`).join('');
    body += edges.filter((_, n) => n % 2 === 0).map(([i, j], n) => {
      const dur = (2.5 + rnd() * 3).toFixed(1), path = `M${pts[i][0]},${pts[i][1]} L${pts[j][0]},${pts[j][1]}`;
      return `<g class="packet"><circle class="${['req', 'fb', 'res'][n % 3]}" r="5"/><animateMotion dur="${dur}s" begin="${(rnd() * 2).toFixed(1)}s" repeatCount="indefinite" path="${path}"/></g>`;
    }).join('');
    svg.innerHTML = body; slide.append(svg);
  });

  // Animated diagrams: near the end of a cycle every terminal line and result is visible.
  const cycleOf = svg => parseFloat(svg.querySelector('animate, animateMotion, animateTransform')?.getAttribute('dur')) || 0;
  const freeze = svg => { svg.setCurrentTime(cycleOf(svg) * .9); svg.pauseAnimations(); };
  const restart = svg => { svg.setCurrentTime(0); svg.unpauseAnimations(); };
  const activeAnims = () => [...slides[index].querySelectorAll('svg.ros-anim')];
  const hasAnimation = () => activeAnims().length || slides[index].querySelector('.scene3d') || flowItems.length || slides[index].querySelector('pre');

  function clamp(value) { return Math.max(0, Math.min(value, slides.length - 1)); }

  function requestedIndex() {
    const raw = Number(location.hash.replace('#', ''));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw - 1) : 0;
  }

  function show(next, updateHash = true) {
    index = clamp(next);
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    currentEl.textContent = String(index + 1);
    slideSelect.value = String(index);
    totalEl.textContent = String(slides.length);
    chapterEl.textContent = slides[index].dataset.section || '';
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    document.title = `${slides[index].dataset.title} · ROS 2 Workshop`;
    const note = slides[index].querySelector('.notes');
    notesContent.textContent = note ? note.textContent.trim() : 'No speaker notes for this slide.';
    renderSteps();
    document.body.classList.remove('anim-paused');
    slides[index].querySelectorAll('svg.ros-anim').forEach(svg => (reduceMotion.matches ? freeze(svg) : restart(svg)));
    document.dispatchEvent(new CustomEvent('deck:slide', { detail: slides[index] }));
    if (updateHash) history.replaceState(null, '', `#${index + 1}`);
  }

  function renderSteps() {
    const items = [...slides[index].querySelectorAll('[data-step]')];
    const visible = Math.min(stepState[index], items.length);
    items.forEach((item, itemIndex) => {
      item.classList.toggle('step-visible', itemIndex < visible);
      item.classList.toggle('step-current', itemIndex === visible - 1);
    });
    stepIndicator.classList.toggle('visible', items.length > 0);
    stepLabel.textContent = `Step ${visible} / ${items.length}`;
    stepBar.style.width = items.length ? `${(visible / items.length) * 100}%` : '0%';
  }

  function advance() {
    const total = slides[index].querySelectorAll('[data-step]').length;
    if (stepState[index] < total) {
      stepState[index] += 1;
      renderSteps();
      return;
    }
    show(index + 1);
  }

  function retreat() {
    if (stepState[index] > 0) {
      stepState[index] -= 1;
      renderSteps();
      return;
    }
    show(index - 1);
  }
  function toggleOverview(force) {
    const open = typeof force === 'boolean' ? force : !overview.classList.contains('open');
    overview.classList.toggle('open', open);
    overview.setAttribute('aria-hidden', String(!open));
  }
  function toggleNotes(force) {
    const open = typeof force === 'boolean' ? force : !notesPanel.classList.contains('open');
    notesPanel.classList.toggle('open', open);
    notesPanel.setAttribute('aria-hidden', String(!open));
  }
  function toggleHelp(force) {
    const open = typeof force === 'boolean' ? force : !help.classList.contains('open');
    help.classList.toggle('open', open);
    help.setAttribute('aria-hidden', String(!open));
  }
  function fullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  slides.forEach((slide, i) => {
    const card = document.createElement('button');
    card.className = 'overview-card';
    card.innerHTML = `<span>${String(i + 1).padStart(2, '0')} · ${slide.dataset.section || ''}</span><strong>${slide.dataset.title || `Slide ${i + 1}`}</strong><small>Open slide</small>`;
    card.addEventListener('click', () => { show(i); toggleOverview(false); });
    overviewGrid.append(card);
    const section = slide.dataset.section || '';
    if (slideSelect.lastElementChild?.label !== section) slideSelect.append(Object.assign(document.createElement('optgroup'), { label: section }));
    slideSelect.lastElementChild.append(new Option(`${i + 1} · ${slide.dataset.title || `Slide ${i + 1}`}`, String(i)));
  });

  slideSelect.addEventListener('change', () => { show(Number(slideSelect.value)); slideSelect.blur(); });
  document.getElementById('prev').addEventListener('click', retreat);
  document.getElementById('next').addEventListener('click', advance);
  document.getElementById('close-overview').addEventListener('click', () => toggleOverview(false));
  document.getElementById('close-notes').addEventListener('click', () => toggleNotes(false));
  document.getElementById('close-help').addEventListener('click', () => toggleHelp(false));

  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); advance(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); retreat(); }
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(slides.length - 1);
    else if (event.key.toLowerCase() === 'g') { event.preventDefault(); slideSelect.focus(); slideSelect.showPicker?.(); }
    else if (event.key.toLowerCase() === 'k' && hasAnimation()) {
      const paused = document.body.classList.toggle('anim-paused');
      activeAnims().forEach(svg => (paused ? svg.pauseAnimations() : svg.unpauseAnimations()));
    }
    else if (event.key.toLowerCase() === 'r' && hasAnimation()) { document.body.classList.remove('anim-paused'); activeAnims().forEach(restart); document.dispatchEvent(new Event('deck:restart')); }
    else if (event.key.toLowerCase() === 'o') toggleOverview();
    else if (event.key.toLowerCase() === 'n') toggleNotes();
    else if (event.key.toLowerCase() === 'f') fullscreen();
    else if (event.key.toLowerCase() === 'p') window.print();
    else if (event.key === '?') toggleHelp();
    else if (event.key === 'Escape') { toggleOverview(false); toggleNotes(false); toggleHelp(false); }
  });

  let touchStart = null;
  // Swipes inside an interactive scene drag or orbit; they never change the slide.
  document.addEventListener('touchstart', event => { touchStart = event.target.closest?.('.scene3d') ? null : event.changedTouches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', event => {
    if (touchStart === null) return;
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 55) (delta < 0 ? advance : retreat)();
    touchStart = null;
  }, { passive: true });

  // Spotlight: on slides without a diagram animation, walk through cards, rows, and steps one at a time.
  // Command cards retype their command; code blocks reveal line by line on arrival.
  const FLOW = '.outcome-path > article, .agenda-days li, .learning-loop > div, .build-order > div, .startup-checks > div, .pipeline > div, .grasp-sequence > div, .debug-order > div, .validation-ladder > div, .capstone > div, .scene-layers > div, .constraint-rings > div, .vocabulary > div, .decision-path > div, .sensor-contract > div, .filter-funnel > div, .stack-flow > div, .control-loop > div, .concept-map > div, .concept-result, .object-states > div, .moveit-map > div, .message-journey > div, .fault-pairs > p, .scan-fields > p, .pattern-table > .table-row:not(.header), .command-map > div, .steps > li, .compare > article, .sensor-list > article, .evidence-strip > span, .example-strip > span, .overlay-stack > div, .scope-example > div, .layers > div, .geometry-roles > article, .qos-spectrum > .qos-end, .definition-row > p';
  let flowItems = [], flowAt = 0, flowTimer = 0;
  const visibleStep = el => { const st = el.closest('[data-step]'); return !st || st.classList.contains('step-visible'); };
  function flowStep() {
    if (document.body.classList.contains('anim-paused')) return;
    flowItems.forEach(el => el.classList.remove('flow-on'));
    const live = flowItems.filter(visibleStep);
    if (!live.length) return;
    const el = live[flowAt++ % live.length];
    el.classList.remove('flow-on'); void el.offsetWidth; el.classList.add('flow-on');
    const code = el.querySelector(':scope > code');
    if (code) code.style.setProperty('--n', Math.min(code.textContent.length, 60));
  }
  function startFlow() {
    clearInterval(flowTimer); flowItems.forEach(el => el.classList.remove('flow-on', 'flow-item'));
    const slide = slides[index];
    flowItems = reduceMotion.matches || slide.querySelector('.ros-anim:not(.deco), .scene3d') ? [] : [...slide.querySelectorAll(FLOW)];
    flowItems.forEach(el => el.classList.add('flow-item'));
    flowAt = 0;
    if (flowItems.length) { flowStep(); flowTimer = setInterval(flowStep, 2000); }
    slide.querySelectorAll('pre').forEach(pre => {
      if (pre.closest('.scene3d')) return;
      const lines = pre.textContent.replace(/\n$/, '').split('\n').length;
      pre.style.setProperty('--lines', lines); pre.style.setProperty('--dur', `${Math.min(lines * 110, 2200)}ms`);
      pre.classList.remove('code-reveal'); void pre.offsetWidth; if (!reduceMotion.matches) pre.classList.add('code-reveal');
    });
  }
  document.addEventListener('deck:slide', startFlow);
  document.addEventListener('deck:restart', startFlow);

  window.addEventListener('beforeprint', () => { clearInterval(flowTimer); flowItems.forEach(el => el.classList.remove('flow-on')); document.querySelectorAll('pre.code-reveal').forEach(p => p.classList.remove('code-reveal')); });
  window.addEventListener('beforeprint', () => document.querySelectorAll('svg.ros-anim').forEach(freeze));
  window.addEventListener('afterprint', () => { document.querySelectorAll('svg.ros-anim').forEach(svg => svg.unpauseAnimations()); show(index, false); });

  window.addEventListener('hashchange', () => show(requestedIndex(), false));
  show(requestedIndex(), false);
})();
