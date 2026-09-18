// SHS curriculum from SHS-Subjects.docx — keep in sync with enrollment_curriculum.py

const ENROLLMENT_TRACKS = {
  "Academic": {
    "label": "Academic Track",
    "strands": [
      "STEM",
      "ABM",
      "HUMSS"
    ]
  },
  "TechPro": {
    "label": "Technical-Professional (TechPro)",
    "strands": [
      "ICT",
      "COOKERY",
      "EIM"
    ]
  }
};

const ENROLLMENT_STRANDS = ["STEM", "ABM", "HUMSS", "ICT", "COOKERY", "EIM"];

const ENROLLMENT_CURRICULUM = {
  "Grade 11": {
    "1st": {
      core: [
          { code: "G11-C01", description: "Oral Communication in Context", lec: 3, lab: 0, units: 3 },
          { code: "G11-C02", description: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", lec: 3, lab: 0, units: 3 },
          { code: "G11-C03", description: "General Mathematics", lec: 3, lab: 0, units: 3 },
          { code: "G11-C04", description: "Earth and Life Science", lec: 3, lab: 0, units: 3 },
          { code: "G11-C05", description: "Personal Development", lec: 3, lab: 0, units: 3 },
          { code: "G11-PE1", description: "Physical Education and Health 1", lec: 2, lab: 0, units: 2 }
        ],
      applied: [
          { code: "G11-A01", description: "Empowerment Technologies", lec: 3, lab: 0, units: 3 }
        ],
      specialized: {
        STEM: [
          { code: "G11-STEM-01", description: "Pre-Calculus", lec: 4, lab: 0, units: 4 },
          { code: "G11-STEM-02", description: "General Biology 1", lec: 3, lab: 1, units: 4 },
          { code: "G11-STEM-03", description: "Earth Science", lec: 3, lab: 0, units: 3 }
        ],
        ABM: [
          { code: "G11-ABM-01", description: "Organization and Management", lec: 3, lab: 0, units: 3 },
          { code: "G11-ABM-02", description: "Applied Economics", lec: 3, lab: 0, units: 3 }
        ],
        HUMSS: [
          { code: "G11-HUM-01", description: "Disciplines and Ideas in the Social Sciences", lec: 3, lab: 0, units: 3 },
          { code: "G11-HUM-02", description: "Creative Writing", lec: 3, lab: 0, units: 3 },
          { code: "G11-HUM-03", description: "Philippine Politics and Governance", lec: 3, lab: 0, units: 3 }
        ],
        GAS: [
          
        ],
        ICT: [
          { code: "G11-ICT-01", description: "CSS NC II \u2013 Install and Configure Computer Systems", lec: 3, lab: 1, units: 4 },
          { code: "G11-ICT-02", description: "CSS NC II \u2013 Set Up Computer Networks", lec: 3, lab: 1, units: 4 }
        ],
        COOKERY: [
          { code: "G11-CK-01", description: "Use Kitchen Tools, Equipment, and Paraphernalia", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-02", description: "Perform Mensuration and Calculation", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-03", description: "Interpret Kitchen Layout", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-04", description: "Practice Occupational Health and Safety Procedures", lec: 3, lab: 1, units: 4 }
        ],
        EIM: [
          { code: "G11-EIM-01", description: "Prepare Electrical Materials and Tools", lec: 3, lab: 1, units: 4 },
          { code: "G11-EIM-02", description: "Interpret Technical Drawings and Plans", lec: 3, lab: 1, units: 4 },
          { code: "G11-EIM-03", description: "Perform Mensuration and Calculation", lec: 3, lab: 1, units: 4 },
          { code: "G11-EIM-04", description: "Practice Occupational Safety and Health Procedures", lec: 3, lab: 1, units: 4 }
        ],
      }
    },
    "2nd": {
      core: [
          { code: "G11-C06", description: "Reading and Writing Skills", lec: 3, lab: 0, units: 3 },
          { code: "G11-C07", description: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", lec: 3, lab: 0, units: 3 },
          { code: "G11-C08", description: "Statistics and Probability", lec: 3, lab: 0, units: 3 },
          { code: "G11-C09", description: "Physical Science", lec: 3, lab: 0, units: 3 },
          { code: "G11-C10", description: "Understanding Culture, Society and Politics", lec: 3, lab: 0, units: 3 },
          { code: "G11-PE2", description: "Physical Education and Health 2", lec: 2, lab: 0, units: 2 }
        ],
      applied: [
          { code: "G11-A02", description: "Practical Research 1", lec: 3, lab: 0, units: 3 }
        ],
      specialized: {
        STEM: [
          { code: "G11-STEM-04", description: "Basic Calculus", lec: 4, lab: 0, units: 4 },
          { code: "G11-STEM-05", description: "General Biology 2", lec: 3, lab: 1, units: 4 },
          { code: "G11-STEM-06", description: "General Physics 1", lec: 3, lab: 1, units: 4 }
        ],
        ABM: [
          { code: "G11-ABM-03", description: "Business Finance", lec: 3, lab: 0, units: 3 },
          { code: "G11-ABM-04", description: "Fundamentals of Accountancy, Business and Management 1", lec: 3, lab: 0, units: 3 }
        ],
        HUMSS: [
          { code: "G11-HUM-04", description: "Disciplines and Ideas in the Applied Social Sciences", lec: 3, lab: 0, units: 3 },
          { code: "G11-HUM-05", description: "Creative Nonfiction", lec: 3, lab: 0, units: 3 },
          { code: "G11-HUM-06", description: "Community Engagement, Solidarity and Citizenship", lec: 3, lab: 0, units: 3 }
        ],
        GAS: [
          
        ],
        ICT: [
          { code: "G11-ICT-03", description: "CSS NC II \u2013 Install Computer Systems and Networks", lec: 3, lab: 1, units: 4 },
          { code: "G11-ICT-04", description: "CSS NC II \u2013 Maintain and Repair Computer Systems and Networks", lec: 3, lab: 1, units: 4 }
        ],
        COOKERY: [
          { code: "G11-CK-05", description: "Clean and Maintain Kitchen Tools, Equipment, and Premises", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-06", description: "Prepare Appetizers", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-07", description: "Prepare Salads and Dressings", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-08", description: "Prepare Sandwiches", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-09", description: "Prepare Egg Dishes", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-10", description: "Prepare Vegetables", lec: 3, lab: 1, units: 4 },
          { code: "G11-CK-11", description: "Prepare Seafood Dishes", lec: 3, lab: 1, units: 4 }
        ],
        EIM: [
          { code: "G11-EIM-05", description: "Install Electrical Lighting System", lec: 3, lab: 1, units: 4 },
          { code: "G11-EIM-06", description: "Install Wiring Devices", lec: 3, lab: 1, units: 4 },
          { code: "G11-EIM-07", description: "Install Conduit, Tubing and Fittings", lec: 3, lab: 1, units: 4 }
        ],
      }
    }
  },
  "Grade 12": {
    "1st": {
      core: [
          { code: "G12-C01", description: "Introduction to the Philosophy of the Human Person", lec: 3, lab: 0, units: 3 },
          { code: "G12-C02", description: "Disaster Readiness and Risk Reduction", lec: 3, lab: 0, units: 3 },
          { code: "G12-PE3", description: "Physical Education and Health 3", lec: 2, lab: 0, units: 2 }
        ],
      applied: [
          { code: "G12-A01", description: "English for Academic and Professional Purposes", lec: 3, lab: 0, units: 3 },
          { code: "G12-A02", description: "Entrepreneurship", lec: 3, lab: 0, units: 3 },
          { code: "G12-A03", description: "Filipino sa Piling Larang", lec: 3, lab: 0, units: 3 }
        ],
      specialized: {
        STEM: [
          { code: "G12-STEM-01", description: "General Chemistry 1", lec: 3, lab: 1, units: 4 },
          { code: "G12-STEM-02", description: "General Physics 2", lec: 3, lab: 1, units: 4 }
        ],
        ABM: [
          { code: "G12-ABM-01", description: "Fundamentals of Accountancy, Business and Management 2", lec: 3, lab: 0, units: 3 },
          { code: "G12-ABM-02", description: "Business Ethics and Social Responsibility", lec: 3, lab: 0, units: 3 }
        ],
        HUMSS: [
          { code: "G12-HUM-01", description: "Trends, Networks and Critical Thinking in the 21st Century", lec: 3, lab: 0, units: 3 }
        ],
        GAS: [
          
        ],
        ICT: [
          { code: "G12-ICT-01", description: "CSS NC II \u2013 Diagnose and Troubleshoot Computer Systems", lec: 3, lab: 1, units: 4 },
          { code: "G12-ICT-02", description: "CSS NC II \u2013 Configure Network Services", lec: 3, lab: 1, units: 4 }
        ],
        COOKERY: [
          { code: "G12-CK-01", description: "Prepare Stocks, Sauces and Soups", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-02", description: "Prepare Poultry and Game Dishes", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-03", description: "Prepare Meat Dishes", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-04", description: "Prepare Desserts", lec: 3, lab: 1, units: 4 }
        ],
        EIM: [
          { code: "G12-EIM-01", description: "Install Electrical Protection System", lec: 3, lab: 1, units: 4 },
          { code: "G12-EIM-02", description: "Install Electrical Control System", lec: 3, lab: 1, units: 4 },
          { code: "G12-EIM-03", description: "Maintain and Repair Electrical Systems", lec: 3, lab: 1, units: 4 }
        ],
      }
    },
    "2nd": {
      core: [
          { code: "G12-C03", description: "Contemporary Philippine Arts from the Regions", lec: 3, lab: 0, units: 3 },
          { code: "G12-PE4", description: "Physical Education and Health 4", lec: 2, lab: 0, units: 2 }
        ],
      applied: [
          { code: "G12-A04", description: "Inquiries, Investigations, and Immersion", lec: 3, lab: 0, units: 3 },
          { code: "G12-A05", description: "Practical Research 2", lec: 3, lab: 0, units: 3 },
          { code: "G12-A06", description: "Work Immersion", lec: 3, lab: 0, units: 3 }
        ],
      specialized: {
        STEM: [
          { code: "G12-STEM-03", description: "General Chemistry 2", lec: 3, lab: 1, units: 4 },
          { code: "G12-STEM-04", description: "Research/Capstone", lec: 3, lab: 0, units: 3 }
        ],
        ABM: [
          { code: "G12-ABM-03", description: "Principles of Marketing", lec: 3, lab: 0, units: 3 },
          { code: "G12-ABM-04", description: "Business Enterprise Simulation", lec: 3, lab: 0, units: 3 }
        ],
        HUMSS: [
          { code: "G12-HUM-02", description: "Introduction to World Religions and Belief Systems", lec: 3, lab: 0, units: 3 }
        ],
        GAS: [
          
        ],
        ICT: [
          { code: "G12-ICT-03", description: "Work Immersion", lec: 3, lab: 0, units: 3 },
          { code: "G12-ICT-04", description: "Specialization Enhancement / Entrepreneurship Integration", lec: 3, lab: 0, units: 3 }
        ],
        COOKERY: [
          { code: "G12-CK-05", description: "Prepare Cakes", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-06", description: "Prepare Pastries", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-07", description: "Package Prepared Food", lec: 3, lab: 1, units: 4 },
          { code: "G12-CK-08", description: "Work Immersion", lec: 3, lab: 0, units: 3 }
        ],
        EIM: [
          { code: "G12-EIM-04", description: "Test and Commission Electrical Installation", lec: 3, lab: 1, units: 4 },
          { code: "G12-EIM-05", description: "Work Immersion", lec: 3, lab: 0, units: 3 }
        ],
      }
    }
  }
};

function _gradeNum(gradeLevel) {
  return String(gradeLevel || '').includes('11') ? '11' : '12';
}

function buildStrandSchedules(gradeLevel, semester, subjectCode, dayTime, slots) {
  const gradeNum = _gradeNum(gradeLevel);
  return ENROLLMENT_STRANDS.map((strand, index) => ({
    id: `${subjectCode}-${strand}-${gradeNum}-${semester}-${index + 1}`,
    slots: (slots || 28) - index * 2,
    section: `${strand} ${gradeNum}-A`,
    dayTime: dayTime || 'MW 9:00AM-10:30AM'
  }));
}

function buildEnrollmentSubjectsCatalog() {
  const catalog = [];
  Object.entries(ENROLLMENT_CURRICULUM).forEach(([gradeLevel, semesters]) => {
    Object.entries(semesters).forEach(([semester, config]) => {
      ['core', 'applied'].forEach((category) => {
        (config[category] || []).forEach((item) => {
          catalog.push({
            ...item,
            gradeLevel,
            semester,
            strand: null,
            type: category === 'applied' ? 'applied' : 'core',
            schedules: buildStrandSchedules(gradeLevel, semester, item.code, item.dayTime, 28)
          });
        });
      });
      Object.entries(config.specialized || {}).forEach(([strand, specs]) => {
        const gradeNum = _gradeNum(gradeLevel);
        specs.forEach((spec) => {
          catalog.push({
            ...spec,
            gradeLevel,
            semester,
            strand,
            type: 'specialized',
            schedules: [{
              id: `${spec.code}-${strand}-${gradeNum}-${semester}`,
              slots: 25,
              section: `${strand} ${gradeNum}-A`,
              dayTime: spec.dayTime || 'TTh 1:00PM-2:30PM'
            }]
          });
        });
      });
    });
  });
  return catalog;
}

const ENROLLMENT_SUBJECTS_DEMO = buildEnrollmentSubjectsCatalog();

function subjectsForTerm(strandCode, gradeLevel, semesterCode) {
  const code = String(strandCode || 'STEM').toUpperCase();
  const config = (ENROLLMENT_CURRICULUM[gradeLevel] || {})[semesterCode] || {};
  const shared = [...(config.core || []), ...(config.applied || [])].map((item) => ({
    ...item,
    strand: null,
    type: 'core'
  }));
  const specialized = (config.specialized || {})[code] || [];
  return shared.concat(specialized.map((item) => ({ ...item, strand: code, type: 'specialized' })));
}

function requiredSubjectsCount(strandCode, gradeLevel, semesterCode) {
  return subjectsForTerm(strandCode, gradeLevel, semesterCode).length;
}

const ENROLLMENT_SECTION_NAMES_BY_GRADE = {
  'Grade 12': {
    STEM: ['Rizal', 'Bonifacio'],
    ABM: ['Aguinaldo', 'Mabini'],
    HUMSS: ['Luna', 'Jacinto'],
    ICT: ['Zamora', 'Gomez'],
    COOKERY: ['Del Pilar', 'Silang'],
    EIM: ['Aquino', 'Malvar'],
  },
  'Grade 11': {
    STEM: ['Hope', 'Fortitude'],
    ABM: ['Faith', 'Integrity'],
    HUMSS: ['Perseverance', 'Courage'],
    ICT: ['Humility', 'Kindness'],
    COOKERY: ['Wisdom', 'Compassion'],
    EIM: ['Resilience', 'Justice'],
  },
};

function sectionSlotName(strandCode, gradeLevel, slotKey) {
  const code = String(strandCode || 'STEM').toUpperCase();
  const slot = String(slotKey || 'A').toUpperCase();
  const names = (ENROLLMENT_SECTION_NAMES_BY_GRADE[gradeLevel] || {})[code];
  if (!names) return slot;
  if (slot === 'A') return names[0];
  if (slot === 'B') return names[1] || slot;
  return slot;
}

function formatSectionName(strandCode, gradeLevel, slotKey) {
  const code = String(strandCode || 'STEM').toUpperCase();
  const gradeNum = String(gradeLevel || '').includes('11') ? '11' : '12';
  return `${code} ${gradeNum}-${sectionSlotName(code, gradeLevel, slotKey)}`;
}

/** Old Supabase section-names.sql labels -> slot A/B (until fix-section-names-match-curriculum.sql is run). */
const LEGACY_SECTION_SUFFIX_TO_SLOT = {
  'Grade 11|ICT': { WISDOM: 'A', COMPASSION: 'B' },
  'Grade 11|COOKERY': { RESILIENCE: 'A', JUSTICE: 'B' },
  'Grade 11|EIM': { HUMILITY: 'A', KINDNESS: 'B' },
  'Grade 12|ICT': { 'DEL PILAR': 'A', SILANG: 'B' },
  'Grade 12|COOKERY': { AQUINO: 'A', MALVAR: 'B' },
  'Grade 12|EIM': { ZAMORA: 'A', GOMEZ: 'B' },
};

function sectionSlotLetterFromSchedule(schedule, strandCode, gradeLevel) {
  const suffix = (() => {
    const raw = String(schedule?.section || schedule?.sectionName || '').trim();
    const dash = raw.lastIndexOf('-');
    return (dash === -1 ? raw : raw.slice(dash + 1)).trim().toUpperCase();
  })();
  if (!suffix) return null;
  for (const slot of ['A', 'B']) {
    if (suffix === sectionSlotName(strandCode, gradeLevel, slot).toUpperCase()) return slot;
  }
  const legacy = LEGACY_SECTION_SUFFIX_TO_SLOT[`${gradeLevel}|${String(strandCode || '').toUpperCase()}`];
  if (legacy && legacy[suffix]) return legacy[suffix];
  if (suffix === 'A' || suffix === 'B') return suffix;
  return null;
}
