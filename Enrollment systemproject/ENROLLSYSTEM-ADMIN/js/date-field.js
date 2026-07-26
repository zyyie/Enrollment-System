const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DatePicker = {
  overlay: null,
  hiddenInput: null,
  displayInput: null,
  minDate: null,
  maxDate: null,
  yearSelect: null,
  monthSelect: null,
  daySelect: null,
  previewEl: null,

  initCustomSelect(container) {
    if (!container || container.dataset.dpReady === '1') return container;

    container.innerHTML = `
      <button type="button" class="dp-select-trigger form-control" aria-haspopup="listbox">
        <span class="dp-select-value"></span>
        <span class="dp-select-chevron" aria-hidden="true"></span>
      </button>
      <div class="dp-select-menu" role="listbox">
        <ul class="dp-select-list"></ul>
      </div>
    `;

    const trigger = container.querySelector('.dp-select-trigger');
    const menu = container.querySelector('.dp-select-menu');

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = container.classList.contains('open');
      this.closeAllSelectMenus();
      if (!isOpen) {
        container.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        this.scrollSelectedIntoView(container);
      }
    });

    menu.addEventListener('click', e => {
      const option = e.target.closest('.dp-select-option');
      if (!option) return;
      this.setSelectValue(container, option.dataset.value);
      container.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      container.dispatchEvent(new Event('change', { bubbles: true }));
    });

    container.dataset.dpReady = '1';
    return container;
  },

  closeAllSelectMenus() {
    if (!this.overlay) return;
    this.overlay.querySelectorAll('.dp-select.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('.dp-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  },

  fillSelect(container, options, selectedValue) {
    const list = container.querySelector('.dp-select-list');
    if (!list) return;

    list.innerHTML = options.map(opt => `
      <li class="dp-select-option${String(opt.value) === String(selectedValue) ? ' selected' : ''}"
          role="option"
          data-value="${opt.value}"
          aria-selected="${String(opt.value) === String(selectedValue)}">
        ${opt.label}
      </li>
    `).join('');

    const selected = options.find(opt => String(opt.value) === String(selectedValue));
    const valueEl = container.querySelector('.dp-select-value');
    if (valueEl) valueEl.textContent = selected ? selected.label : '—';
    container.dataset.value = selectedValue ?? '';
  },

  getSelectValue(container) {
    return container?.dataset.value ?? '';
  },

  setSelectValue(container, value) {
    const option = container.querySelector(`.dp-select-option[data-value="${CSS.escape(String(value))}"]`);
    if (!option) return;
    container.querySelectorAll('.dp-select-option').forEach(el => {
      el.classList.remove('selected');
      el.setAttribute('aria-selected', 'false');
    });
    option.classList.add('selected');
    option.setAttribute('aria-selected', 'true');
    container.querySelector('.dp-select-value').textContent = option.textContent.trim();
    container.dataset.value = String(value);
  },

  scrollSelectedIntoView(container) {
    const selected = container.querySelector('.dp-select-option.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  },

  init() {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'date-picker-overlay';
    this.overlay.innerHTML = `
      <div class="date-picker-modal" role="dialog" aria-modal="true" aria-label="Select date">
        <div class="date-picker-head">
          <h3 class="date-picker-heading">Select Birthdate</h3>
          <button type="button" class="date-picker-close" data-action="close" aria-label="Close">&times;</button>
        </div>
        <p class="date-picker-sub">Choose your year, month, and day of birth.</p>
        <div class="date-picker-selects">
          <div class="date-picker-field">
            <label>Year</label>
            <div class="dp-select" id="dpYear" data-dp-part="year"></div>
          </div>
          <div class="date-picker-field">
            <label>Month</label>
            <div class="dp-select" id="dpMonth" data-dp-part="month"></div>
          </div>
          <div class="date-picker-field">
            <label>Day</label>
            <div class="dp-select" id="dpDay" data-dp-part="day"></div>
          </div>
        </div>
        <div class="date-picker-preview" id="datePickerPreview">No date selected</div>
        <div class="date-picker-actions">
          <button type="button" class="btn-secondary" data-action="clear">Clear</button>
          <button type="button" class="btn-primary" data-action="confirm">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    this.yearSelect = this.initCustomSelect(this.overlay.querySelector('#dpYear'));
    this.monthSelect = this.initCustomSelect(this.overlay.querySelector('#dpMonth'));
    this.daySelect = this.initCustomSelect(this.overlay.querySelector('#dpDay'));
    this.previewEl = this.overlay.querySelector('#datePickerPreview');

    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.close();
    });

    document.addEventListener('click', () => this.closeAllSelectMenus());

    this.overlay.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
    this.overlay.querySelector('[data-action="clear"]').addEventListener('click', () => this.clearSelection());
    this.overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => this.confirm());

    [this.yearSelect, this.monthSelect, this.daySelect].forEach(el => {
      el.addEventListener('change', () => {
        this.syncDayOptions();
        this.updatePreview();
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.overlay.classList.contains('open')) {
        this.close();
      }
    });
  },

  open(hiddenInput, displayInput, options = {}) {
    this.init();
    this.hiddenInput = hiddenInput;
    this.displayInput = displayInput;
    this.minDate = parseIso(options.min || hiddenInput.min || '1960-01-01');
    this.maxDate = parseIso(options.max || hiddenInput.max || `${new Date().getFullYear()}-12-31`);

    this.populateYearOptions();
    this.populateMonthOptions();

    const current = parseIso(hiddenInput.value);
    const defaultYear = Math.min(this.maxDate.getFullYear() - 17, this.maxDate.getFullYear());
    const yearValue = current
      ? String(current.getFullYear())
      : String(Math.max(defaultYear, this.minDate.getFullYear()));
    const monthValue = current ? String(current.getMonth()) : '0';

    this.fillSelect(this.yearSelect, this.buildYearOptions(), yearValue);
    this.fillSelect(this.monthSelect, this.buildMonthOptions(), monthValue);
    this.syncDayOptions();

    const dayValue = current ? String(current.getDate()) : '1';
    if (this.daySelect.querySelector(`.dp-select-option[data-value="${CSS.escape(dayValue)}"]`)) {
      this.setSelectValue(this.daySelect, dayValue);
    }

    this.updatePreview();
    this.overlay.classList.add('open');
    document.body.classList.add('date-picker-open');
  },

  close() {
    if (!this.overlay) return;
    this.closeAllSelectMenus();
    this.overlay.classList.remove('open');
    document.body.classList.remove('date-picker-open');
  },

  minYear() {
    return this.minDate.getFullYear();
  },

  maxYear() {
    return this.maxDate.getFullYear();
  },

  populateYearOptions() {
    this.fillSelect(
      this.yearSelect,
      this.buildYearOptions(),
      this.getSelectValue(this.yearSelect) || String(this.maxYear())
    );
  },

  populateMonthOptions() {
    this.fillSelect(
      this.monthSelect,
      this.buildMonthOptions(),
      this.getSelectValue(this.monthSelect) || '0'
    );
  },

  buildYearOptions() {
    const options = [];
    for (let year = this.maxYear(); year >= this.minYear(); year -= 1) {
      options.push({ value: String(year), label: String(year) });
    }
    return options;
  },

  buildMonthOptions() {
    return MONTH_NAMES.map((name, index) => ({
      value: String(index),
      label: name,
    }));
  },

  syncDayOptions() {
    const year = Number(this.getSelectValue(this.yearSelect));
    const month = Number(this.getSelectValue(this.monthSelect));
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousDay = Number(this.getSelectValue(this.daySelect)) || 1;

    const options = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      if (!this.isAllowed(date)) continue;
      options.push({ value: String(day), label: String(day) });
    }

    if (options.length === 0) {
      this.fillSelect(this.daySelect, [{ value: '', label: '—' }], '');
      return;
    }

    const validDay = Math.min(previousDay, Number(options[options.length - 1].value));
    this.fillSelect(this.daySelect, options, String(validDay));
  },

  getSelectedDate() {
    const year = this.getSelectValue(this.yearSelect);
    const month = this.getSelectValue(this.monthSelect);
    const day = this.getSelectValue(this.daySelect);
    if (!year || month === '' || !day) return null;
    const date = new Date(Number(year), Number(month), Number(day));
    return this.isAllowed(date) ? date : null;
  },

  updatePreview() {
    const date = this.getSelectedDate();
    if (!date) {
      this.previewEl.textContent = 'No date selected';
      this.previewEl.classList.remove('has-value');
      return;
    }
    this.previewEl.textContent = formatDisplay(toIso(date));
    this.previewEl.classList.add('has-value');
  },

  clearSelection() {
    this.setValue('');
    this.close();
  },

  confirm() {
    const date = this.getSelectedDate();
    if (!date) return;
    this.setValue(toIso(date));
    this.close();
  },

  setValue(iso) {
    if (!this.hiddenInput) return;
    this.hiddenInput.value = iso;
    if (this.displayInput) {
      this.displayInput.value = iso ? formatDisplay(iso) : '';
    }
    this.hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
    this.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
  },

  isAllowed(date) {
    const d = stripTime(date);
    if (this.minDate && d < this.minDate) return false;
    if (this.maxDate && d > this.maxDate) return false;
    return true;
  }
};

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIso(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(iso) {
  const date = parseIso(iso);
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d} / ${m} / ${date.getFullYear()}`;
}

function dateFieldIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
    <path d="M16 2v4M8 2v4M3 10h18"></path>
  </svg>`;
}

function bindDateField(field, options = {}) {
  if (!field || field.dataset.dateBound === '1') return;

  const hidden = field.querySelector('input[type="hidden"]');
  const trigger = field.querySelector('.date-picker-trigger');
  if (!hidden || !trigger) return;

  const currentYear = new Date().getFullYear();
  hidden.min = options.min || hidden.min || '1960-01-01';
  hidden.max = options.max || hidden.max || `${currentYear}-12-31`;

  if (hidden.value) {
    trigger.value = formatDisplay(hidden.value);
  }

  const open = () => DatePicker.open(hidden, trigger, options);

  trigger.addEventListener('click', open);
  field.addEventListener('click', e => {
    if (e.target === field || e.target.closest('.date-field-icon')) open();
  });

  field.dataset.dateBound = '1';
}

function bindDateFields(root, options = {}) {
  const scope = root || document;
  const defaults = { min: '1960-01-01', max: `${new Date().getFullYear()}-12-31` };
  scope.querySelectorAll('.date-field').forEach(field => bindDateField(field, { ...defaults, ...options }));
}

function dateFieldHtml(id, attrs = '') {
  const valueMatch = attrs.match(/value="([^"]*)"/);
  const iso = valueMatch ? valueMatch[1] : '';
  const cleanAttrs = attrs.replace(/\s*value="[^"]*"/, '').trim();
  const display = iso ? formatDisplay(iso) : '';

  return `
    <div class="date-field">
      <input type="hidden" id="${id}" value="${iso}" ${cleanAttrs}>
      <input type="text" class="form-control date-input date-picker-trigger" readonly
        placeholder="dd / mm / yyyy" value="${display}" autocomplete="off">
      <span class="date-field-icon">${dateFieldIcon()}</span>
    </div>
  `;
}
