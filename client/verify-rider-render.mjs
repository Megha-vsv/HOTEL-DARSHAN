// Driver for verify-rider-render.jsx.
//
// The render test contains JSX, so node cannot run it directly. This boots Vite
// in middleware mode and loads the test through Vite's own transform - the same
// one the browser uses - then runs it and reports.
//
//   node verify-rider-render.mjs
//
// It sits beside the test rather than in a temp folder because it imports vite,
// react and react-dom from this package's node_modules.
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const vite = await createServer({
  root: process.cwd(),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom'
});

try {
  const mod = await vite.ssrLoadModule('/verify-rider-render.jsx');
  const { pass, fail, failures } = await mod.default({
    load: (p) => vite.ssrLoadModule(`/src/${p}`),
    React,
    renderToString
  });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('render suite crashed:', err);
  process.exit(1);
} finally {
  await vite.close();
}
