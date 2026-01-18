/**
 * Duration parser utility for converting human-readable duration strings to milliseconds.
 *
 * The dunning workflow uses duration strings like "1d", "3d", "7d" to specify retry
 * schedules. This utility parses these strings into milliseconds for use with
 * Workflow DevKit's sleep() function.
 */

/**
 * Time unit multipliers in milliseconds.
 */
const TIME_UNITS: Record<string, number> = {
  s: 1000, // seconds
  m: 60 * 1000, // minutes
  h: 60 * 60 * 1000, // hours
  d: 24 * 60 * 60 * 1000, // days
};

/**
 * Error thrown when a duration string cannot be parsed.
 */
export class DurationParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid duration "${input}": ${reason}`);
    this.name = 'DurationParseError';
  }
}

/**
 * Parses a human-readable duration string into milliseconds.
 *
 * Supported formats:
 * - "1s", "30s" - seconds
 * - "5m", "15m" - minutes
 * - "2h", "24h" - hours
 * - "1d", "7d" - days
 *
 * @param duration - Duration string (e.g., "1d", "3h", "30m", "10s")
 * @returns Duration in milliseconds
 * @throws {DurationParseError} If the duration string is invalid
 *
 * @example
 * parseDuration("1d")  // 86400000 (24 hours in ms)
 * parseDuration("2h")  // 7200000 (2 hours in ms)
 * parseDuration("30m") // 1800000 (30 minutes in ms)
 * parseDuration("10s") // 10000 (10 seconds in ms)
 */
export function parseDuration(duration: string): number {
  if (!duration || typeof duration !== 'string') {
    throw new DurationParseError(
      String(duration),
      'duration must be a non-empty string'
    );
  }

  const trimmed = duration.trim().toLowerCase();

  if (trimmed.length < 2) {
    throw new DurationParseError(
      duration,
      'duration must be at least 2 characters (e.g., "1d")'
    );
  }

  const unit = trimmed.slice(-1);
  const valueStr = trimmed.slice(0, -1);

  if (!TIME_UNITS[unit]) {
    throw new DurationParseError(
      duration,
      `unknown unit "${unit}". Supported units: s (seconds), m (minutes), h (hours), d (days)`
    );
  }

  const value = Number(valueStr);

  if (isNaN(value) || !Number.isFinite(value)) {
    throw new DurationParseError(
      duration,
      `"${valueStr}" is not a valid number`
    );
  }

  if (value <= 0) {
    throw new DurationParseError(duration, 'duration value must be positive');
  }

  if (!Number.isInteger(value)) {
    throw new DurationParseError(
      duration,
      'duration value must be a whole number'
    );
  }

  return value * TIME_UNITS[unit];
}

/**
 * Converts milliseconds to a human-readable duration string.
 * Uses the largest whole unit that fits.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 *
 * @example
 * formatDuration(86400000) // "1d"
 * formatDuration(7200000)  // "2h"
 * formatDuration(1800000)  // "30m"
 * formatDuration(10000)    // "10s"
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }

  // Try each unit from largest to smallest
  if (ms % TIME_UNITS.d === 0) {
    return `${ms / TIME_UNITS.d}d`;
  }
  if (ms % TIME_UNITS.h === 0) {
    return `${ms / TIME_UNITS.h}h`;
  }
  if (ms % TIME_UNITS.m === 0) {
    return `${ms / TIME_UNITS.m}m`;
  }
  return `${ms / TIME_UNITS.s}s`;
}
