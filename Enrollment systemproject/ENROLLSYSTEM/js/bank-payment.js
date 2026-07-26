// Bank transfer payment modal (BPI / UnionBank)

const BankPayment = (() => {
  const BANKS = {
    bpi: {
      name: 'BPI',
      accountName: 'Geranova Senior High School',
      accountNumber: '1234-5678-90',
      branch: 'Main Branch',
    },
    unionbank: {
      name: 'UnionBank',
      accountName: 'Geranova Senior High School',
      accountNumber: '1098-7654-3210',
      branch: 'Main Branch',
    },
  };

  let modalEl = null;
  let receiptFile = null;
  let onConfirmCallback = null;
  let activeBank = null;

  function formatPeso(amount) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);
  }

  function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'gcash-overlay bank-overlay';
    modalEl.innerHTML = `
      <div class="gcash-qr-modal bank-modal" role="dialog" aria-modal="true" aria-label="Bank Transfer Payment">
        <div class="gcash-modal-header">
          <span class="bank-modal-logo" id="bankModalLogo">BPI</span>
          <span id="bankModalTitle">Bank Transfer</span>
          <button type="button" class="gcash-close" aria-label="Close">&times;</button>
        </div>
        <div class="gcash-qr-body">
          <div class="bank-transfer-details">
            <p class="bank-transfer-label">Transfer to</p>
            <p class="bank-transfer-name" id="bankAccountName"></p>
            <p class="bank-transfer-number" id="bankAccountNumber"></p>
            <p class="bank-transfer-branch" id="bankBranch"></p>
            <p class="gcash-qr-amount" id="bankAmount"></p>
            <p class="gcash-qr-amount-label">Amount to pay</p>
          </div>
          <div class="gcash-qr-divider"><span>After Payment</span></div>
          <div class="gcash-qr-form">
            <div class="form-group">
              <label for="bankReference">Reference / Transaction Number *</label>
              <input type="text" id="bankReference" class="form-control" placeholder="e.g. 1234567890123">
            </div>
            <div class="form-group">
              <label for="bankSenderName">Account Holder Name *</label>
              <input type="text" id="bankSenderName" class="form-control" placeholder="Name on bank account">
            </div>
            <div class="form-group">
              <label for="bankAmountPaid">Amount Paid *</label>
              <input type="number" id="bankAmountPaid" class="form-control" step="0.01" min="0" placeholder="0.00">
            </div>
            <div class="doc-upload-item gcash-receipt-upload">
              <div class="doc-upload-info">
                <span class="doc-upload-label">Payment Receipt (screenshot) *</span>
                <span class="doc-upload-file" id="bankReceiptLabel">No file chosen</span>
              </div>
              <label class="btn-secondary sm doc-upload-btn">
                Choose File
                <input type="file" id="bankReceiptFile" accept=".jpg,.jpeg,.png,.pdf" hidden>
              </label>
            </div>
            <p class="gcash-error" id="bankFormError"></p>
            <button type="button" class="gcash-pay-btn" id="bankConfirmBtn">Confirm Payment</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('.gcash-close').addEventListener('click', closeModal);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
    modalEl.querySelector('#bankReceiptFile').addEventListener('change', e => {
      receiptFile = e.target.files[0] || null;
      modalEl.querySelector('#bankReceiptLabel').textContent = receiptFile ? receiptFile.name : 'No file chosen';
    });
    modalEl.querySelector('#bankConfirmBtn').addEventListener('click', confirmPayment);

    return modalEl;
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  function showError(msg) {
    const el = modalEl?.querySelector('#bankFormError');
    if (el) el.textContent = msg || '';
  }

  function confirmPayment() {
    const reference = modalEl.querySelector('#bankReference').value.trim();
    const senderName = modalEl.querySelector('#bankSenderName').value.trim();
    const amountPaid = modalEl.querySelector('#bankAmountPaid').value.trim();
    const expectedAmount = Number(window.SUPABASE_CONFIG?.enrollmentFee || 2500);

    if (!reference) { showError('Reference number is required.'); return; }
    if (!senderName) { showError('Account holder name is required.'); return; }
    if (!amountPaid || Number(amountPaid) <= 0) { showError('Enter the amount you paid.'); return; }
    if (expectedAmount > 0 && Math.abs(Number(amountPaid) - expectedAmount) > 0.01) {
      showError(`Amount paid must match ${formatPeso(expectedAmount)}.`);
      return;
    }
    if (!receiptFile) { showError('Please upload your payment receipt (JPG, PNG, or PDF).'); return; }

    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(receiptFile.type) && !/\.(jpe?g|png|pdf)$/i.test(receiptFile.name)) {
      showError('Receipt must be JPG, PNG, or PDF.');
      return;
    }

    showError('');
    closeModal();
    if (onConfirmCallback) {
      onConfirmCallback({
        bankCode: activeBank,
        reference,
        senderName,
        amountPaid,
        receiptFile,
        paymentStatus: 'submitted',
      });
    }
  }

  function openModal(bankCode, existingData, onConfirm) {
    activeBank = bankCode;
    onConfirmCallback = onConfirm;
    receiptFile = existingData?.receiptFile || null;
    const bank = BANKS[bankCode];
    if (!bank) return;

    const modal = ensureModal();
    const logoEl = modal.querySelector('#bankModalLogo');
    logoEl.textContent = bank.name === 'BPI' ? 'BPI' : 'UB';
    logoEl.className = `bank-modal-logo ${bankCode}`;

    modal.querySelector('#bankModalTitle').textContent = `${bank.name} Transfer`;
    modal.querySelector('#bankAccountName').textContent = bank.accountName;
    modal.querySelector('#bankAccountNumber').textContent = bank.accountNumber;
    modal.querySelector('#bankBranch').textContent = bank.branch;
    modal.querySelector('#bankAmount').textContent = formatPeso(window.SUPABASE_CONFIG?.enrollmentFee || 2500);

    modal.querySelector('#bankReference').value = existingData?.reference || '';
    modal.querySelector('#bankSenderName').value = existingData?.senderName || '';
    modal.querySelector('#bankAmountPaid').value = existingData?.amountPaid || window.SUPABASE_CONFIG?.enrollmentFee || '';
    modal.querySelector('#bankReceiptLabel').textContent = receiptFile
      ? receiptFile.name
      : (existingData?.receiptName || 'No file chosen');

    showError('');
    modal.style.display = 'flex';
  }

  function getBankLabel(bankCode) {
    return BANKS[bankCode]?.name || '';
  }

  return { openModal, closeModal, formatPeso, getBankLabel, BANKS };
})();
