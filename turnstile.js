(() => {
  'use strict';

  const FORM_ACTIONS = {
    'booking-form': 'booking',
    'signup-form': 'workshop',
    'reminder-form': 'reminder',
  };

  const language = document.documentElement.lang || 'pl';
  const copy = language === 'en'
    ? { prompt: 'Complete the security check.', error: 'The security check could not load. Refresh the page and try again.' }
    : language === 'uk'
      ? { prompt: 'Пройдіть перевірку безпеки.', error: 'Не вдалося завантажити перевірку. Оновіть сторінку та спробуйте ще раз.' }
      : { prompt: 'Potwierdź kontrolę bezpieczeństwa.', error: 'Nie udało się wczytać kontroli. Odśwież stronę i spróbuj ponownie.' };

  function loadApi() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      const timeout = setTimeout(() => reject(new Error('Security script timeout')), 15000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Security script unavailable')); };
      document.head.appendChild(script);
    });
  }

  function setButtonsDisabled(form, disabled) {
    form.dataset.turnstileReady = disabled ? 'false' : 'true';
    form.querySelectorAll('button[type="submit"], input[type="submit"]')
      .forEach(button => { button.disabled = disabled || form.dataset.submitting === 'true'; });
  }

  function mount(form, sitekey, action) {
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submit) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'turnstile-box';
    wrapper.style.cssText = 'margin:14px 0;max-width:100%;min-height:65px';
    wrapper.setAttribute('aria-label', copy.prompt);
    const box = document.createElement('div');
    const status = document.createElement('p');
    status.style.cssText = 'margin:6px 0 0;font-size:13px;line-height:1.4';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    wrapper.append(box, status);

    const row = submit.closest('.submit-row');
    if (row?.parentNode) row.parentNode.insertBefore(wrapper, row);
    else submit.parentNode.insertBefore(wrapper, submit);

    setButtonsDisabled(form, true);
    let widgetId;
    const reset = () => {
      if (widgetId == null || !window.turnstile) return;
      window.turnstile.reset(widgetId);
      setButtonsDisabled(form, true);
      status.textContent = copy.prompt;
    };

    widgetId = window.turnstile.render(box, {
      sitekey,
      action,
      theme: 'dark',
      size: 'flexible',
      'response-field': true,
      callback() {
        status.textContent = '';
        setButtonsDisabled(form, false);
      },
      'expired-callback': reset,
      'error-callback'() {
        setButtonsDisabled(form, true);
        status.textContent = copy.error;
      },
    });

    // Obserwator działa po synchronicznym odczytaniu tokenu przez formularz.
    // Microtask w capture może wykonać się jeszcze przed handlerem submit.
    new MutationObserver(() => {
      if (form.dataset.submitting === 'true') reset();
    }).observe(form, { attributes: true, attributeFilter: ['data-submitting'] });

    form.addEventListener('submit', event => {
      const token = form.querySelector('[name="cf-turnstile-response"]')?.value || '';
      if (!token) {
        event.preventDefault();
        event.stopImmediatePropagation();
        status.textContent = copy.prompt;
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }, true);
  }

  async function init() {
    const forms = Object.entries(FORM_ACTIONS)
      .map(([id, action]) => ({ form: document.getElementById(id), action }))
      .filter(item => item.form);
    if (!forms.length) return;
    forms.forEach(({ form }) => {
      setButtonsDisabled(form, true);
      form.addEventListener('submit', event => {
        if (form.dataset.turnstileReady !== 'false' && form.dataset.submitting !== 'true') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const status = form.querySelector('.turnstile-box, .security-status');
        if (status && form.dataset.submitting !== 'true') status.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, true);
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/security-config', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Security configuration unavailable');
      const config = await response.json();
      if (!config || typeof config !== 'object') throw new Error('Invalid security configuration');
      if (!config.turnstile_site_key) {
        forms.forEach(({ form }) => setButtonsDisabled(form, false));
        return;
      }
      await loadApi();
      forms.forEach(item => mount(item.form, config.turnstile_site_key, item.action));
    } catch (error) {
      forms.forEach(({ form }) => {
        setButtonsDisabled(form, true);
        const status = document.createElement('p');
        status.className = 'security-status';
        status.setAttribute('role', 'alert');
        status.textContent = copy.error;
        const contact = document.createElement('a');
        contact.href = 'tel:+48600370810';
        contact.textContent = '600 370 810';
        status.append(' ', contact);
        form.append(status);
      });
      console.warn('Turnstile unavailable', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  init();
})();
