/**
 * liquid-select.js
 * Automatically converts <select class="form-select glass"> into sexy Liquid Glass Dropdowns.
 * Listens for DOM mutations so dynamically added options are automatically rendered.
 */

document.addEventListener('DOMContentLoaded', () => {
  const selects = document.querySelectorAll('select');
  selects.forEach(initLiquidSelect);

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.liquid-select-wrapper')) {
      document.querySelectorAll('.liquid-select-dropdown').forEach(dd => dd.classList.remove('show'));
      document.querySelectorAll('.liquid-select-trigger').forEach(trig => trig.classList.remove('open'));
      document.querySelectorAll('.liquid-select-wrapper').forEach(wrap => {
        wrap.classList.remove('active');
        wrap.style.zIndex = '';
      });
      document.querySelectorAll('[data-ls-z]').forEach(p => {
        p.style.zIndex = p.dataset.lsZ;
        p.style.position = p.dataset.lsPos;
        delete p.dataset.lsZ;
        delete p.dataset.lsPos;
      });
    }
  });
});

function initLiquidSelect(nativeSelect) {
  // If already initialized, skip
  if (nativeSelect.nextElementSibling && nativeSelect.nextElementSibling.classList.contains('liquid-select-wrapper')) {
    return;
  }

  // Hide native select but keep it in DOM so form submissions/JS logic still works
  nativeSelect.classList.add('liquid-select-hidden');

  const wrapper = document.createElement('div');
  wrapper.className = 'liquid-select-wrapper';

  const trigger = document.createElement('div');
  trigger.className = 'liquid-select-trigger';

  const valueSpan = document.createElement('span');
  valueSpan.className = 'ls-value';
  
  const iconSpan = document.createElement('span');
  iconSpan.className = 'ls-icon';
  // SVG chevron
  iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

  trigger.appendChild(valueSpan);
  trigger.appendChild(iconSpan);

  const dropdown = document.createElement('div');
  dropdown.className = 'liquid-select-dropdown';

  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  // Insert wrapper right after native select
  nativeSelect.parentNode.insertBefore(wrapper, nativeSelect.nextSibling);

  // Render options from native select
  const renderOptions = () => {
    dropdown.innerHTML = '';
    let selectedText = '';
    let hasSelection = false;
    let globalIndex = 0;

    const processOption = (opt) => {
      const index = globalIndex++;
      const optionDiv = document.createElement('div');
      optionDiv.className = 'liquid-select-option';
      
      const textSpan = document.createElement('span');
      textSpan.textContent = opt.textContent;
      optionDiv.appendChild(textSpan);

      if (opt.disabled) {
        optionDiv.classList.add('disabled');
        if (opt.selected && !hasSelection) {
          selectedText = opt.textContent;
          hasSelection = true;
        }
      } else {
        if (opt.selected) {
          optionDiv.classList.add('selected');
          selectedText = opt.textContent;
          hasSelection = true;
        }

        optionDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          // Update native select
          nativeSelect.selectedIndex = index;
          
          // Trigger change event on native select so existing JS catches it
          nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));

          // Update UI
          valueSpan.textContent = opt.textContent;
          dropdown.classList.remove('show');
          trigger.classList.remove('open');
          wrapper.classList.remove('active');
          wrapper.style.zIndex = '';
          toggleElevation(wrapper, false);
          
          // Update selected class
          dropdown.querySelectorAll('.liquid-select-option').forEach(el => el.classList.remove('selected'));
          optionDiv.classList.add('selected');
        });
      }

      dropdown.appendChild(optionDiv);
    };

    Array.from(nativeSelect.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        const header = document.createElement('div');
        header.className = 'liquid-select-optgroup';
        header.textContent = child.label;
        dropdown.appendChild(header);
        
        Array.from(child.children).forEach(opt => {
          if (opt.tagName === 'OPTION') processOption(opt);
        });
      } else if (child.tagName === 'OPTION') {
        processOption(child);
      }
    });

    valueSpan.textContent = selectedText || 'Select...';
  };

  renderOptions();

  const toggleElevation = (wrap, elevate) => {
    let p = wrap.parentElement;
    while (p && p !== document.body) {
      if (elevate) {
        p.dataset.lsZ = p.style.zIndex || '';
        p.dataset.lsPos = p.style.position || '';
        p.style.zIndex = '99999';
        if (window.getComputedStyle(p).position === 'static') {
          p.style.position = 'relative';
        }
      } else {
        if (p.dataset.lsZ !== undefined) {
          p.style.zIndex = p.dataset.lsZ;
        }
        if (p.dataset.lsPos !== undefined) {
          p.style.position = p.dataset.lsPos;
        }
      }
      p = p.parentElement;
    }
  };

  // Toggle dropdown on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Close others
    document.querySelectorAll('.liquid-select-dropdown.show').forEach(dd => {
      if (dd !== dropdown) dd.classList.remove('show');
    });
    document.querySelectorAll('.liquid-select-trigger.open').forEach(trig => {
      if (trig !== trigger) trig.classList.remove('open');
    });
    document.querySelectorAll('.liquid-select-wrapper.active').forEach(wrap => {
      if (wrap !== wrapper) {
        wrap.classList.remove('active');
        wrap.style.zIndex = '';
        toggleElevation(wrap, false);
      }
    });

    const isOpening = !wrapper.classList.contains('active');
    dropdown.classList.toggle('show', isOpening);
    trigger.classList.toggle('open', isOpening);
    wrapper.classList.toggle('active', isOpening);
    wrapper.style.zIndex = isOpening ? '99999' : '';
    toggleElevation(wrapper, isOpening);
  });

  // Watch for dynamic changes to the native select's options
  const observer = new MutationObserver(() => {
    renderOptions();
  });
  observer.observe(nativeSelect, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected'] });
  
  // Also watch for native value changes done via JS if they dispatch a change event
  nativeSelect.addEventListener('change', () => {
    renderOptions();
  });
}
