import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('C:\\Users\\Vasava Megha\\OneDrive\\Desktop\\Zip\\Hotel-Darshan-AccountSettings-Modified\\Food DeliveryApp\\server\\.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('='))
);

const mid = env.PAYTM_MID.trim();
const host = 'https://securestage.paytmpayments.com';

const mids = [mid, 'INTEGR7769XXXXXX9383', 'wSOJpR60406085524261'];
for (const m of mids) {
  try {
    const r = await fetch(`${host}/merchantpgpui/checkoutjs/merchants/${m}.js`, { method: 'HEAD' });
    console.log(`CheckoutJS [${m}]: ${r.status} ${r.headers.get('content-type')}`);
  } catch (e) { console.log(`CheckoutJS [${m}]: ERROR ${e.message}`); }
}