import { isValid, parseISO, startOfDay, startOfMonth, subMonths } from 'date-fns';

export interface DateRange {
  from: Date;
  to: Date;
}

export function previousMonthRange(now: Date): DateRange {
  const from = startOfMonth(subMonths(now, 1));
  const to = startOfMonth(now);
  return { from, to };
}

export function resolveDateRange(fromInput: string, toInput: string, now: Date = new Date()): DateRange {
  if (fromInput && toInput) {
    const from = parseIsoDate(fromInput);
    const to = parseIsoDate(toInput);
    if (!from || !to) {
      throw new Error(`Invalid date inputs: from=${fromInput}, to=${toInput}`);
    }
    if (to.getTime() <= from.getTime()) {
      throw new Error(`'to' must be after 'from'`);
    }
    return { from: startOfDay(from), to: startOfDay(to) };
  }
  return previousMonthRange(now);
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}