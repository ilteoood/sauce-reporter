import { endOfDay, endOfMonth, isValid, parseISO, startOfDay, startOfMonth, subMonths } from 'date-fns';

export interface DateRange {
  from: Date;
  to: Date;
}

export function previousMonthRange(now: Date): DateRange {
  const from = startOfMonth(subMonths(now, 1));
  const to = endOfDay(endOfMonth(subMonths(now, 1)));
  return { from, to };
}

export function resolveDateRange(fromInput: string, toInput: string, now: Date = new Date()): DateRange {
  if (fromInput && toInput) {
    const from = parseIsoDate(fromInput);
    const to = parseIsoDate(toInput);
    if (!from || !to) {
      throw new Error(`Invalid date inputs: from=${fromInput}, to=${toInput}`);
    }
    if (to.getTime() < from.getTime()) {
      throw new Error(`'to' must be on or after 'from'`);
    }
    return { from: startOfDay(from), to: endOfDay(to) };
  }
  return previousMonthRange(now);
}

function parseIsoDate(value: string): Date | null {
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}