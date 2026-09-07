// Searchable Province → City → Barangay dropdowns (PSGC API)
const AddressSelect = (() => {
  const API = 'https://psgc.cloud/api';
  const NCR_CODE = '1300000000';
  const NCR_LABEL = 'Metro Manila (NCR)';

  let provincesCache = null;
  const citiesCache = {};
  const barangaysCache = {};

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Address data unavailable');
    return res.json();
  }

  async function loadProvinces() {
    if (provincesCache) return provincesCache;
    const list = await fetchJson(`${API}/provinces`);
    provincesCache = [
      { name: NCR_LABEL, code: NCR_CODE, isNcr: true },
      ...list.map(p => ({ name: p.name, code: p.code, isNcr: false }))
    ].sort((a, b) => a.name.localeCompare(b.name));
    return provincesCache;
  }

  async function loadCities(provinceCode, isNcr = false) {
    const key = provinceCode;
    if (citiesCache[key]) return citiesCache[key];

    const url = isNcr || provinceCode === NCR_CODE
      ? `${API}/regions/${NCR_CODE}/cities-municipalities`
      : `${API}/provinces/${provinceCode}/cities-municipalities`;

    let list = await fetchJson(url);
    if (isNcr || provinceCode === NCR_CODE) {
      list = list.filter(item => item.type === 'City' || item.type === 'Mun');
    }

    citiesCache[key] = list
      .map(c => ({ name: c.name.trim(), code: c.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return citiesCache[key];
  }

  async function loadBarangays(cityCode) {
    if (barangaysCache[cityCode]) return barangaysCache[cityCode];
    const list = await fetchJson(`${API}/cities-municipalities/${cityCode}/barangays`);
    barangaysCache[cityCode] = list
      .map(b => ({ name: b.name.trim(), code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return barangaysCache[cityCode];
  }

  function findByName(list, name) {
    if (!name || !list?.length) return null;
    const target = name.trim().toLowerCase();
    return list.find(item => item.name.toLowerCase() === target)
      || list.find(item => item.name.toLowerCase().includes(target))
      || null;
  }

  function createCombobox({ id, label, placeholder, required, disabled }) {
    return `
      <div class="form-group address-combobox-wrap" id="wrap_${id}">
        <label for="${id}Display">${label}${required ? ' *' : ''}</label>
        <input type="hidden" id="${id}" value="">
        <input type="hidden" id="${id}Code" value="">
        <div class="address-combobox ${disabled ? 'disabled' : ''}" data-field="${id}">
          <input type="text" id="${id}Display" class="form-control address-combobox-input"
            placeholder="${placeholder}" autocomplete="off" ${disabled ? 'disabled' : ''} ${required ? 'required' : ''}>
          <div class="address-combobox-dropdown" id="${id}Dropdown" hidden></div>
        </div>
        <small class="field-hint address-combobox-hint" id="${id}Hint"></small>
      </div>`;
  }

  class Combobox {
    constructor(field, options) {
      this.field = field;
      this.options = options;
      this.items = [];
      this.selected = null;
      this.highlight = -1;

      this.hidden = document.getElementById(field);
      this.hiddenCode = document.getElementById(`${field}Code`);
      this.input = document.getElementById(`${field}Display`);
      this.dropdown = document.getElementById(`${field}Dropdown`);
      this.wrap = document.querySelector(`.address-combobox[data-field="${field}"]`);
      this.hint = document.getElementById(`${field}Hint`);

      this.onSelect = options.onSelect;
      this.bindEvents();
    }

    bindEvents() {
      this.input?.addEventListener('focus', () => this.open());
      this.input?.addEventListener('click', () => this.open());
      this.input?.addEventListener('input', () => {
        this.selected = null;
        if (this.hidden) this.hidden.value = '';
        if (this.hiddenCode) this.hiddenCode.value = '';
        this.filterAndRender(this.input.value);
        this.open();
      });
      this.input?.addEventListener('keydown', e => this.onKeydown(e));
      document.addEventListener('click', e => {
        if (!this.wrap?.contains(e.target)) this.close();
      });
    }

    onKeydown(e) {
      const visible = this.getVisibleItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlight = Math.min(this.highlight + 1, visible.length - 1);
        this.renderList(this.input.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlight = Math.max(this.highlight - 1, 0);
        this.renderList(this.input.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (visible[this.highlight]) this.choose(visible[this.highlight]);
      } else if (e.key === 'Escape') {
        this.close();
      }
    }

    getVisibleItems() {
      const q = (this.input?.value || '').trim().toLowerCase();
      if (!q) return this.items;
      return this.items.filter(item => item.name.toLowerCase().includes(q));
    }

    setItems(items) {
      this.items = items || [];
      this.highlight = -1;
      this.renderList(this.input?.value || '');
    }

    setDisabled(disabled, message = '') {
      if (this.input) this.input.disabled = disabled;
      this.wrap?.classList.toggle('disabled', disabled);
      if (this.hint) this.hint.textContent = message || '';
      if (disabled) {
        this.clear(false);
        this.close();
      }
    }

    setValue(name, code) {
      if (!name) {
        this.clear(false);
        return;
      }
      const match = this.items.find(i => i.code === code) || findByName(this.items, name);
      if (match) {
        this.choose(match, false);
      } else {
        if (this.hidden) this.hidden.value = name;
        if (this.hiddenCode) this.hiddenCode.value = code || '';
        if (this.input) this.input.value = name;
        this.selected = { name, code: code || '' };
      }
    }

    clear(trigger = true) {
      this.selected = null;
      if (this.hidden) this.hidden.value = '';
      if (this.hiddenCode) this.hiddenCode.value = '';
      if (this.input) this.input.value = '';
      if (trigger && this.onSelect) this.onSelect(null);
    }

    choose(item, trigger = true) {
      this.selected = item;
      if (this.hidden) this.hidden.value = item.name;
      if (this.hiddenCode) this.hiddenCode.value = item.code;
      if (this.input) this.input.value = item.name;
      this.close();
      if (trigger && this.onSelect) this.onSelect(item);
    }

    filterAndRender(query) {
      this.highlight = -1;
      this.renderList(query);
    }

    renderList(query = '') {
      if (!this.dropdown) return;
      const visible = this.getVisibleItems();
      if (!visible.length) {
        this.dropdown.innerHTML = '<div class="address-combobox-empty">No matches found</div>';
        return;
      }
      this.dropdown.innerHTML = visible.map((item, idx) => `
        <button type="button" class="address-combobox-option ${idx === this.highlight ? 'active' : ''}"
          data-code="${item.code}" data-name="${item.name.replace(/"/g, '&quot;')}">${item.name}</button>
      `).join('');

      this.dropdown.querySelectorAll('.address-combobox-option').forEach((btn, idx) => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          this.choose(visible[idx]);
        });
      });
    }

    open() {
      if (!this.dropdown || this.input?.disabled) return;
      this.dropdown.hidden = false;
      this.renderList(this.input.value);
      this.positionDropdown();
    }

    positionDropdown() {
      if (!this.dropdown || !this.input) return;

      this.dropdown.classList.remove('drop-up');
      this.dropdown.style.maxHeight = '';

      const rect = this.input.getBoundingClientRect();
      const margin = 12;
      const preferred = 220;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;

      if (spaceBelow < 140 && spaceAbove > spaceBelow) {
        this.dropdown.classList.add('drop-up');
        this.dropdown.style.maxHeight = `${Math.min(preferred, Math.max(96, spaceAbove))}px`;
      } else {
        this.dropdown.style.maxHeight = `${Math.min(preferred, Math.max(96, spaceBelow))}px`;
      }
    }

    close() {
      if (this.dropdown) this.dropdown.hidden = true;
    }
  }

  let provinceBox = null;
  let cityBox = null;
  let barangayBox = null;
  let provinceMeta = null;

  async function mount(values = {}, onChange) {
    provinceBox = new Combobox('province', {
      onSelect: async item => {
        cityBox?.clear();
        barangayBox?.clear();
        cityBox?.setDisabled(true, 'Select a province first');
        barangayBox?.setDisabled(true, 'Select a city / municipality first');
        if (onChange) onChange('province', item?.name || '', item?.code || '');

        if (!item) return;
        provinceMeta = item;
        cityBox?.setDisabled(true, 'Loading cities...');
        try {
          const cities = await loadCities(item.code, item.isNcr || item.code === NCR_CODE);
          cityBox?.setItems(cities);
          cityBox?.setDisabled(false, 'Type to search city / municipality');
        } catch (err) {
          cityBox?.setDisabled(true, 'Could not load cities. Check your connection.');
        }
      }
    });

    cityBox = new Combobox('city', {
      onSelect: async item => {
        barangayBox?.clear();
        barangayBox?.setDisabled(true, 'Select a city / municipality first');
        if (onChange) onChange('city', item?.name || '', item?.code || '');

        if (!item) return;
        barangayBox?.setDisabled(true, 'Loading barangays...');
        try {
          const barangays = await loadBarangays(item.code);
          barangayBox?.setItems(barangays);
          barangayBox?.setDisabled(false, 'Type to search barangay');
        } catch (err) {
          barangayBox?.setDisabled(true, 'Could not load barangays. Check your connection.');
        }
      }
    });

    barangayBox = new Combobox('barangay', {
      onSelect: item => {
        if (onChange) onChange('barangay', item?.name || '', item?.code || '');
      }
    });

    cityBox.setDisabled(true, 'Select a province first');
    barangayBox.setDisabled(true, 'Select a city / municipality first');

    provinceBox.setDisabled(true, 'Loading provinces...');
    try {
      const provinces = await loadProvinces();
      provinceBox.setItems(provinces);
      provinceBox.setDisabled(false, 'Type to search province');

      if (values.province) {
        const prov = findByName(provinces, values.province)
          || (values.provinceCode ? provinces.find(p => p.code === values.provinceCode) : null);
        if (prov) {
          provinceMeta = prov;
          provinceBox.setValue(prov.name, prov.code);
          const cities = await loadCities(prov.code, prov.isNcr || prov.code === NCR_CODE);
          cityBox.setItems(cities);
          cityBox.setDisabled(false, 'Type to search city / municipality');

          if (values.city) {
            const city = findByName(cities, values.city)
              || (values.cityCode ? cities.find(c => c.code === values.cityCode) : null);
            if (city) {
              cityBox.setValue(city.name, city.code);
              const barangays = await loadBarangays(city.code);
              barangayBox.setItems(barangays);
              barangayBox.setDisabled(false, 'Type to search barangay');

              if (values.barangay) {
                const brgy = findByName(barangays, values.barangay)
                  || (values.barangayCode ? barangays.find(b => b.code === values.barangayCode) : null);
                if (brgy) barangayBox.setValue(brgy.name, brgy.code);
                else barangayBox.setValue(values.barangay, values.barangayCode || '');
              }
            } else {
              cityBox.setValue(values.city, values.cityCode || '');
            }
          }
        } else {
          provinceBox.setValue(values.province, values.provinceCode || '');
        }
      }
    } catch (err) {
      provinceBox.setDisabled(false, 'Could not load provinces. Refresh the page or check your connection.');
      console.error(err);
    }
  }

  function html() {
    return `
      ${createCombobox({ id: 'province', label: 'Province', placeholder: 'Search province...', required: true })}
      ${createCombobox({ id: 'city', label: 'City / Municipality', placeholder: 'Search city / municipality...', required: true, disabled: true })}
      ${createCombobox({ id: 'barangay', label: 'Barangay', placeholder: 'Search barangay...', required: true, disabled: true })}
    `;
  }

  return { html, mount, loadProvinces };
})();
