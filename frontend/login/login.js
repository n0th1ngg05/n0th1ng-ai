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
    successView: document.getElementById('successView'),
    totpForm: document.getElementById('totpForm'),
    totpCode: document.getElementById('totpCode'),
    totpError: document.getElementById('totpError'),
    totpMessage: document.getElementById('totpMessage'),
    totpSubmitButton: document.getElementById('totpSubmitButton'),
    totpSubmitLabel: document.getElementById('totpSubmitLabel'),
    totpCountdown: document.getElementById('totpCountdown'),
    totpCancelButton: document.getElementById('totpCancelButton'),
    setupPinRow: document.getElementById('setupPinRow'),
    setupPin: document.getElementById('setupPin'),
    setupPinError: document.getElementById('setupPinError'),
    switchToPinRow: document.getElementById('switchToPinRow'),
    switchToPinButton: document.getElementById('switchToPinButton'),
    pinForm: document.getElementById('pinForm'),
    pinCode: document.getElementById('pinCode'),
    pinError: document.getElementById('pinError'),
    pinMessage: document.getElementById('pinMessage'),
    pinSubmitButton: document.getElementById('pinSubmitButton'),
    pinSubmitLabel: document.getElementById('pinSubmitLabel'),
    pinCountdown: document.getElementById('pinCountdown'),
    pinSwitchToPassword: document.getElementById('pinSwitchToPassword'),
    passkeyRow: document.getElementById('passkeyRow'),
    passkeyButton: document.getElementById('passkeyButton'),
    passkeyButtonLabel: document.getElementById('passkeyButtonLabel'),
    pinPasskeyRow: document.getElementById('pinPasskeyRow'),
    pinPasskeyButton: document.getElementById('pinPasskeyButton'),
  };

  let isSetup = false;
  let isSubmitting = false;
  let countdownTimer = null;
  let pendingToken = null;
  let isTotpSubmitting = false;
  let totpCountdownTimer = null;
  let hasTrustedPin = false;
  let isPinSubmitting = false;
  let pinCountdownTimer = null;
  let hasPasskeys = false;
  let isPasskeyAuthenticating = false;
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

  function clearTotpMessage() {
    setMessage(elements.totpMessage, '');
    elements.totpMessage.classList.remove('is-error');
  }

  function showTotpMessage(message) {
    elements.totpMessage.textContent = message;
    elements.totpMessage.classList.add('is-error');
    elements.totpMessage.hidden = false;
  }

  function clearPinMessage() {
    setMessage(elements.pinMessage, '');
    elements.pinMessage.classList.remove('is-error');
  }

  function showPinMessage(message) {
    elements.pinMessage.textContent = message;
    elements.pinMessage.classList.add('is-error');
    elements.pinMessage.hidden = false;
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
    elements.totpForm.hidden = true;
    elements.pinForm.hidden = true;
    pendingToken = null;
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

    if (elements.setupPinRow) {
      elements.setupPinRow.hidden = configured ? !elements.rememberMe.checked : true;
    }
    if (elements.switchToPinRow) {
      elements.switchToPinRow.hidden = !hasTrustedPin;
    }
    if (elements.passkeyRow) {
      elements.passkeyRow.hidden = configured ? !hasPasskeys : true;
    }

    elements.password.value = '';
    elements.confirmPassword.value = '';
    if (elements.setupPin) elements.setupPin.value = '';
    setFieldError(elements.password, elements.passwordError, '');
    setFieldError(elements.confirmPassword, elements.confirmError, '');
    if (elements.setupPin) setFieldError(elements.setupPin, elements.setupPinError, '');
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
    elements.totpForm.hidden = true;
    elements.pinForm.hidden = true;
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

      if (body.configured) {
        try {
          const trustRes = await fetch('/api/auth/device-trust/status', {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          if (trustRes.ok) {
            const trustData = await readJson(trustRes);
            hasTrustedPin = Boolean(trustData.trusted && trustData.hasPin);
          }
        } catch (_) {}

        try {
          const passkeyRes = await fetch('/api/auth/webauthn/status', {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          if (passkeyRes.ok) {
            const passkeyData = await readJson(passkeyRes);
            hasPasskeys = Boolean(passkeyData.available);
          }
        } catch (_) {}
      }

      configureForm(body.configured);

      const urlParams = new URLSearchParams(window.location.search);
      const isIdle = urlParams.get('idle') === 'true';

      if (body.configured && hasTrustedPin) {
        switchToPin();
        if (isIdle) {
          showPinMessage('Workstation locked due to inactivity.');
        }
      } else if (isIdle) {
        showFormMessage('Workstation locked due to inactivity.');
      }
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
    elements.totpForm.hidden = true;
    elements.pinForm.hidden = true;
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

  function startTotpCountdown(seconds) {
    if (totpCountdownTimer) {
      window.clearInterval(totpCountdownTimer);
      totpCountdownTimer = null;
    }

    let remaining = Math.max(1, Math.floor(seconds));
    elements.totpSubmitButton.disabled = true;
    elements.totpCountdown.hidden = false;

    const updateCountdown = () => {
      if (remaining <= 0) {
        window.clearInterval(totpCountdownTimer);
        totpCountdownTimer = null;
        elements.totpCountdown.hidden = true;
        elements.totpCountdown.textContent = '';
        elements.totpSubmitButton.disabled = isTotpSubmitting;
        return;
      }
      elements.totpCountdown.textContent = `Try again in ${remaining}s`;
      remaining -= 1;
    };

    updateCountdown();
    totpCountdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function switchToTotp(token) {
    pendingToken = token;
    elements.form.hidden = true;
    elements.totpForm.hidden = false;
    elements.eyebrow.textContent = 'TWO-FACTOR AUTHENTICATION';
    elements.title.textContent = 'Verification required';
    elements.description.textContent = 'Enter the 6-digit code from your authenticator app.';
    elements.totpCode.value = '';
    setFieldError(elements.totpCode, elements.totpError, '');
    clearTotpMessage();
    elements.totpSubmitButton.disabled = false;
    elements.totpCode.focus();
  }

  function switchToPassword() {
    pendingToken = null;
    elements.totpForm.hidden = true;
    elements.pinForm.hidden = true;
    elements.form.hidden = false;
    elements.eyebrow.textContent = 'PRIVATE WORKSTATION';
    elements.title.textContent = 'Workstation locked';
    elements.description.textContent = 'Enter your password to unlock this workstation.';
    elements.password.value = '';
    setFieldError(elements.password, elements.passwordError, '');
    clearFormMessage();
    if (hasTrustedPin && elements.switchToPinRow) {
      elements.switchToPinRow.hidden = false;
    }
    if (elements.passkeyRow) {
      elements.passkeyRow.hidden = !hasPasskeys;
    }
    elements.password.focus();
  }

  function startPinCountdown(seconds) {
    if (pinCountdownTimer) {
      window.clearInterval(pinCountdownTimer);
      pinCountdownTimer = null;
    }

    let remaining = Math.max(1, Math.floor(seconds));
    elements.pinSubmitButton.disabled = true;
    elements.pinCountdown.hidden = false;

    const updateCountdown = () => {
      if (remaining <= 0) {
        window.clearInterval(pinCountdownTimer);
        pinCountdownTimer = null;
        elements.pinCountdown.hidden = true;
        elements.pinCountdown.textContent = '';
        elements.pinSubmitButton.disabled = isPinSubmitting;
        return;
      }
      elements.pinCountdown.textContent = `Try again in ${remaining}s`;
      remaining -= 1;
    };

    updateCountdown();
    pinCountdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function switchToPin() {
    pendingToken = null;
    elements.form.hidden = true;
    elements.totpForm.hidden = true;
    elements.pinForm.hidden = false;
    const urlParams = new URLSearchParams(window.location.search);
    const isIdle = urlParams.get('idle') === 'true';
    elements.eyebrow.textContent = 'TRUSTED DEVICE';
    elements.title.textContent = isIdle ? 'Session paused' : 'Quick unlock';
    elements.description.textContent = 'Enter your quick PIN to resume your session.';
    elements.pinCode.value = '';
    setFieldError(elements.pinCode, elements.pinError, '');
    clearPinMessage();
    if (elements.pinPasskeyRow) {
      elements.pinPasskeyRow.hidden = !hasPasskeys;
    }
    elements.pinSubmitButton.disabled = false;
    elements.pinCode.focus();
  }

  function switchToPasswordFromPin() {
    switchToPassword();
  }

  async function submitPin() {
    if (isPinSubmitting || pinCountdownTimer) return;

    const pin = elements.pinCode.value.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      setFieldError(elements.pinCode, elements.pinError, 'Enter your 4–8 digit PIN.');
      elements.pinCode.focus();
      return;
    }

    clearPinMessage();
    setFieldError(elements.pinCode, elements.pinError, '');

    const submitStartedAt = Date.now();
    elements.pinSubmitButton.classList.remove('is-rippling');
    void elements.pinSubmitButton.offsetWidth;
    elements.pinSubmitButton.classList.add('is-rippling');
    isPinSubmitting = true;
    elements.pinSubmitButton.disabled = true;

    try {
      const response = await fetch('/api/auth/pin/unlock', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ pin })
      });

      const body = await readJson(response);

      if (response.status === 401) {
        const errorMsg = body.error || 'Incorrect PIN';
        showPinMessage(errorMsg);
        elements.card.classList.remove('is-shaking');
        void elements.card.offsetWidth;
        elements.card.classList.add('is-shaking');
        elements.pinCode.value = '';
        elements.pinCode.focus();
        return;
      }

      if (response.status === 400) {
        showPinMessage(body.error || 'No PIN configured for this device.');
        switchToPasswordFromPin();
        return;
      }

      if (response.status === 429) {
        const message = typeof body.error === 'string' && body.error.trim()
          ? body.error.trim()
          : 'Too many failed attempts. Please wait 60 seconds.';
        showPinMessage(message);
        startPinCountdown(parseWaitSeconds(message) || 60);
        return;
      }

      if (response.ok && body.ok === true) {
        await showSuccess(submitStartedAt);
        return;
      }

      showPinMessage('Something went wrong — try again');
    } catch (_) {
      showPinMessage('Something went wrong — try again');
    } finally {
      isPinSubmitting = false;
      elements.pinSubmitButton.disabled = Boolean(pinCountdownTimer);
      elements.pinSubmitButton.classList.remove('is-rippling');
    }
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

    if (response.ok && body.totpRequired && body.pendingToken) {
      switchToTotp(body.pendingToken);
      return;
    }

    if (response.ok && body.ok === true) {
      await showSuccess(submitStartedAt);
      return;
    }

    showFormMessage('Something went wrong — try again');
  }

  async function submitTotp() {
    if (isTotpSubmitting || totpCountdownTimer || !pendingToken) return;

    const code = elements.totpCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      setFieldError(elements.totpCode, elements.totpError, 'Enter a valid 6-digit code.');
      elements.totpCode.focus();
      return;
    }

    clearTotpMessage();
    setFieldError(elements.totpCode, elements.totpError, '');

    const submitStartedAt = Date.now();
    elements.totpSubmitButton.classList.remove('is-rippling');
    void elements.totpSubmitButton.offsetWidth;
    elements.totpSubmitButton.classList.add('is-rippling');
    isTotpSubmitting = true;
    elements.totpSubmitButton.disabled = true;

    try {
      const response = await fetch('/api/auth/totp/verify-login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          pendingToken,
          code
        })
      });

      const body = await readJson(response);

      if (response.status === 401) {
        const errorMsg = body.error || 'Invalid authentication code';
        showTotpMessage(errorMsg);
        elements.card.classList.remove('is-shaking');
        void elements.card.offsetWidth;
        elements.card.classList.add('is-shaking');
        elements.totpCode.value = '';
        elements.totpCode.focus();
        return;
      }

      if (response.status === 410) {
        switchToPassword();
        showFormMessage('Verification session expired. Please enter your password again.');
        return;
      }

      if (response.status === 429) {
        const message = typeof body.error === 'string' && body.error.trim()
          ? body.error.trim()
          : 'Too many failed attempts. Please wait 60 seconds.';
        showTotpMessage(message);
        startTotpCountdown(parseWaitSeconds(message) || 60);
        return;
      }

      if (response.ok && body.ok === true) {
        await showSuccess(submitStartedAt);
        return;
      }

      showTotpMessage('Something went wrong — try again');
    } catch (_) {
      showTotpMessage('Something went wrong — try again');
    } finally {
      isTotpSubmitting = false;
      elements.totpSubmitButton.disabled = Boolean(totpCountdownTimer);
      elements.totpSubmitButton.classList.remove('is-rippling');
    }
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
      const pinVal = elements.setupPin ? elements.setupPin.value.trim() : '';
      if (pinVal && !/^\d{4,8}$/.test(pinVal)) {
        setFieldError(elements.setupPin, elements.setupPinError, 'PIN must be between 4 and 8 digits.');
        elements.setupPin.focus();
        return;
      }

      const payload = isSetup
        ? { password: elements.password.value }
        : {
            password: elements.password.value,
            rememberMe: elements.rememberMe.checked,
            trustDevice: elements.rememberMe.checked,
            pin: pinVal || undefined,
          };
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

  elements.totpForm.addEventListener('submit', event => {
    event.preventDefault();
    submitTotp();
  });

  elements.totpCode.addEventListener('input', event => {
    const clean = event.target.value.replace(/\D/g, '').slice(0, 6);
    event.target.value = clean;
    setFieldError(elements.totpCode, elements.totpError, '');
    clearTotpMessage();

    if (clean.length === 6) {
      submitTotp();
    }
  });

  elements.totpCancelButton.addEventListener('click', () => {
    switchToPassword();
  });

  if (elements.rememberMe) {
    elements.rememberMe.addEventListener('change', () => {
      if (elements.setupPinRow) {
        elements.setupPinRow.hidden = !elements.rememberMe.checked;
      }
    });
  }

  if (elements.setupPin) {
    elements.setupPin.addEventListener('input', () => {
      setFieldError(elements.setupPin, elements.setupPinError, '');
    });
  }

  if (elements.switchToPinButton) {
    elements.switchToPinButton.addEventListener('click', () => {
      switchToPin();
    });
  }

  if (elements.pinSwitchToPassword) {
    elements.pinSwitchToPassword.addEventListener('click', () => {
      switchToPasswordFromPin();
    });
  }

  if (elements.pinForm) {
    elements.pinForm.addEventListener('submit', event => {
      event.preventDefault();
      submitPin();
    });
  }

  if (elements.pinCode) {
    elements.pinCode.addEventListener('input', event => {
      const clean = event.target.value.replace(/\D/g, '').slice(0, 8);
      event.target.value = clean;
      setFieldError(elements.pinCode, elements.pinError, '');
      clearPinMessage();
    });
  }

  async function loginWithPasskey() {
    if (isPasskeyAuthenticating) return;
    clearFormMessage();
    clearPinMessage();

    isPasskeyAuthenticating = true;
    if (elements.passkeyButtonLabel) elements.passkeyButtonLabel.textContent = 'Verifying Passkey…';
    if (elements.passkeyButton) elements.passkeyButton.disabled = true;
    if (elements.pinPasskeyButton) elements.pinPasskeyButton.disabled = true;

    try {
      const optRes = await fetch('/api/auth/webauthn/login-options', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      if (!optRes.ok) {
        const errData = await readJson(optRes);
        throw new Error(errData.error || 'Failed to get passkey options.');
      }

      const { available, options } = await readJson(optRes);
      if (!available || !options) {
        throw new Error('No passkeys are registered on this workstation.');
      }

      let simpleWebAuthn;
      try {
        simpleWebAuthn = await import('/node_modules/@simplewebauthn/browser/esm/index.js');
      } catch (_) {
        simpleWebAuthn = await import('@simplewebauthn/browser');
      }

      const assertion = await simpleWebAuthn.startAuthentication({ optionsJSON: options });
      const submitStartedAt = Date.now();

      const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(assertion)
      });

      const body = await readJson(verifyRes);

      if (verifyRes.ok && body.ok === true) {
        await showSuccess(submitStartedAt);
        return;
      }

      throw new Error(body.error || 'Passkey verification failed.');
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showFormMessage('Passkey verification was cancelled.');
        showPinMessage('Passkey verification was cancelled.');
      } else {
        const msg = err.message || 'Passkey authentication failed.';
        showFormMessage(msg);
        showPinMessage(msg);
      }
    } finally {
      isPasskeyAuthenticating = false;
      if (elements.passkeyButtonLabel) elements.passkeyButtonLabel.textContent = 'Sign in with Passkey';
      if (elements.passkeyButton) elements.passkeyButton.disabled = false;
      if (elements.pinPasskeyButton) elements.pinPasskeyButton.disabled = false;
    }
  }

  if (elements.passkeyButton) {
    elements.passkeyButton.addEventListener('click', loginWithPasskey);
  }
  if (elements.pinPasskeyButton) {
    elements.pinPasskeyButton.addEventListener('click', loginWithPasskey);
  }

  elements.statusRetry.addEventListener('click', checkStatus);
  checkStatus();
})();
