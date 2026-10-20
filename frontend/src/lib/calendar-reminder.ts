export type LocalTimeResult =
  | { ok: true; date: Date }
  | { ok: false; reason: "invalid" | "nonexistent" | "ambiguous" | "past" };

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function parseLocalDateTime(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  };
  const roundTrip = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  if (
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    return null;
  }
  return parts;
}

function zonedParts(date: Date, timeZone: string): LocalParts | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return {
      year: value.year,
      month: value.month,
      day: value.day,
      hour: value.hour,
      minute: value.minute,
    };
  } catch {
    return null;
  }
}

function sameParts(a: LocalParts, b: LocalParts) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/** Convert an explicit wall-clock time to one unique instant in an IANA time zone. */
export function localDateTimeToUtc(
  value: string,
  timeZone: string,
  now = new Date(),
): LocalTimeResult {
  const parts = parseLocalDateTime(value);
  if (!parts) return { ok: false, reason: "invalid" };
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set<number>();

  // Sample both sides of nearby offset transitions, then verify exact candidates.
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 3) {
    const sample = new Date(naiveUtc + deltaHours * 60 * 60 * 1000);
    const local = zonedParts(sample, timeZone);
    if (!local) return { ok: false, reason: "invalid" };
    offsets.add(
      Math.round(
        (Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) -
          sample.getTime()) /
          60_000,
      ),
    );
  }

  const candidates = [...offsets]
    .map((offset) => new Date(naiveUtc - offset * 60_000))
    .filter((candidate) => {
      const local = zonedParts(candidate, timeZone);
      return local !== null && sameParts(local, parts);
    });
  if (candidates.length === 0) return { ok: false, reason: "nonexistent" };
  if (candidates.length > 1) return { ok: false, reason: "ambiguous" };
  if (candidates[0]!.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  return { ok: true, date: candidates[0]! };
}

export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const segments: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      segments.push(current);
      current = ` ${character}`;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  segments.push(current);
  return segments.join("\r\n");
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createCalendarReminder(
  start: Date,
  durationMinutes: 15 | 30 | 45 | 60,
  setupUrl: string,
  uid = `${globalThis.crypto.randomUUID()}@interview-mirror`,
  now = new Date(),
): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Interview Mirror//Practice Reminder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeCalendarText("Interview practice reminder")}`,
    `DESCRIPTION:${escapeCalendarText("Time set aside for interview practice.")}`,
    `URL:${setupUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function defaultLocalDateTime(now = new Date()): string {
  const date = new Date(now.getTime() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function setupReminderUrl(
  origin: string,
  fields: { role: string; interviewType: string; level: string; language: string },
): string {
  const url = new URL("/setup", origin);
  url.searchParams.set("role", fields.role);
  url.searchParams.set("interviewType", fields.interviewType);
  url.searchParams.set("level", fields.level);
  url.searchParams.set("language", fields.language);
  return url.toString();
}

export function downloadCalendarReminder(content: string, date: Date): boolean {
  let href: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    href = URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = href;
    link.download = `interview-practice-${date.toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    return true;
  } catch {
    link?.remove();
    if (href) URL.revokeObjectURL(href);
    return false;
  }
}
