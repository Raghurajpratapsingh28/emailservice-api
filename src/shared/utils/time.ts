/**
 * Parses a duration string (e.g. "15m", "30d", "3600s", "2h") into seconds.
 * Accepts plain integers as seconds.
 */
export function parseDurationToSeconds(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid duration: ${input}`);
    }
    return Math.floor(input);
  }

  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const match = /^(\d+)\s*(ms|s|m|h|d|w)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration string: ${input}`);
  }
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  switch (unit) {
    case 'ms':
      return Math.floor(value / 1000);
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    case 'w':
      return value * 60 * 60 * 24 * 7;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function epochSecondsToDate(epoch: number): Date {
  return new Date(epoch * 1000);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
