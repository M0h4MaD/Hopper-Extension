// Run from the repo root: node tests/time-utils.test.mjs
import assert from 'node:assert/strict';
import { untilFromIn, untilFromClock, durationParts, localDateTimeMin } from '../time-utils.js';

const now = new Date(2026, 9, 6, 10, 0, 0).getTime();   // 6 Oct 2026, 10:00 local time

// "In 2 hours 30 minutes"
assert.equal(untilFromIn(2, 30, now), now + 150 * 60000);
assert.equal(untilFromIn(0, 45, now), now + 45 * 60000);
assert.equal(untilFromIn(1, 0, now), now + 60 * 60000);
assert.equal(untilFromIn(0, 0, now), null);
assert.equal(untilFromIn(NaN, NaN, now), null);
assert.equal(untilFromIn(-3, 0, now), null);
assert.equal(untilFromIn(1.9, 0.9, now), now + 60 * 60000);           // fractions are truncated
console.log('ok - hours + minutes entry');

// "At 18:30" = next time the clock shows that
const at = (s) => new Date(untilFromClock(s, now));
assert.deepEqual([at('18:30').getDate(), at('18:30').getHours(), at('18:30').getMinutes()], [6, 18, 30]);       // later today
assert.deepEqual([at('09:15').getDate(), at('09:15').getHours(), at('09:15').getMinutes()], [7, 9, 15]);         // already passed -> tomorrow
assert.equal(at('10:00').getDate(), 7);                                                                         // "now" -> tomorrow
assert.equal(untilFromClock('25:00', now), null);
assert.equal(untilFromClock('12:61', now), null);
assert.equal(untilFromClock('', now), null);
assert.equal(untilFromClock('abc', now), null);
console.log('ok - time-of-day alarm picks the next occurrence');

// duration formatting parts
assert.deepEqual(durationParts(150 * 60000), { days: 0, hours: 2, minutes: 30 });
assert.deepEqual(durationParts(26 * 3600000), { days: 1, hours: 2, minutes: 0 });
assert.deepEqual(durationParts(10 * 1000), { days: 0, hours: 0, minutes: 1 });
assert.match(localDateTimeMin(now), /^2026-10-06T\d\d:\d\d$/);
console.log('ok - duration parts and datetime-local minimum');
