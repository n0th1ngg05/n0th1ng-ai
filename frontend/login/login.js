(() => {
  'use strict';

  document.title = 'n0th1ng AI — Workstation Locked';

  const elements = {
    card: document.getElementById('loginCard'),
    eyebrow: document.getElementById('eyebrow'),
    title: document.getElementById('pageTitle'),
    description: document.getElementById('description'),
    form: document.getElementById('authForm'),
    password: document.getElementById('password'),
    passwordError: document.getElementById('passwordError'),
    confirmField: document.getElementById('confirmField'),
    confirmPassword: document.getElementById('confirmPassword'),
    confirmError: document.getElementById('confirmError'),
    rememberRow: document.getElementById('rememberRow'),
    rememberMe: document.getElementById('rememberMe'),
    submitButton: document.getElementById('submitButton'),
    submitLabel: document.getElementById('submitLabel'),
    formMessage: document.getElementById('formMessage'),
    countdown: document.getElementById('countdown'),
    statusView: document.getElementById('statusView'),
    statusMessage: document.getElementById('statusMessage'),
    statusRetry: document.getElementById('statusRetry'),
    successView: document.getElementById('successView')
  };

  let isSetup = false;
  let isSubmitting = false;
  let countdownTimer = null;
  const validatedFields = new Set();

  function setMessage(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function setFieldError(input, messageElement, message) {
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    messageElement.textContent = message || '';
    messageElement.hidden = !message;
    return !message;
  }

  function clearFormMessage() {
    setMessage(elements.formMessage, '');
    elements.formMessage.classList.remove('is-error');
  }

  function showFormMessage(message) {
    elements.formMessage.textContent = message;
    elements.formMessage.classList.add('is-error');
    elements.formMessage.hidden = false;
  }

  function validatePassword() {
    const value = elements.password.value;
    let message = '';

    if (!value) {
      message = 'Enter your password.';
    } else if (isSetup && value.length < 8) {
      message = 'Use at least 8 characters.';
    }

    return setFieldError(elements.password, elements.passwordError, message);
  }

  function validateConfirmPassword() {
    const value = elements.confirmPassword.value;
    let message = '';

    if (!value) {
      message = 'Confirm your password.';
    } else if (value.length < 8) {
      message = 'Use at least 8 characters.';
    } else if (value !== elements.password.value) {
      message = 'Passwords do not match.';
    }

    return setFieldError(elements.confirmPassword, elements.confirmError, message);
  }

  function validateForm() {
    const passwordValid = validatePassword();
    validatedFields.add('password');

    if (!isSetup) {
      if (!passwordValid) elements.password.focus();
      return passwordValid;
    }

    const confirmationValid = validateConfirmPassword();
    validatedFields.add('confirmPassword');
    if (!passwordValid) {
      elements.password.focus();
      return false;
    }
    if (!confirmationValid) {
      elements.confirmPassword.focus();
      return false;
    }
    return true;
  }

  function configureForm(configured) {
    isSetup = !configured;
    elements.statusView.hidden = true;
    elements.statusRetry.hidden = true;
    elements.form.hidden = false;
    elements.successView.hidden = true;
    elements.card.classList.remove('is-success');
    elements.eyebrow.textContent = configured ? 'PRIVATE WORKSTATION' : 'FIRST-RUN SETUP';
    elements.title.textContent = configured ? 'Workstation locked' : 'Initialize workstation';
    elements.description.textContent = configured
      ? 'Enter your password to unlock this workstation.'
      : 'This password protects your entire workstation. Store it somewhere safe — there is no account recovery email.';
    elements.submitLabel.textContent = configured ? 'Unlock' : 'Initialize Workstation';

    elements.confirmField.hidden = configured;
    elements.confirmPassword.disabled = configured;
    elements.confirmPassword.required = !configured;
    const confirmReveal = document.querySelector('[data-toggle-password="confirmPassword"]');
    confirmReveal.disabled = configured;
    confirmReveal.tabIndex = configured ? -1 : 0;

    elements.rememberRow.hidden = !configured;
    elements.rememberMe.disabled = !configured;
    elements.password.autocomplete = configured ? 'current-password' : 'new-password';
    elements.password.required = true;
    elements.password.minLength = configured ? 0 : 8;

    elements.password.value = '';
    elements.confirmPassword.value = '';
    setFieldError(elements.password, elements.passwordError, '');
    setFieldError(elements.confirmPassword, elements.confirmError, '');
    clearFormMessage();
    validatedFields.clear();
    elements.submitButton.disabled = false;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (_) {
      return {};
    }
  }

  async function checkStatus() {
    elements.form.hidden = true;
    elements.statusView.hidden = false;
    elements.statusRetry.hidden = true;
    elements.statusRetry.disabled = true;
    elements.statusRetry.textContent = 'Checking…';
    setMessage(elements.statusMessage, '');

    try {
      const response = await fetch('/api/auth/status', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Status check failed');
      const body = await readJson(response);
      if (typeof body.configured !== 'boolean') throw new Error('Invalid status response');
      configureForm(body.configured);
    } catch (_) {
      elements.eyebrow.textContent = 'PRIVATE WORKSTATION';
      elements.title.textContent = 'Unable to verify access';
      elements.description.textContent = 'The workstation status could not be checked.';
      setMessage(elements.statusMessage, 'Unable to check workstation status. Try again.');
      elements.statusRetry.textContent = 'Retry check';
      elements.statusRetry.disabled = false;
      elements.statusRetry.hidden = false;
      elements.statusView.hidden = false;
    }
  }

  function getReturnTarget() {
    const encoded = new URLSearchParams(window.location.search).get('returnTo');
    if (!encoded) return '/';

    let destination = encoded;
    try {
      destination = decodeURIComponent(encoded);
    } catch (_) {
      destination = encoded;
    }

    try {
      const resolved = new URL(destination, window.location.origin);
      if (resolved.origin !== window.location.origin) return '/';
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch (_) {
      return '/';
    }
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function showSuccess(submitStartedAt) {
    const rippleRemaining = Math.max(0, 420 - (Date.now() - submitStartedAt));
    if (rippleRemaining) await delay(rippleRemaining);
    elements.form.hidden = true;
    elements.statusView.hidden = true;
    elements.successView.hidden = false;
    elements.card.classList.add('is-success');
    await delay(500);
    window.location.href = getReturnTarget();
  }

  function setBusy(busy) {
    isSubmitting = busy;
    elements.submitButton.disabled = busy || Boolean(countdownTimer);
  }

  function startCountdown(seconds) {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }

    let remaining = Math.max(1, Math.floor(seconds));
    elements.submitButton.disabled = true;
    elements.countdown.hidden = false;

    const updateCountdown = () => {
      if (remaining <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        elements.countdown.hidden = true;
        elements.countdown.textContent = '';
        elements.submitButton.disabled = isSubmitting;
        return;
      }
      elements.countdown.textContent = `Try again in ${remaining}s`;
      remaining -= 1;
    };

    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function parseWaitSeconds(message) {
    const match = String(message || '').match(/wait\s+(\d+)\s+seconds?/i);
    if (!match) return null;
    const seconds = Number.parseInt(match[1], 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  async function handleLoginResponse(response, body, submitStartedAt) {
    if (response.status === 401) {
      showFormMessage('Incorrect password');
      elements.card.classList.remove('is-shaking');
      void elements.card.offsetWidth;
      elements.card.classList.add('is-shaking');
      elements.password.value = '';
      elements.password.focus();
      return;
    }

    if (response.status === 429) {
      const message = typeof body.error === 'string' && body.error.trim()
        ? body.error.trim()
        : 'Too many failed login attempts. Please wait 60 seconds.';
      showFormMessage(message);
      startCountdown(parseWaitSeconds(message) || 60);
      return;
    }

    if (response.ok && body.ok === true) {
      await showSuccess(submitStartedAt);
      return;
    }

    showFormMessage('Something went wrong — try again');
  }

  async function handleSetupResponse(response, body, submitStartedAt) {
    if (response.ok && body.ok === true) {
      await showSuccess(submitStartedAt);
      return;
    }

    const message = typeof body.error === 'string' && body.error.trim()
      ? body.error.trim()
      : 'Something went wrong — try again';
    showFormMessage(message);
  }

  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (isSubmitting || countdownTimer) return;

    clearFormMessage();
    if (!validateForm()) return;

    const submitStartedAt = Date.now();
    elements.submitButton.classList.remove('is-rippling');
    void elements.submitButton.offsetWidth;
    elements.submitButton.classList.add('is-rippling');
    setBusy(true);

    try {
      const payload = isSetup
        ? { password: elements.password.value }
        : { password: elements.password.value, rememberMe: elements.rememberMe.checked };
      const response = await fetch(isSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response);

      if (isSetup) {
        await handleSetupResponse(response, body, submitStartedAt);
      } else {
        await handleLoginResponse(response, body, submitStartedAt);
      }
    } catch (_) {
      showFormMessage('Something went wrong — try again');
    } finally {
      setBusy(false);
      elements.submitButton.classList.remove('is-rippling');
    }
  });

  elements.password.addEventListener('blur', () => {
    validatedFields.add('password');
    validatePassword();
    if (isSetup && validatedFields.has('confirmPassword') && elements.confirmPassword.value) {
      validateConfirmPassword();
    }
  });

  elements.confirmPassword.addEventListener('blur', () => {
    validatedFields.add('confirmPassword');
    validateConfirmPassword();
  });

  elements.password.addEventListener('input', () => {
    clearFormMessage();
    if (validatedFields.has('password')) validatePassword();
    if (isSetup && validatedFields.has('confirmPassword') && elements.confirmPassword.value) {
      validateConfirmPassword();
    }
  });

  elements.confirmPassword.addEventListener('input', () => {
    clearFormMessage();
    if (validatedFields.has('confirmPassword')) validateConfirmPassword();
  });

  document.querySelectorAll('[data-toggle-password]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input || input.disabled) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.classList.toggle('is-visible', show);
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus({ preventScroll: true });
    });
  });

  elements.card.addEventListener('animationend', event => {
    if (event.animationName === 'login-shake') elements.card.classList.remove('is-shaking');
  });

  elements.statusRetry.addEventListener('click', checkStatus);
  checkStatus();
})();
