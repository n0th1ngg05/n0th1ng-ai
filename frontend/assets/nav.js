document.addEventListener('DOMContentLoaded', () => {
  const burger = document.getElementById('burger');
  const drawer = document.getElementById('drawer');
  const navWrap = document.getElementById('navWrap');
  
  if (burger && drawer) {
    burger.addEventListener('click', () => {
      drawer.classList.add('open');
    });

    const closeEls = drawer.querySelectorAll('[data-close]');
    closeEls.forEach(el => {
      el.addEventListener('click', () => {
        drawer.classList.remove('open');
      });
    });

    const bg = drawer.querySelector('.drawer-bg');
    if (bg) {
      bg.addEventListener('click', () => {
        drawer.classList.remove('open');
      });
    }
  }

  // Handle scroll state for navbar
  if (navWrap) {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        navWrap.classList.add('scrolled');
      } else {
        navWrap.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll);
    handleScroll(); // init
  }
});

  // Features Dropdown Mega-Menu Hover Grace Period
  const navDd = document.getElementById('ddFeatures');
  if (navDd) {
    let hoverTimeout;
    navDd.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      navDd.classList.add('active');
    });
    navDd.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        navDd.classList.remove('active');
      }, 400); // 400ms grace period to reach the menu
    });
  }

  // Workstation Lock / Logout Button
  const createLockBtn = () => {
    const btn = document.createElement('button');
    btn.className = 'nav-link nav-lock-btn';
    btn.title = 'Lock Workstation';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;opacity:0.8;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Lock`;
    btn.style.cursor = 'pointer';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.font = 'inherit';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.color = 'inherit';

    btn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        console.error('Logout error:', e);
      } finally {
        window.location.href = '/login.html';
      }
    });
    return btn;
  };

  const navLinks = document.querySelector('.nav-links');
  if (navLinks && !navLinks.querySelector('.nav-lock-btn')) {
    navLinks.appendChild(createLockBtn());
  }

  const drawerNav = document.querySelector('.drawer .drawer-links') || document.querySelector('.drawer');
  if (drawerNav && !drawerNav.querySelector('.nav-lock-btn')) {
    const drawerBtn = createLockBtn();
    drawerBtn.style.padding = '12px 16px';
    drawerBtn.style.width = '100%';
    drawerBtn.style.textAlign = 'left';
    drawerNav.appendChild(drawerBtn);
  }

  // Intercept 401 AUTH_REQUIRED fetch responses across all pages
  if (window.fetch && !window.__authFetchIntercepted) {
    window.__authFetchIntercepted = true;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await origFetch(...args);
      if (response.status === 401 && !window.location.pathname.includes('login.html')) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          if (data && data.code === 'AUTH_REQUIRED') {
            const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login.html?returnTo=${currentPath}`;
          }
        } catch (_) {}
      }
      return response;
    };
  }


