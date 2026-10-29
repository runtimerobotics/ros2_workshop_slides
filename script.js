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
  const hasAnimation = () => activeAnims().length || slides[index].querySelector('.scene3d');

  function clamp(value) { return Math.max(0, Math.min(value, slides.length - 1)); }

  function requestedIndex() {
    const raw = Number(location.hash.replace('#', ''));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw - 1) : 0;
  }

  // Long code on a short screen: shrink the code font until its column fits beside the diagram,
  // instead of the centred column growing up under the title. Phones scroll, so they are left alone.
  function fitCode(slide) {
    if (innerWidth <= 900) return;
    slide.querySelectorAll('.split').forEach(split => {
      for (const col of split.children) {
        const pres = col.matches('pre') ? [col] : [...col.querySelectorAll(':scope > pre')];
        if (!pres.length) continue;
        pres.forEach(pre => { pre.style.fontSize = ''; });
        let size = parseFloat(getComputedStyle(pres[0]).fontSize);
        while (col.offsetHeight > split.clientHeight && size > 9) {
          size -= .5;
          pres.forEach(pre => { pre.style.fontSize = `${size}px`; });
        }
      }
    });
  }
  let fitTimer = 0;
  addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitCode(slides[index]), 120); });
  document.fonts?.ready.then(() => fitCode(slides[index]));

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
    fitCode(slides[index]);
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

  function startFlow() { startTrace(); }
  document.addEventListener('deck:slide', startFlow);
  document.addEventListener('deck:restart', startFlow);

  // Code from the workshop repository: show where it lives (ros2_ws/src/ is implied for packages).
  document.querySelectorAll('pre[data-src]').forEach(pre => {
    pre.dataset.label = pre.dataset.src.replace(/^ros2_ws\/src\//, '');
    pre.title = `ros2_workshop_code/${pre.dataset.src}`;
  });

  // Code tracing: a diagram names the lines it is acting out, data-trace="0:1-3;.25:6;.5:0" (cycle fraction : lines, 0 = none),
  // and a bar follows along in the real code block. data-trace-pre picks the block (default: the first pre on the slide).
  let traceRaf = 0;
  function startTrace() {
    cancelAnimationFrame(traceRaf);
    document.querySelectorAll('.trace-bar').forEach(n => n.remove());
    const slide = slides[index];
    slide.querySelectorAll('svg[data-trace]').forEach(svg => {
      const pre = slide.querySelectorAll('pre')[+(svg.dataset.tracePre || 0)];
      if (!pre) return;
      const spec = svg.dataset.trace.split(';').map(e => { const [f, l] = e.split(':'); const [a, b = a] = l.split('-').map(Number); return [+f, a, b]; });
      const bar = document.createElement('div'); bar.className = 'trace-bar'; bar.setAttribute('aria-hidden', 'true'); pre.append(bar);
      // Where each source line really starts on screen, so wrapped lines do not throw the bar off.
      const starts = []; let line = 0;
      const walk = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      starts.push(null);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (starts.length === line + 1 && !starts[line]) starts[line] = [n, 0];
        for (let i = 0; i < n.data.length; i++) if (n.data[i] === '\n') { line++; starts[line] = i + 1 < n.data.length ? [n, i + 1] : null; }
      }
      const range = document.createRange();
      const topOf = k => {
        let st = starts[k - 1]; if (!st) return null;
        range.setStart(st[0], st[1]); range.setEnd(st[0], Math.min(st[1] + 1, st[0].data.length));
        return range.getBoundingClientRect().top - pre.getBoundingClientRect().top + pre.scrollTop;
      };
      const bottomOf = k => {
        const nxt = k < starts.length ? topOf(k + 1) : null;
        return nxt ?? pre.scrollHeight - parseFloat(getComputedStyle(pre).paddingBottom);
      };
      let shown = '';
      const tick = () => {
        const dur = cycleOf(svg), fr = dur ? (svg.getCurrentTime() % dur) / dur : 1;
        let cur = null; for (const e of spec) if (fr >= e[0]) cur = e;
        const key = cur && cur[1] > 0 ? `${cur[1]}-${cur[2]}-${pre.clientWidth}x${pre.clientHeight}` : '';
        if (key !== shown) {
          shown = key;
          const t = key && topOf(cur[1]);
          if (t != null && key) { bar.style.opacity = 1; bar.style.transform = `translateY(${t - 2}px)`; bar.style.height = `${bottomOf(cur[2]) - t + 2}px`; }
          else bar.style.opacity = 0;
        }
        traceRaf = requestAnimationFrame(tick);
      };
      tick();
    });
  }
  document.addEventListener('deck:slide', startFlow);
  document.addEventListener('deck:restart', startFlow);

    window.addEventListener('beforeprint', () => document.querySelectorAll('svg.ros-anim').forEach(freeze));
  window.addEventListener('afterprint', () => { document.querySelectorAll('svg.ros-anim').forEach(svg => svg.unpauseAnimations()); show(index, false); });

  window.addEventListener('hashchange', () => show(requestedIndex(), false));
  show(requestedIndex(), false);
})();
