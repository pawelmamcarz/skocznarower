(function () {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;
  const lang = document.documentElement.lang.split('-')[0];
  const t = window.BieznikI18n[lang] || window.BieznikI18n.pl;
  const model = window.Bieznik;
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 });
  const watts = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const powerUnit = lang === 'uk' ? 'Вт' : 'W';
  const units = { mass: lang === 'uk' ? 'кг' : 'kg', speed: lang === 'uk' ? 'км/год' : 'km/h', grade: '%', wind: lang === 'uk' ? 'км/год' : 'km/h', cda: lang === 'uk' ? 'м²' : 'm²', crr: '', efficiency: '%', airDensity: lang === 'uk' ? 'кг/м³' : 'kg/m³' };
  const mainKeys = ['mass', 'speed', 'grade', 'wind'];
  const advancedKeys = ['cda', 'crr', 'efficiency', 'airDensity'];
  const keys = [...mainKeys, ...advancedKeys];
  const formatPower = value => `${watts.format(Math.round(value) || 0)} ${powerUnit}`;

  function field(key) {
    const scale = key === 'efficiency' ? 100 : 1;
    const [min, max] = model.LIMITS[key].map(value => value * scale);
    const value = model.DEFAULTS[key] * scale;
    return `<div class="calc-field">
      <label for="calc-${key}">${t[key]}</label>
      <div class="calc-input"><input id="calc-${key}" name="${key}" type="number" inputmode="${min < 0 ? 'text' : 'decimal'}" min="${min}" max="${max}" step="any" value="${value}" required aria-describedby="calc-${key}-hint calc-${key}-range"><span>${units[key]}</span></div>
      <p id="calc-${key}-hint">${t[`${key}Hint`]}</p>
      <p id="calc-${key}-range" class="calc-range">${t.range}: ${number.format(min)}…${number.format(max)} ${units[key]}</p>
    </div>`;
  }

  app.innerHTML = `<div class="calc-layout">
    <form id="calc-form" class="calc-panel" novalidate>
      <h2>${t.conditions}</h2>
      <div class="calc-fields">${mainKeys.map(field).join('')}</div>
      <p class="calc-assumption-note">${t.assumptionNote}</p>
      <details class="calc-assumptions">
        <summary>${t.assumptions}</summary>
        <div class="calc-fields">${advancedKeys.map(field).join('')}</div>
      </details>
      <button class="calc-reset" type="reset">${t.reset}</button>
    </form>
    <section class="calc-panel calc-result" aria-labelledby="calc-result-title">
      <h2 id="calc-result-title">${t.estimate}</h2>
      <p id="calc-error" class="calc-error" role="alert" hidden>${t.invalid}</p>
      <div id="calc-valid-result">
        <p class="calc-power"><span>${t.approximate}</span><output id="calc-power" for="${keys.map(key => `calc-${key}`).join(' ')}" aria-live="polite"></output></p>
        <p id="calc-explanation"></p>
        <p id="calc-braking" class="calc-braking" hidden><span>${t.braking}</span> <strong id="calc-braking-value"></strong></p>
        <h3>${t.breakdown}</h3>
        <dl class="calc-breakdown">${['rolling', 'aero', 'gravity', 'drivetrain'].map(key => `<div><dt>${t[key]}</dt><dd id="calc-value-${key}"></dd></div>`).join('')}</dl>
        <p class="calc-note">${t.signed}</p>
      </div>
    </section>
  </div>
  <section id="calc-comparison" class="calc-panel calc-comparison" aria-labelledby="calc-compare-title">
    <h2 id="calc-compare-title">${t.compare}</h2><p>${t.compareHint}</p>
    <table><thead><tr><th scope="col">${t.scenario}</th><th scope="col">${t.power}</th><th scope="col">${t.difference}</th></tr></thead><tbody id="calc-scenarios"></tbody></table>
  </section>
  <details class="calc-method"><summary>${t.method}</summary><p>${t.methodText}</p><p>${t.limits}</p><p><a href="https://doi.org/10.1123/jab.14.3.276">${t.source}</a></p></details>
  <p class="calc-privacy">${t.privacy}</p>`;

  const form = document.getElementById('calc-form');
  const inputs = keys.map(key => form.elements.namedItem(key));
  const result = document.getElementById('calc-valid-result');
  const error = document.getElementById('calc-error');
  const comparison = document.getElementById('calc-comparison');

  function update() {
    let valid = true;
    const values = {};
    inputs.forEach(input => {
      const value = input.valueAsNumber;
      const okay = input.validity.valid && Number.isFinite(value);
      input.setAttribute('aria-invalid', String(!okay));
      if (!okay) valid = false;
      values[input.name] = input.name === 'efficiency' ? value / 100 : value;
    });
    error.hidden = valid;
    result.hidden = !valid;
    comparison.hidden = !valid;
    if (!valid) return;

    const power = model.compute(values);
    document.getElementById('calc-power').textContent = formatPower(power.pedaling);
    document.getElementById('calc-explanation').textContent = values.speed === 0 ? t.stopped : power.braking > 0 ? t.coast : t.constant;
    document.getElementById('calc-braking').hidden = power.braking <= 0;
    document.getElementById('calc-braking-value').textContent = formatPower(power.braking);
    ['rolling', 'aero', 'gravity', 'drivetrain'].forEach(key => {
      document.getElementById(`calc-value-${key}`).textContent = formatPower(power[key]);
    });
    const scenarios = [
      ['faster', 'speed', 5], ['steeper', 'grade', 3],
      ['windier', 'wind', 10], ['heavier', 'mass', 5],
    ];
    document.getElementById('calc-scenarios').innerHTML = scenarios.map(([label, key, delta]) => {
      const changed = { ...values, [key]: values[key] + delta };
      if (changed[key] > model.LIMITS[key][1]) return `<tr><th scope="row">${t[label]}</th><td colspan="2">${t.outside}</td></tr>`;
      const estimate = model.compute(changed).pedaling;
      const difference = Math.round(estimate) - Math.round(power.pedaling);
      return `<tr><th scope="row">${t[label]}</th><td>${formatPower(estimate)}</td><td>${difference > 0 ? '+' : ''}${formatPower(difference)}</td></tr>`;
    }).join('');
  }

  form.addEventListener('input', update);
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('reset', () => {
    // Run after the browser restores each default input value.
    setTimeout(update, 0);
  });
  update();
})();
