// Sample Senior High School student data
const SAMPLE_STUDENT = {
  id: '2026-00145-SHS-0',
  password: 'student123',
  birthMonth: '3',
  birthDay: '15',
  birthYear: '2009',
  lastName: 'SANTOS',
  firstName: 'MARIA CLARA',
  middleName: 'REYES',
  gradeLevel: 'Grade 12',
  strand: 'STEM',
  strandFull: 'STEM - Science, Technology, Engineering, and Mathematics',
  section: 'STEM 12-A',
  track: 'Academic',
  admissionStatus: 'Continuing',
  scholasticStatus: 'Regular',
  schoolYear: '2026-2027',
  semester: 'First Semester'
};

const INBOX_MESSAGES = [
  { date: 'March 28, 2026', title: 'Work Immersion Orientation 2026', hasPdf: true },
  { date: 'February 14, 2026', title: 'Career Guidance Week - STEM Track', hasPdf: true },
  { date: 'January 20, 2026', title: 'Senior High School General Assembly', hasPdf: true },
  { date: 'December 5, 2025', title: 'Enrollment Reminder - Second Semester', hasPdf: false },
  { date: 'November 11, 2025', title: 'College Application Seminar', hasPdf: true },
  { date: 'October 3, 2025', title: 'Science Fair Registration Open', hasPdf: true },
  { date: 'September 15, 2025', title: 'Welcome to School Year 2025-2026', hasPdf: false }
];

const ACCOUNTS_DATA = [
  {
    schoolYear: '2425',
    semester: 'First Semester',
    scholarship: '',
    entries: [
      { orDate: '00/00/0000', orNo: 'TOTAL AMOUNT DUE', assessment: 4250.00, payment: 0, balance: 4250.00, isTotal: true },
      { orDate: '08/15/2024', orNo: 'CASH - SHS Voucher (20240815-001234)', assessment: 0, payment: 4250.00, balance: 0 }
    ]
  },
  {
    schoolYear: '2425',
    semester: 'Second Semester',
    scholarship: '',
    entries: [
      { orDate: '00/00/0000', orNo: 'TOTAL AMOUNT DUE', assessment: 4180.00, payment: 0, balance: 4180.00, isTotal: true },
      { orDate: '01/20/2025', orNo: 'CASH - SHS Voucher (20250120-002156)', assessment: 0, payment: 4180.00, balance: 0 }
    ]
  },
  {
    schoolYear: '2526',
    semester: 'First Semester',
    scholarship: 'SHS Voucher',
    entries: [
      { orDate: '00/00/0000', orNo: 'TOTAL AMOUNT DUE', assessment: 4890.00, payment: 0, balance: 4890.00, isTotal: true },
      { orDate: '08/18/2025', orNo: 'CASH - SHS Voucher (20250818-003421)', assessment: 0, payment: 4890.00, balance: 0 }
    ]
  },
  {
    schoolYear: '2526',
    semester: 'Second Semester',
    scholarship: 'SHS Voucher',
    entries: [
      { orDate: '00/00/0000', orNo: 'TOTAL AMOUNT DUE', assessment: 4720.00, payment: 0, balance: 4720.00, isTotal: true },
      { orDate: '01/22/2026', orNo: 'CASH - SHS Voucher (20260122-004567)', assessment: 0, payment: 4720.00, balance: 0 }
    ]
  }
];

const SCHEDULE_DATA = [
  { code: 'STEM-G11', description: 'General Mathematics', lec: 4, lab: 0, unit: 4, schedule: 'MW 7:30AM-9:00AM' },
  { code: 'STEM-G12', description: 'Pre-Calculus', lec: 4, lab: 0, unit: 4, schedule: 'TTh 7:30AM-9:00AM' },
  { code: 'CORE-01', description: 'Oral Communication in Context', lec: 3, lab: 0, unit: 3, schedule: 'MW 9:00AM-10:30AM' },
  { code: 'CORE-02', description: 'Reading and Writing Skills', lec: 3, lab: 0, unit: 3, schedule: 'TTh 9:00AM-10:30AM' },
  { code: 'STEM-01', description: 'General Chemistry 1', lec: 3, lab: 1, unit: 4, schedule: 'MW 1:00PM-2:30PM' },
  { code: 'STEM-02', description: 'General Physics 1', lec: 3, lab: 1, unit: 4, schedule: 'TTh 1:00PM-2:30PM' },
  { code: 'APPL-01', description: 'Empowerment Technologies', lec: 2, lab: 1, unit: 3, schedule: 'F 7:30AM-10:30AM' },
  { code: 'PE-04', description: 'Physical Education and Health 4', lec: 2, lab: 0, unit: 2, schedule: 'F 1:00PM-3:00PM' }
];

