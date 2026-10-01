// Generates client/src/data/deliveryPricing.js from server/src/deliveryPricing.js
// so the two can never drift. The only transformation is the export/import
// boilerplate: same functions, same defaults, same behaviour.
import fs from 'fs';
import path from 'path';

const serverFile = path.join('src', 'deliveryPricing.js');
const clientFile = path.join('..', 'client', 'src', 'data', 'deliveryPricing.js');

let source = fs.readFileSync(serverFile, 'utf8');

if (!/export function distanceKmBetween/.test(source)) {
  throw new Error('server deliveryPricing.js does not look like the expected module - refusing to generate.');
}

const banner = `// AUTO-GENERATED from server/src/deliveryPricing.js - do not edit by hand.
// Run: node scripts/generate-delivery-pricing.mjs (from the server folder)
//
// The client copy exists so the cart, checkout and order summary can show the
// exact distance and fee the server will charge. The server module remains the
// authority; these two are byte-identical apart from this header, and
// server/_tmp_delivery.test.mjs asserts they agree.

`;

const output = banner + source
  .replace(/export const /g, 'export const ')
  .replace(/^import .*$/gm, '');

fs.writeFileSync(clientFile, output, 'utf8');
console.log('wrote ' + clientFile + ' (' + output.length + ' bytes)');
