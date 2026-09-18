const AdmissionValidation = {
  MIN_SHS_AGE: 14,
  MAX_SHS_AGE: 25,
  MAX_PROFILE_PHOTO_BYTES: 5 * 1024 * 1024,
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
  MAX_PAYMENT_PROOF_BYTES: 10 * 1024 * 1024,
  EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  CONTACT_RE: /^09\d{9}$/,
  VALID_GENDERS: new Set(['male', 'female']),

  normalizeContact(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('639') && digits.length === 12) {
      digits = `0${digits.slice(2)}`;
    } else if (digits.startsWith('63') && digits.length === 12) {
      digits = `0${digits.slice(2)}`;
    }
    return digits;
  },

  isValidEmail(value) {
    return this.EMAIL_RE.test(String(value || '').trim());
  },

  isValidContact(value) {
    return this.CONTACT_RE.test(this.normalizeContact(value));
  },

  isValidGender(value) {
    return this.VALID_GENDERS.has(String(value || '').trim().toLowerCase());
  },

  validateBirthdateAge(iso) {
    const text = String(iso || '').trim();
    if (!text) {
      return { ok: false, message: 'Birthdate is required.' };
    }

    const parts = text.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return { ok: false, message: 'Please enter a valid birthdate.' };
    }

    const [year, month, day] = parts;
    const born = new Date(year, month - 1, day);
    if (
      born.getFullYear() !== year
      || born.getMonth() !== month - 1
      || born.getDate() !== day
    ) {
      return { ok: false, message: 'Please enter a valid birthdate.' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (born > today) {
      return { ok: false, message: 'Birthdate cannot be in the future.' };
    }

    let age = today.getFullYear() - born.getFullYear();
    const monthDiff = today.getMonth() - born.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) {
      age -= 1;
    }

    if (age < this.MIN_SHS_AGE) {
      return {
        ok: false,
        message: `You must be at least ${this.MIN_SHS_AGE} years old to enroll in Enrollment Management System.`,
      };
    }
    if (age > this.MAX_SHS_AGE) {
      return {
        ok: false,
        message: `Birthdate indicates age over ${this.MAX_SHS_AGE}. Please contact the registrar if this is incorrect.`,
      };
    }

    return { ok: true, message: '' };
  },

  extension(name) {
    const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : '';
  },

  validateFile(file, kind) {
    if (!file) {
      return { ok: false, message: 'Please choose a file to upload.' };
    }

    const rules = {
      profile: {
        label: 'Profile photo',
        maxBytes: this.MAX_PROFILE_PHOTO_BYTES,
        extensions: ['.jpg', '.jpeg', '.png', '.webp'],
        mimes: ['image/jpeg', 'image/png', 'image/webp'],
      },
      document: {
        label: 'Document upload',
        maxBytes: this.MAX_DOCUMENT_BYTES,
        extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
        mimes: ['application/pdf', 'image/jpeg', 'image/png'],
      },
      payment: {
        label: 'Payment receipt',
        maxBytes: this.MAX_PAYMENT_PROOF_BYTES,
        extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
        mimes: ['application/pdf', 'image/jpeg', 'image/png'],
      },
    };

    const rule = rules[kind] || rules.document;
    if (file.size > rule.maxBytes) {
      const maxMb = Math.round(rule.maxBytes / (1024 * 1024));
      return { ok: false, message: `${rule.label} must be ${maxMb} MB or smaller.` };
    }

    const ext = this.extension(file.name);
    const mimeOk = !file.type || rule.mimes.includes(file.type);
    const extOk = rule.extensions.includes(ext);
    if (!mimeOk && !extOk) {
      return {
        ok: false,
        message: `${rule.label} must be ${rule.extensions.map(item => item.replace('.', '').toUpperCase()).join(', ')}.`,
      };
    }

    return { ok: true, message: '' };
  },
};
