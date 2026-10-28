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

  // Animated diagrams: near the end of a cycle every terminal line and result is visible.
  const cycleOf = svg => parseFloat(svg.querySelector('animate, animateMotion, animateTransform')?.getAttribute('dur')) || 0;
  const freeze = svg => { svg.setCurrentTime(cycleOf(svg) * .9); svg.pauseAnimations(); };
  const restart = svg => { svg.setCurrentTime(0); svg.unpauseAnimations(); };
  const activeAnims = () => [...slides[index].querySelectorAll('svg.ros-anim')];

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
    else if (event.key.toLowerCase() === 'k' && activeAnims().length) {
      const paused = document.body.classList.toggle('anim-paused');
      activeAnims().forEach(svg => (paused ? svg.pauseAnimations() : svg.unpauseAnimations()));
    }
    else if (event.key.toLowerCase() === 'r' && activeAnims().length) { document.body.classList.remove('anim-paused'); activeAnims().forEach(restart); }
    else if (event.key.toLowerCase() === 'o') toggleOverview();
    else if (event.key.toLowerCase() === 'n') toggleNotes();
    else if (event.key.toLowerCase() === 'f') fullscreen();
    else if (event.key.toLowerCase() === 'p') window.print();
    else if (event.key === '?') toggleHelp();
    else if (event.key === 'Escape') { toggleOverview(false); toggleNotes(false); toggleHelp(false); }
  });

  let touchStart = null;
  document.addEventListener('touchstart', event => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', event => {
    if (touchStart === null) return;
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 55) (delta < 0 ? advance : retreat)();
    touchStart = null;
  }, { passive: true });

  window.addEventListener('beforeprint', () => document.querySelectorAll('svg.ros-anim').forEach(freeze));
  window.addEventListener('afterprint', () => { document.querySelectorAll('svg.ros-anim').forEach(svg => svg.unpauseAnimations()); show(index, false); });

  window.addEventListener('hashchange', () => show(requestedIndex(), false));
  show(requestedIndex(), false);
})();
