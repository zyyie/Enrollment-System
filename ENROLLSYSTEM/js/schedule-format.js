/**
 * Readable schedule labels for enrollment dropdowns and summaries.
 */
const ScheduleFormat = (() => {
  function expandDayCode(code) {
    const parts = [];
    let i = 0;
    const text = String(code || '');
    while (i < text.length) {
      if (text.slice(i, i + 2) === 'Th') {
        parts.push('Thu');
        i += 2;
      } else if (text.slice(i, i + 2) === 'Sa') {
        parts.push('Sat');
        i += 2;
      } else if (text[i] === 'M') {
        parts.push('Mon');
        i += 1;
      } else if (text[i] === 'T') {
        parts.push('Tue');
        i += 1;
      } else if (text[i] === 'W') {
        parts.push('Wed');
        i += 1;
      } else if (text[i] === 'F') {
        parts.push('Fri');
        i += 1;
      } else {
        i += 1;
      }
    }
    if (!parts.length) return code || 'TBA';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} & ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
  }

  function formatReadableTime(value) {
    let text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/(\d)(am|pm)\b/gi, '$1 $2');
    text = text.replace(/\bam\b/gi, 'AM').replace(/\bpm\b/gi, 'PM');
    text = text.replace(/(\d)(AM|PM)\b/g, '$1 $2');
    return text.replace(/\s+/g, ' ').trim();
  }

  function formatTimeRange(range) {
    const text = String(range || '').trim();
    const dash = text.indexOf('-');
    if (dash === -1) return formatReadableTime(text);
    const start = text.slice(0, dash).trim();
    const end = text.slice(dash + 1).trim();
    return `${formatReadableTime(start)} – ${formatReadableTime(end)}`;
  }

  function parseDayTime(dayTime) {
    const text = String(dayTime || '').trim();
    if (!text) return { days: 'TBA', time: '' };
    const match = text.match(/^(\S+)\s+(.+)$/);
    if (!match) return { days: text, time: '' };
    return {
      days: expandDayCode(match[1]),
      time: formatTimeRange(match[2]),
    };
  }

  function countMeetingDays(dayCode) {
    const parts = [];
    let i = 0;
    const text = String(dayCode || '');
    while (i < text.length) {
      if (text.slice(i, i + 2) === 'Th') {
        parts.push('Thu');
        i += 2;
      } else if (text.slice(i, i + 2) === 'Sa') {
        parts.push('Sat');
        i += 2;
      } else if (text[i] === 'M') {
        parts.push('Mon');
        i += 1;
      } else if (text[i] === 'T') {
        parts.push('Tue');
        i += 1;
      } else if (text[i] === 'W') {
        parts.push('Wed');
        i += 1;
      } else if (text[i] === 'F') {
        parts.push('Fri');
        i += 1;
      } else {
        i += 1;
      }
    }
    return Math.max(parts.length, 1);
  }

  function parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = (match[3] || '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  function sessionHoursFromRange(range) {
    const text = String(range || '').trim();
    const dash = text.indexOf('-');
    if (dash === -1) return null;
    const start = parseTimeToMinutes(text.slice(0, dash));
    const end = parseTimeToMinutes(text.slice(dash + 1));
    if (start == null || end == null || end <= start) return null;
    return (end - start) / 60;
  }

  function contactUnitsFromSchedule(schedule) {
    if (!schedule) return null;
    const dayTime = schedule.dayTime || schedule.schedule_label || schedule.scheduleLabel || '';
    const text = String(dayTime || '').trim();
    const match = text.match(/^(\S+)\s+(.+)$/);
    if (!match) return null;
    const hoursPerSession = sessionHoursFromRange(match[2]);
    if (hoursPerSession == null) return null;
    const weeklyHours = hoursPerSession * countMeetingDays(match[1]);
    if (Number.isInteger(weeklyHours)) return weeklyHours;
    return Math.round(weeklyHours * 10) / 10;
  }

  function isScheduleFull(schedule) {
    if (!schedule) return true;
    if (schedule.sectionFull === true) return true;
    const slots = Number(schedule.slots);
    return Number.isFinite(slots) && slots <= 0;
  }

  function formatDropdownOption(schedule) {
    if (!schedule) return 'Select schedule...';

    const section = String(schedule.section || schedule.sectionName || 'Section').trim();
    const dayTimeRaw = schedule.dayTime || schedule.schedule_label || schedule.scheduleLabel || '';
    const { days, time } = parseDayTime(dayTimeRaw);
    const slots = schedule.slots != null && schedule.slots !== '' ? Number(schedule.slots) : null;
    const full = isScheduleFull(schedule);

    const parts = [section];
    if (days && days !== 'TBA') parts.push(days);
    if (time) parts.push(time);

    let label = parts.join(' · ');
    if (full) {
      label += ' — FULL';
    } else if (Number.isFinite(slots)) {
      label += ` (${slots} slot${slots === 1 ? '' : 's'})`;
    }
    return label;
  }

  return {
    expandDayCode,
    formatReadableTime,
    formatTimeRange,
    parseDayTime,
    countMeetingDays,
    contactUnitsFromSchedule,
    isScheduleFull,
    formatDropdownOption,
  };
})();