const GRADES_DATA = [
  {
    schoolYear: '2526',
    semester: 'Second Semester',
    subjects: [
      { code: 'STEM-G12', description: 'Pre-Calculus', faculty: 'MR. DELA CRUZ, JUAN', units: 4, sectCode: 'STEM 12-A', finalGrade: '92', status: 'P' },
      { code: 'STEM-02', description: 'General Physics 1', faculty: 'MS. GARCIA, ANA', units: 4, sectCode: 'STEM 12-A', finalGrade: '88', status: 'P' },
      { code: 'CORE-03', description: 'Media and Information Literacy', faculty: 'MR. REYES, CARLOS', units: 3, sectCode: 'STEM 12-A', finalGrade: '95', status: 'P' },
      { code: 'APPL-02', description: 'Practical Research 2', faculty: 'MS. LOPEZ, ELENA', units: 3, sectCode: 'STEM 12-A', finalGrade: '90', status: 'P' },
      { code: 'PE-04', description: 'Physical Education and Health 4', faculty: 'MR. TORRES, MIGUEL', units: 2, sectCode: 'STEM 12-A', finalGrade: '94', status: 'P' }
    ],
    gpa: '91.80'
  },
  {
    schoolYear: '2526',
    semester: 'First Semester',
    subjects: [
      { code: 'STEM-G11', description: 'General Mathematics', faculty: 'MR. DELA CRUZ, JUAN', units: 4, sectCode: 'STEM 12-A', finalGrade: '91', status: 'P' },
      { code: 'STEM-01', description: 'General Chemistry 1', faculty: 'MS. MENDOZA, ROSA', units: 4, sectCode: 'STEM 12-A', finalGrade: '87', status: 'P' },
      { code: 'CORE-01', description: 'Oral Communication in Context', faculty: 'MS. FLORES, DIANA', units: 3, sectCode: 'STEM 12-A', finalGrade: '93', status: 'P' },
      { code: 'CORE-02', description: 'Reading and Writing Skills', faculty: 'MR. RAMOS, PEDRO', units: 3, sectCode: 'STEM 12-A', finalGrade: '89', status: 'P' },
      { code: 'APPL-01', description: 'Empowerment Technologies', faculty: 'MR. REYES, CARLOS', units: 3, sectCode: 'STEM 12-A', finalGrade: '96', status: 'P' }
    ],
    gpa: '91.20'
  }
];

// Subject catalog for enrollment lives in js/enrollment-curriculum.js

const FORMS_LIST = [
  'Work Immersion Memorandum of Agreement',
  'SHS Enrollment Waiver Form',
  'Parent-Guardian Consent Form',
  'Strand Shifting Request Form',
  'Good Moral Certificate Request'
];

// Faculty accounts
const SAMPLE_FACULTY = {
  id: 'FAC-2026-0001',
  password: 'faculty123',
  birthMonth: '6',
  birthDay: '10',
  birthYear: '1985',
  lastName: 'DELA CRUZ',
  firstName: 'JUAN',
  middleName: 'MARTINEZ',
  role: 'Registrar',
  department: 'Registrar Office',
  lastLogin: 'Jul 12, 2026 8:30 AM'
};

const FACULTY_LIST = [
  SAMPLE_FACULTY,
  {
    id: 'FAC-2026-0002',
    lastName: 'GARCIA',
    firstName: 'ANA',
    middleName: 'LOUISE',
    role: 'Teacher',
    department: 'STEM Department',
    lastLogin: 'Jul 11, 2026 3:45 PM'
  },
  {
    id: 'FAC-2026-0003',
    lastName: 'TORRES',
    firstName: 'MIGUEL',
    middleName: 'ANGELO',
    role: 'Guidance Counselor',
    department: 'Guidance Office',
    lastLogin: 'Jul 10, 2026 9:00 AM'
  }
];

const FACULTY_DASHBOARD = {
  totalStudents: 248,
  totalStrands: 4,
  pendingEnrollments: 3,
  totalAdmissions: 52,
  enrollmentStats: { approved: 45, pending: 3, rejected: 4 },
  recentActivity: [
    { student: 'SANTOS, MARIA CLARA R.', strand: 'STEM - Grade 12', subject: 'Pre-Calculus', date: 'Jul 12, 2026 2:30 PM', status: 'Pending' },
    { student: 'GARCIA, ANA LOUISE B.', strand: 'ABM - Grade 11', subject: 'Business Mathematics', date: 'Jul 11, 2026 10:15 AM', status: 'Approved' },
    { student: 'TORRES, MIGUEL ANGELO D.', strand: 'HUMSS - Grade 12', subject: 'Creative Writing', date: 'Jul 10, 2026 4:45 PM', status: 'Approved' },
    { student: 'FLORES, DIANA MAE S.', strand: 'GAS - Grade 11', subject: 'Earth Science', date: 'Jul 9, 2026 9:00 AM', status: 'Approved' },
    { student: 'RAMOS, PEDRO JOSE L.', strand: 'STEM - Grade 11', subject: 'General Chemistry 1', date: 'Jul 8, 2026 1:20 PM', status: 'Rejected' }
  ],
  strandDistribution: [
    { name: 'STEM', grade: 'Grade 11 & 12', subjects: 14 },
    { name: 'ABM', grade: 'Grade 11 & 12', subjects: 12 },
    { name: 'HUMSS', grade: 'Grade 11 & 12', subjects: 12 },
    { name: 'ICT', grade: 'Grade 11 & 12', subjects: 12 },
    { name: 'GAS', grade: 'Grade 11 & 12', subjects: 11 }
  ],
  pendingRequests: [
    { student: 'SANTOS, MARIA CLARA R.', id: '2026-00145-SHS-0', strand: 'STEM', grade: 'Grade 12' },
    { student: 'MENDOZA, ROSA ANGELICA T.', id: '2026-00189-SHS-0', strand: 'ABM', grade: 'Grade 11' },
    { student: 'BAUTISTA, CARLO MIGUEL F.', id: '2026-00201-SHS-0', strand: 'HUMSS', grade: 'Grade 12' }
  ]
};

