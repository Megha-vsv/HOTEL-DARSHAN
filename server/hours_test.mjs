import { orderingStatus, ORDERING_HOURS, parseHHMM, istMinutesSinceMidnight } from './src/time.js';

console.log('=== Current IST time ===');
const now = istMinutesSinceMidnight();
console.log('minutes since midnight:', now, '=', `${Math.floor(now/60)}:${String(now%60).padStart(2,'0')}`);

console.log('\n=== orderingStatus() with defaults ===');
console.log(JSON.stringify(orderingStatus(), null, 2));

console.log('\n=== Boundary tests ===');
const cases = [
  { label: '10:29 (before open)', min: 10*60+29, open: 10*60+30, close: 22*60 },
  { label: '10:30 (exactly open)', min: 10*60+30, open: 10*60+30, close: 22*60 },
  { label: '12:00 (midday)', min: 12*60, open: 10*60+30, close: 22*60 },
  { label: '21:59 (before close)', min: 21*60+59, open: 10*60+30, close: 22*60 },
  { label: '22:00 (exactly close)', min: 22*60, open: 10*60+30, close: 22*60 },
  { label: '22:01 (after close)', min: 22*60+1, open: 10*60+30, close: 22*60 },
  { label: '23:00 (night)', min: 23*60, open: 10*60+30, close: 22*60 },
  { label: '02:00 (early morning)', min: 2*60, open: 10*60+30, close: 22*60 },
];
for (const c of cases) {
  const open = c.min >= c.open && c.min <= c.close;
  console.log(`${c.label.padEnd(28)} => ${open ? 'ALLOWED' : 'BLOCKED'}`);
}

console.log('\n=== parseHHMM tests ===');
for (const v of ['10:30', '22:00', '10:3', '9:00', '25:00', 'abc', '10:60', null, '']) {
  console.log(`parseHHMM('${v}') => ${parseHHMM(v)}`);
}