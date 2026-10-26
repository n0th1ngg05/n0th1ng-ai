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
        window.location.href = '/frontend/login/';
      }
    });
    return btn;
  };

  // ── Phase 6: Tiered Trust (Forge Scope & Step-Up Elevation) ──
  let currentSessionScope = 'standard';

  const updateForgePill = (scope) => {
    currentSessionScope = scope;
    const isUnlocked = scope === 'forge_unlocked';
    document.querySelectorAll('.nav-forge-pill').forEach(pill => {
      pill.innerHTML = isUnlocked
        ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ade80;margin-right:6px;box-shadow:0 0 6px #4ade80;"></span>Forge Unlocked`
        : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-right:6px;"></span>Forge Locked`;
      pill.title = isUnlocked
        ? 'Forge execution unlocked (Click to Lock)'
        : 'Forge execution locked (Click to Elevate)';
    });
  };

  const showElevationModal = () => {
    if (document.getElementById('forgeElevationModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'forgeElevationModal';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.75)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '20px';

    overlay.innerHTML = `
      <div style="background:#121214;border:1px solid rgba(255,255,255,0.15);border-radius:12px;width:100%;max-width:380px;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,0.6);font-family:inherit;color:#eee;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:20px;">⚡</span>
          <h3 style="margin:0;font-size:16px;font-weight:600;">Forge Execution Elevation</h3>
        </div>
        <p style="margin:0 0 16px 0;font-size:13px;opacity:0.8;line-height:1.5;">This session is in standard mode. Authenticate to unlock Forge & ForgeX code execution.</p>
        <form id="forgeElevationForm" style="display:flex;flex-direction:column;gap:12px;">
          <input type="password" id="forgeElevationPassword" placeholder="Master Password" style="width:100%;padding:10px 12px;background:#000;border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:14px;box-sizing:border-box;">
          <div id="forgeElevationError" style="color:#f87171;font-size:12px;display:none;"></div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button type="submit" id="forgeElevateBtn" style="flex:1;padding:10px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:500;font-size:13px;cursor:pointer;">Unlock Forge</button>
            <button type="button" id="forgeElevationCancel" style="padding:10px 14px;background:transparent;border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:13px;cursor:pointer;">Cancel</button>
          </div>
          <div style="text-align:center;margin-top:4px;">
            <button type="button" id="forgePasskeyElevate" style="background:transparent;border:none;color:#93c5fd;font-size:12px;cursor:pointer;opacity:0.9;">Or verify with Passkey</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const pwdInput = overlay.querySelector('#forgeElevationPassword');
    pwdInput.focus();

    const errBox = overlay.querySelector('#forgeElevationError');
    const close = () => overlay.remove();

    overlay.querySelector('#forgeElevationCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#forgeElevationForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = pwdInput.value;
      if (!pwd) return;
      errBox.style.display = 'none';

      try {
        const res = await fetch('/api/auth/elevate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          updateForgePill('forge_unlocked');
          close();
          window.dispatchEvent(new CustomEvent('forge:elevated'));
        } else {
          errBox.textContent = data.error || 'Elevation failed';
          errBox.style.display = 'block';
        }
      } catch (_) {
        errBox.textContent = 'Elevation request failed';
        errBox.style.display = 'block';
      }
    });

    overlay.querySelector('#forgePasskeyElevate').addEventListener('click', async () => {
      errBox.style.display = 'none';
      try {
        const optRes = await fetch('/api/auth/webauthn/login-options', { method: 'POST' });
        const { available, options } = await optRes.json();
        if (!available || !options) {
          errBox.textContent = 'No passkeys available.';
          errBox.style.display = 'block';
          return;
        }

        let simpleWebAuthn;
        try {
          simpleWebAuthn = await import('/node_modules/@simplewebauthn/browser/esm/index.js');
        } catch (_) {
          simpleWebAuthn = await import('@simplewebauthn/browser');
        }

        const assertion = await simpleWebAuthn.startAuthentication({ optionsJSON: options });
        const elevateRes = await fetch('/api/auth/elevate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assertion })
        });
        const data = await elevateRes.json();
        if (elevateRes.ok && data.ok) {
          updateForgePill('forge_unlocked');
          close();
          window.dispatchEvent(new CustomEvent('forge:elevated'));
        } else {
          errBox.textContent = data.error || 'Passkey elevation failed';
          errBox.style.display = 'block';
        }
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          errBox.textContent = err.message || 'Passkey verification failed';
          errBox.style.display = 'block';
        }
      }
    });
  };

  const createForgePill = () => {
    const btn = document.createElement('button');
    btn.className = 'nav-link nav-forge-pill';
    btn.style.cursor = 'pointer';
    btn.style.background = 'rgba(255,255,255,0.05)';
    btn.style.border = '1px solid rgba(255,255,255,0.12)';
    btn.style.borderRadius = '14px';
    btn.style.padding = '4px 10px';
    btn.style.fontSize = '12px';
    btn.style.marginRight = '8px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.color = 'inherit';
    btn.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-right:6px;"></span>Forge`;

    btn.addEventListener('click', async () => {
      if (currentSessionScope === 'forge_unlocked') {
        if (confirm('Demote session to standard? Forge tasks will require re-authentication to execute.')) {
          try {
            const res = await fetch('/api/auth/demote', { method: 'POST' });
            if (res.ok) updateForgePill('standard');
          } catch (_) {}
        }
      } else {
        showElevationModal();
      }
    });
    return btn;
  };

  // Poll /api/auth/me to initialize pill state
  fetch('/api/auth/me')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.session && data.session.scope) {
        updateForgePill(data.session.scope);
      }
    })
    .catch(() => {});

  const navLinks = document.querySelector('.nav-links');
  if (navLinks && !navLinks.querySelector('.nav-lock-btn')) {
    navLinks.appendChild(createForgePill());
    navLinks.appendChild(createLockBtn());
  }

  const drawerNav = document.querySelector('.drawer .drawer-links') || document.querySelector('.drawer');
  if (drawerNav && !drawerNav.querySelector('.nav-lock-btn')) {
    const drawerPill = createForgePill();
    drawerPill.style.padding = '10px 16px';
    drawerPill.style.width = '100%';
    drawerPill.style.textAlign = 'left';
    drawerNav.appendChild(drawerPill);

    const drawerBtn = createLockBtn();
    drawerBtn.style.padding = '12px 16px';
    drawerBtn.style.width = '100%';
    drawerBtn.style.textAlign = 'left';
    drawerNav.appendChild(drawerBtn);
  }

  // Intercept 401 AUTH_REQUIRED & 403 ELEVATION_REQUIRED fetch responses across all pages
  if (window.fetch && !window.__authFetchIntercepted) {
    window.__authFetchIntercepted = true;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await origFetch(...args);
      if ((response.status === 401 || response.status === 403) && !window.location.pathname.includes('/login')) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          if (data) {
            const isElevationRequired =
              data.error === 'ELEVATION_REQUIRED' ||
              data.message === 'ELEVATION_REQUIRED' ||
              (Array.isArray(data) && data[0]?.error?.message === 'ELEVATION_REQUIRED') ||
              (data.error?.message === 'ELEVATION_REQUIRED');

            if (isElevationRequired) {
              showElevationModal();
            } else if (data.code === 'AUTH_REQUIRED') {
              const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
              window.location.href = `/frontend/login/?returnTo=${currentPath}`;
            }
          }
        } catch (_) {}
      }
      return response;
    };
  }

  // Auto-lock on Inactivity (Phase 4)
  // Short idle timeout clears session and returns operator to quick-unlock screen
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity
  let idleTimer = null;
  let lastActiveTimestamp = Date.now();

  function triggerAutoLock() {
    if (window.location.pathname.includes('/login')) return;
    try {
      fetch('/api/auth/logout', { method: 'POST', keepalive: true });
    } catch (_) {}
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/frontend/login/?idle=true&returnTo=${returnTo}`;
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (window.location.pathname.includes('/login')) return;
    idleTimer = setTimeout(triggerAutoLock, IDLE_TIMEOUT_MS);
  }

  if (!window.location.pathname.includes('/login')) {
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    const handleActivity = () => {
      const now = Date.now();
      // If system slept/suspended and elapsed time exceeds timeout, trigger immediate lock
      if (now - lastActiveTimestamp > IDLE_TIMEOUT_MS) {
        triggerAutoLock();
        return;
      }
      if (now - lastActiveTimestamp > 1000) {
        lastActiveTimestamp = now;
        resetIdleTimer();
      }
    };

    activityEvents.forEach(evt => {
      window.addEventListener(evt, handleActivity, { passive: true });
    });

    setInterval(() => {
      if (Date.now() - lastActiveTimestamp > IDLE_TIMEOUT_MS) {
        triggerAutoLock();
      }
    }, 10 * 1000);

    resetIdleTimer();
  }
});


