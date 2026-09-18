// GCash QR Code Payment Module

const GcashPayment = (() => {
  let modalEl = null;
  let config = null;
  let receiptFile = null;
  let onConfirmCallback = null;

  function formatPeso(amount) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);
  }

  function sanitizeBrandName(name) {
    return String(name || '')
      .replace(/\bgeranova\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'Enrollment Management System';
  }

  function normalizeGcashConfig(raw) {
    const cfg = { ...raw };
    cfg.merchantName = sanitizeBrandName(cfg.merchantName);
    cfg.schoolName = sanitizeBrandName(cfg.schoolName || cfg.merchantName);
    return cfg;
  }

  async function loadConfig() {
    if (config) return config;
    try {
      const res = await fetch('/api/payment/gcash/config');
      const data = await res.json();
      if (data.success) {
        config = normalizeGcashConfig(data);
        return config;
      }
    } catch (err) {
      console.warn('Could not load GCash config:', err);
    }
    config = normalizeGcashConfig({
      merchantName: 'Enrollment Management System',
      merchantNumber: '0945 661 0582',
      qrImage: '/assets/gcash-qr.png',
      amount: window.SUPABASE_CONFIG?.enrollmentFee || 2500,
      schoolName: 'Enrollment Management System',
    });
    return config;
  }

  function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'gcash-overlay';
    modalEl.innerHTML = `
      <div class="gcash-qr-modal" role="dialog" aria-modal="true" aria-label="GCash QR Payment">
        <div class="gcash-modal-header">
          <img src="/assets/gcash-logo.svg" alt="GCash" class="gcash-logo">
          <div class="gcash-modal-header-text">
            <span class="gcash-modal-title">GCash Payment</span>
            <span class="gcash-modal-subtitle">Scan QR and confirm your payment</span>
          </div>
          <button type="button" class="gcash-close" aria-label="Close">&times;</button>
        </div>

        <div class="gcash-qr-body">
          <div class="gcash-pay-summary">
            <div class="gcash-pay-summary-info">
              <p class="gcash-qr-merchant" id="qrMerchantName"></p>
              <p class="gcash-qr-number" id="qrMerchantNumber"></p>
            </div>
            <div class="gcash-pay-amount-box">
              <span class="gcash-qr-amount-label">Amount to pay</span>
              <span class="gcash-qr-amount" id="qrAmount"></span>
            </div>
          </div>

          <div class="gcash-qr-card">
            <div class="gcash-qr-image-wrap">
              <img id="qrCodeImage" src="" alt="GCash QR Code" class="gcash-qr-image">
            </div>
            <p class="gcash-qr-scan-label">Scan this QR code using your GCash app</p>
          </div>

          <div class="gcash-steps">
            <div class="gcash-step">
              <span class="gcash-step-num">1</span>
              <span>Open the <strong>GCash</strong> app on your phone</span>
            </div>
            <div class="gcash-step">
              <span class="gcash-step-num">2</span>
              <span>Tap <strong>Scan</strong> and scan the QR code above</span>
            </div>
            <div class="gcash-step">
              <span class="gcash-step-num">3</span>
              <span>Pay the exact amount shown and save your receipt</span>
            </div>
          </div>

          <div class="gcash-after-payment">
            <h4 class="gcash-after-title">After Payment</h4>
            <p class="gcash-after-desc">Enter your transaction details below to confirm payment.</p>

            <div class="gcash-qr-form">
              <div class="gcash-form-grid">
                <div class="form-group">
                  <label for="qrReference">Reference Number *</label>
                  <input type="text" id="qrReference" class="form-control" placeholder="e.g. 1234567890123">
                </div>
                <div class="form-group">
                  <label for="qrSenderName">Sender Name *</label>
                  <input type="text" id="qrSenderName" class="form-control" placeholder="Name on GCash account">
                </div>
                <div class="form-group full-width">
                  <label for="qrAmountPaid">Amount Paid *</label>
                  <input type="number" id="qrAmountPaid" class="form-control" step="0.01" min="0" placeholder="0.00">
                </div>
              </div>

              <div class="gcash-receipt-card">
                <div class="gcash-receipt-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div class="gcash-receipt-body">
                  <span class="gcash-receipt-label">Payment Receipt *</span>
                  <span class="gcash-receipt-file" id="qrReceiptLabel">JPG, PNG, or PDF — screenshot of payment</span>
                </div>
                <label class="gcash-receipt-btn">
                  Upload
                  <input type="file" id="qrReceiptFile" accept=".jpg,.jpeg,.png,.pdf" hidden>
                </label>
              </div>

              <p class="gcash-error" id="qrFormError"></p>
              <button type="button" class="gcash-pay-btn" id="qrConfirmBtn">Confirm Payment</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('.gcash-close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
    modalEl.querySelector('#qrReceiptFile').addEventListener('change', e => {
      receiptFile = e.target.files[0] || null;
      const label = modalEl.querySelector('#qrReceiptLabel');
      const card = modalEl.querySelector('.gcash-receipt-card');
      if (receiptFile && typeof AdmissionValidation !== 'undefined') {
        const check = AdmissionValidation.validateFile(receiptFile, { kind: 'payment' });
        if (!check.ok) {
          showError(check.message);
          receiptFile = null;
          e.target.value = '';
          label.textContent = 'JPG, PNG, or PDF — screenshot of payment';
          card?.classList.remove('has-file');
          return;
        }
      }
      if (receiptFile) {
        label.textContent = receiptFile.name;
        card?.classList.add('has-file');
      } else {
        label.textContent = 'JPG, PNG, or PDF — screenshot of payment';
        card?.classList.remove('has-file');
      }
    });
    modalEl.querySelector('#qrConfirmBtn').addEventListener('click', confirmPayment);

    return modalEl;
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  function showError(msg) {
    const el = modalEl?.querySelector('#qrFormError');
    if (el) el.textContent = msg || '';
  }

  function confirmPayment() {
    const reference = modalEl.querySelector('#qrReference').value.trim();
    const senderName = modalEl.querySelector('#qrSenderName').value.trim();
    const amountPaid = modalEl.querySelector('#qrAmountPaid').value.trim();
    const expectedAmount = Number(config?.amount || 0);

    if (!reference) { showError('Reference number is required.'); return; }
    if (!senderName) { showError('Sender name is required.'); return; }
    if (!amountPaid || Number(amountPaid) <= 0) { showError('Enter the amount you paid.'); return; }
    if (expectedAmount > 0 && Math.abs(Number(amountPaid) - expectedAmount) > 0.01) {
      showError(`Amount paid must match ${formatPeso(expectedAmount)}.`);
      return;
    }
    if (!receiptFile) { showError('Please upload your payment receipt (JPG, PNG, or PDF).'); return; }

    if (typeof AdmissionValidation !== 'undefined') {
      const check = AdmissionValidation.validateFile(receiptFile, { kind: 'payment' });
      if (!check.ok) {
        showError(check.message);
        return;
      }
    } else {
      const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowed.includes(receiptFile.type) && !/\.(jpe?g|png|pdf)$/i.test(receiptFile.name)) {
        showError('Receipt must be JPG, PNG, or PDF.');
        return;
      }
    }

    showError('');
    closeModal();
    if (onConfirmCallback) {
      onConfirmCallback({
        reference,
        senderName,
        amountPaid,
        receiptFile,
        paymentStatus: 'submitted',
      });
    }
  }

  function resolveAssetUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
    return '/' + String(path).replace(/^\.?\//, '');
  }

  async function openModal(existingData, onConfirm) {
    onConfirmCallback = onConfirm;
    receiptFile = existingData?.receiptFile || null;
    const cfg = await loadConfig();
    const modal = ensureModal();

    modal.querySelector('#qrMerchantName').textContent = cfg.merchantName;
    modal.querySelector('#qrMerchantNumber').textContent = cfg.merchantNumber;
    modal.querySelector('#qrAmount').textContent = formatPeso(cfg.amount);
    modal.querySelector('#qrCodeImage').src = resolveAssetUrl(cfg.qrImage);
    modal.querySelector('#qrCodeImage').onerror = function () { this.src = '/assets/gcash-qr.svg'; };

    modal.querySelector('#qrReference').value = existingData?.reference || '';
    modal.querySelector('#qrSenderName').value = existingData?.senderName || '';
    modal.querySelector('#qrAmountPaid').value = existingData?.amountPaid || cfg.amount || '';

    const receiptLabel = modal.querySelector('#qrReceiptLabel');
    const receiptCard = modal.querySelector('.gcash-receipt-card');
    if (receiptFile) {
      receiptLabel.textContent = receiptFile.name;
      receiptCard?.classList.add('has-file');
    } else {
      receiptLabel.textContent = existingData?.receiptName || 'JPG, PNG, or PDF — screenshot of payment';
      receiptCard?.classList.remove('has-file');
    }

    showError('');
    modal.style.display = 'flex';
  }

  return { openModal, closeModal, formatPeso, loadConfig };
})();
