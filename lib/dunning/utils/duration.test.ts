import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  formatDuration,
  DurationParseError,
} from './duration';

describe('duration.ts', () => {
  describe('parseDuration', () => {
    describe('seconds (s)', () => {
      it('parses "1s" to 1000ms', () => {
        expect(parseDuration('1s')).toBe(1000);
      });

      it('parses "30s" to 30000ms', () => {
        expect(parseDuration('30s')).toBe(30000);
      });

      it('parses "60s" to 60000ms', () => {
        expect(parseDuration('60s')).toBe(60000);
      });
    });

    describe('minutes (m)', () => {
      it('parses "1m" to 60000ms', () => {
        expect(parseDuration('1m')).toBe(60000);
      });

      it('parses "5m" to 300000ms', () => {
        expect(parseDuration('5m')).toBe(300000);
      });

      it('parses "30m" to 1800000ms', () => {
        expect(parseDuration('30m')).toBe(1800000);
      });
    });

    describe('hours (h)', () => {
      it('parses "1h" to 3600000ms', () => {
        expect(parseDuration('1h')).toBe(3600000);
      });

      it('parses "2h" to 7200000ms', () => {
        expect(parseDuration('2h')).toBe(7200000);
      });

      it('parses "24h" to 86400000ms (same as 1d)', () => {
        expect(parseDuration('24h')).toBe(86400000);
      });
    });

    describe('days (d)', () => {
      it('parses "1d" to 86400000ms', () => {
        expect(parseDuration('1d')).toBe(86400000);
      });

      it('parses "3d" to 259200000ms', () => {
        expect(parseDuration('3d')).toBe(259200000);
      });

      it('parses "7d" to 604800000ms', () => {
        expect(parseDuration('7d')).toBe(604800000);
      });
    });

    describe('case insensitivity', () => {
      it('parses uppercase "1D" correctly', () => {
        expect(parseDuration('1D')).toBe(86400000);
      });

      it('parses "1H" correctly', () => {
        expect(parseDuration('1H')).toBe(3600000);
      });

      it('parses "1M" correctly', () => {
        expect(parseDuration('1M')).toBe(60000);
      });

      it('parses "1S" correctly', () => {
        expect(parseDuration('1S')).toBe(1000);
      });
    });

    describe('whitespace handling', () => {
      it('trims leading whitespace', () => {
        expect(parseDuration('  1d')).toBe(86400000);
      });

      it('trims trailing whitespace', () => {
        expect(parseDuration('1d  ')).toBe(86400000);
      });

      it('trims both leading and trailing whitespace', () => {
        expect(parseDuration('  1d  ')).toBe(86400000);
      });
    });

    describe('error handling', () => {
      it('throws DurationParseError for empty string', () => {
        expect(() => parseDuration('')).toThrow(DurationParseError);
        expect(() => parseDuration('')).toThrow('non-empty string');
      });

      it('throws DurationParseError for single character', () => {
        expect(() => parseDuration('d')).toThrow(DurationParseError);
        expect(() => parseDuration('d')).toThrow('at least 2 characters');
      });

      it('throws DurationParseError for unknown unit', () => {
        expect(() => parseDuration('1w')).toThrow(DurationParseError);
        expect(() => parseDuration('1w')).toThrow('unknown unit "w"');
      });

      it('throws DurationParseError for invalid number', () => {
        expect(() => parseDuration('abcd')).toThrow(DurationParseError);
        expect(() => parseDuration('abcd')).toThrow('not a valid number');
      });

      it('throws DurationParseError for zero value', () => {
        expect(() => parseDuration('0d')).toThrow(DurationParseError);
        expect(() => parseDuration('0d')).toThrow('must be positive');
      });

      it('throws DurationParseError for negative value', () => {
        expect(() => parseDuration('-1d')).toThrow(DurationParseError);
        expect(() => parseDuration('-1d')).toThrow('must be positive');
      });

      it('throws DurationParseError for decimal value', () => {
        expect(() => parseDuration('1.5d')).toThrow(DurationParseError);
        expect(() => parseDuration('1.5d')).toThrow('whole number');
      });

      it('throws DurationParseError for null input', () => {
        expect(() => parseDuration(null as unknown as string)).toThrow(
          DurationParseError
        );
      });

      it('throws DurationParseError for undefined input', () => {
        expect(() => parseDuration(undefined as unknown as string)).toThrow(
          DurationParseError
        );
      });
    });

    describe('default retry schedule parsing', () => {
      it('parses DEFAULT_RETRY_SCHEDULE values correctly', () => {
        // The default schedule is ["1d", "3d", "7d"]
        expect(parseDuration('1d')).toBe(86400000);
        expect(parseDuration('3d')).toBe(259200000);
        expect(parseDuration('7d')).toBe(604800000);
      });
    });
  });

  describe('formatDuration', () => {
    describe('formatting to days', () => {
      it('formats 86400000ms to "1d"', () => {
        expect(formatDuration(86400000)).toBe('1d');
      });

      it('formats 259200000ms to "3d"', () => {
        expect(formatDuration(259200000)).toBe('3d');
      });

      it('formats 604800000ms to "7d"', () => {
        expect(formatDuration(604800000)).toBe('7d');
      });
    });

    describe('formatting to hours', () => {
      it('formats 3600000ms to "1h"', () => {
        expect(formatDuration(3600000)).toBe('1h');
      });

      it('formats 7200000ms to "2h"', () => {
        expect(formatDuration(7200000)).toBe('2h');
      });
    });

    describe('formatting to minutes', () => {
      it('formats 60000ms to "1m"', () => {
        expect(formatDuration(60000)).toBe('1m');
      });

      it('formats 1800000ms to "30m"', () => {
        expect(formatDuration(1800000)).toBe('30m');
      });
    });

    describe('formatting to seconds', () => {
      it('formats 1000ms to "1s"', () => {
        expect(formatDuration(1000)).toBe('1s');
      });

      it('formats 30000ms to "30s"', () => {
        expect(formatDuration(30000)).toBe('30s');
      });
    });

    describe('edge cases', () => {
      it('formats 0 to "0s"', () => {
        expect(formatDuration(0)).toBe('0s');
      });

      it('formats negative values to "0s"', () => {
        expect(formatDuration(-1000)).toBe('0s');
      });

      it('prefers larger units when value is evenly divisible', () => {
        // 86400000 is both 1d and 24h, should prefer days
        expect(formatDuration(86400000)).toBe('1d');
        // 3600000 is both 1h and 60m, should prefer hours
        expect(formatDuration(3600000)).toBe('1h');
      });
    });

    describe('roundtrip', () => {
      it('parseDuration and formatDuration are inverse operations for clean values', () => {
        const durations = ['1s', '30s', '1m', '5m', '1h', '24h', '1d', '7d'];
        for (const d of durations) {
          const ms = parseDuration(d);
          const formatted = formatDuration(ms);
          // May not be exactly the same (24h becomes 1d) but should parse to same ms
          expect(parseDuration(formatted)).toBe(ms);
        }
      });
    });
  });
});
