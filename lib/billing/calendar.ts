/** Test/reference projection of SQL policy, never an authorization source.
 * IANA zone conversion preserves wall time (including historical DST).
 */
function localParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (key: string) => Number(parts.find(p => p.type === key)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second"), ms: instant.getUTCMilliseconds() };
}
export function calendarMonthEnd(anchor: Date, offset: number): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isInteger(offset) || offset < 1) throw Error("invalid_calendar_input");
  const a = localParts(anchor);
  const targetMonth = new Date(Date.UTC(a.year, a.month - 1 + offset, 1));
  const year = targetMonth.getUTCFullYear(); const month = targetMonth.getUTCMonth();
  const day = Math.min(a.day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  const wall = Date.UTC(year, month, day, a.hour, a.minute, a.second, a.ms);
  let guess = wall;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(guess));
    const projected = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
    guess += wall - projected;
  }
  return new Date(guess);
}
export function projectCycle(observed: Date, previous?: { until: Date; anchor: Date; month: number }) {
  const continuous = previous && previous.until.getTime() >= observed.getTime();
  const anchor = continuous ? previous.anchor : observed;
  const month = continuous ? previous.month + 1 : 1;
  return { from: continuous ? previous.until : observed, until: calendarMonthEnd(anchor, month), anchor, month };
}