const FACULTY_STRANDS = [
  { code: 'STEM', name: 'Science, Technology, Engineering & Mathematics', track: 'Academic', grade11: 62, grade12: 58, subjects: 14 },
  { code: 'ABM', name: 'Accountancy, Business & Management', track: 'Academic', grade11: 45, grade12: 40, subjects: 12 },
  { code: 'HUMSS', name: 'HUMMS - Humanities & Social Sciences', track: 'Academic', grade11: 38, grade12: 35, subjects: 12 },
  { code: 'ICT', name: 'Information and Communications Technology', track: 'TVL', grade11: 36, grade12: 34, subjects: 12 },
  { code: 'GAS', name: 'General Academic Strand', track: 'Academic', grade11: 30, grade12: 28, subjects: 11 }
];

const FACULTY_SUBJECTS = [
  { code: 'STEM-G12', name: 'Pre-Calculus', strand: 'STEM', grade: 'Grade 12', units: 4 },
  { code: 'STEM-01', name: 'General Chemistry 1', strand: 'STEM', grade: 'Grade 11', units: 4 },
  { code: 'ABM-01', name: 'Business Mathematics', strand: 'ABM', grade: 'Grade 11', units: 3 },
  { code: 'HUMSS-01', name: 'Creative Writing', strand: 'HUMSS', grade: 'Grade 12', units: 3 },
  { code: 'GAS-01', name: 'Earth Science', strand: 'GAS', grade: 'Grade 11', units: 3 },
  { code: 'CORE-01', name: 'Oral Communication', strand: 'All Strands', grade: 'Grade 11', units: 3 },
  { code: 'CORE-02', name: 'Reading and Writing', strand: 'All Strands', grade: 'Grade 11', units: 3 },
  { code: 'PE-04', name: 'Physical Education 4', strand: 'All Strands', grade: 'Grade 12', units: 2 }
];

const FACULTY_STUDENTS = [
  { id: '2026-00145-SHS-0', name: 'SANTOS, MARIA CLARA R.', strand: 'STEM', grade: 'Grade 12', section: 'STEM 12-A', status: 'Enrolled' },
  { id: '2026-00189-SHS-0', name: 'GARCIA, ANA LOUISE B.', strand: 'ABM', grade: 'Grade 11', section: 'ABM 11-B', status: 'Enrolled' },
  { id: '2026-00201-SHS-0', name: 'TORRES, MIGUEL ANGELO D.', strand: 'HUMSS', grade: 'Grade 12', section: 'HUMSS 12-A', status: 'Enrolled' },
  { id: '2026-00215-SHS-0', name: 'FLORES, DIANA MAE S.', strand: 'GAS', grade: 'Grade 11', section: 'GAS 11-A', status: 'Enrolled' },
  { id: '2026-00230-SHS-0', name: 'RAMOS, PEDRO JOSE L.', strand: 'STEM', grade: 'Grade 11', section: 'STEM 11-C', status: 'Pending' }
];

const ENROLLMENT_HISTORY = [
  { id: 'ENR-2026-0045', student: 'SANTOS, MARIA CLARA R.', strand: 'STEM', grade: 'Grade 12', semester: '1st Semester', date: 'Jul 12, 2026', status: 'Pending' },
  { id: 'ENR-2026-0044', student: 'GARCIA, ANA LOUISE B.', strand: 'ABM', grade: 'Grade 11', semester: '1st Semester', date: 'Jul 11, 2026', status: 'Approved' },
  { id: 'ENR-2026-0043', student: 'TORRES, MIGUEL ANGELO D.', strand: 'HUMSS', grade: 'Grade 12', semester: '1st Semester', date: 'Jul 10, 2026', status: 'Approved' },
  { id: 'ENR-2026-0042', student: 'FLORES, DIANA MAE S.', strand: 'GAS', grade: 'Grade 11', semester: '1st Semester', date: 'Jul 9, 2026', status: 'Approved' },
  { id: 'ENR-2026-0041', student: 'RAMOS, PEDRO JOSE L.', strand: 'STEM', grade: 'Grade 11', semester: '1st Semester', date: 'Jul 8, 2026', status: 'Rejected' },
  { id: 'ENR-2026-0040', student: 'MENDOZA, ROSA ANGELICA T.', strand: 'ABM', grade: 'Grade 11', semester: '1st Semester', date: 'Jul 7, 2026', status: 'Pending' }
];
