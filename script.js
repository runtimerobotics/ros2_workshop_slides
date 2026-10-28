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
  let index = 0;

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
    totalEl.textContent = String(slides.length);
    chapterEl.textContent = slides[index].dataset.section || '';
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    document.title = `${slides[index].dataset.title} · ROS 2 Workshop`;
    const note = slides[index].querySelector('.notes');
    notesContent.textContent = note ? note.textContent.trim() : 'No speaker notes for this slide.';
    if (updateHash) history.replaceState(null, '', `#${index + 1}`);
  }

  function step(delta) { show(index + delta); }
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
  });

  document.getElementById('prev').addEventListener('click', () => step(-1));
  document.getElementById('next').addEventListener('click', () => step(1));
  document.getElementById('close-overview').addEventListener('click', () => toggleOverview(false));
  document.getElementById('close-notes').addEventListener('click', () => toggleNotes(false));
  document.getElementById('close-help').addEventListener('click', () => toggleHelp(false));

  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); step(-1); }
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(slides.length - 1);
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
    if (Math.abs(delta) > 55) step(delta < 0 ? 1 : -1);
    touchStart = null;
  }, { passive: true });

  window.addEventListener('hashchange', () => show(requestedIndex(), false));
  show(requestedIndex(), false);
})();
