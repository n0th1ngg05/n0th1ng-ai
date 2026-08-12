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
