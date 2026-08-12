/* ===================== NAV ===================== */
const navWrap = document.getElementById('navWrap');
const heroInner = document.getElementById('heroInner');

window.addEventListener('scroll', () => {
  const y = window.scrollY;
  navWrap.classList.toggle('scrolled', y > 20);

  // Hero parallax / fade
  const p = Math.min(1, Math.max(0, y / (window.innerHeight * 0.9)));
  const scale = 1 - p * 0.78;
  const ty = -p * 180;
  const opacity = 1 - p * 1.1;
  heroInner.style.transform = `translateY(${ty}px) scale(${scale})`;
  heroInner.style.opacity = opacity;
}, { passive: true });

/* Features dropdown */
const dd = document.getElementById('ddFeatures');
dd.addEventListener('mouseenter', () => dd.classList.add('open'));
dd.addEventListener('mouseleave', () => dd.classList.remove('open'));

/* Mobile drawer */
const drawer = document.getElementById('drawer');
document.getElementById('burger').addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== HERO PARTICLES ===================== */
(function particles() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  const N = 80;
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3 * dpr,
    vy: (Math.random() - 0.5) * 0.3 * dpr,
    r: (Math.random() * 1.3 + 0.3) * dpr,
  }));

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(212,175,55,0.75)';
      ctx.fill();
    }
    const max = 140 * dpr;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = parts[i], b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < max * max) {
          const alpha = 1 - Math.sqrt(d2) / max;
          ctx.strokeStyle = `rgba(245,215,122,${alpha * 0.22})`;
          ctx.lineWidth = 0.6 * dpr;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

/* ===================== IMAGE STUDIO GRID ===================== */
  (function imgGrid() {
    const root = document.getElementById('imgGrid');
    if (!root) return;
    
    async function loadImages() {
      try {
        const res = await fetch("/api/trpc/image.list");
        const data = await res.json();
        const images = data.result.data.json.slice(0, 4);
        
        root.innerHTML = '';
        for (let i = 0; i < 4; i++) {
          const d = document.createElement('div');
          if (images[i]) {
            d.style.backgroundImage = `url('${images[i].imageUrl}')`;
          } else {
            d.style.background = `conic-gradient(from ${i * 90}deg, #FFF3C6, #F5D77A, #D4AF37, #8A6A1F, #FFF3C6)`;
          }
          d.style.animationDelay = `${i * 0.2}s`;
          root.appendChild(d);
        }
      } catch(err) {
        console.error("Failed to fetch recent images", err);
      }
    }
    
    loadImages();
    setInterval(loadImages, 10000);
  })();

/* ===================== MONITOR SPARKLINE ===================== */
(function spark() {
  const root = document.getElementById('mSpark');
  if (!root) return;
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div');
    d.style.height = `${20 + Math.sin(i) * 30 + Math.random() * 30}%`;
    root.appendChild(d);
  }
})();

/* ===================== REVEAL ON SCROLL ===================== */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 6) * 80}ms`;
  io.observe(el);
});

/* ===================== COUNTERS ===================== */
const cio = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const target = +el.dataset.target;
    const start = performance.now();
    const dur = 1600;
    function tick(t) {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    cio.unobserve(el);
  });
}, { threshold: 0.4 });
document.querySelectorAll('.count').forEach(el => cio.observe(el));
