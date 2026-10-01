import express from 'express';
import { db } from '../db.js';
import { emitOrderCreated, emitOrderStatusUpdated } from '../socket.js';
import { orderingStatus, ORDERING_HOURS } from '../time.js';

const router = express.Router();

function paytmConfig() {
  const env = (process.env.PAYTM_ENV || 'staging').toLowerCase();
  const production = env === 'production';
  // Paytm's documented hosts: staging is securestage.paytmpayments.com and
  // production is secure.paytmpayments.com. The legacy securegw*.paytm.in names
  // are not what the JS Checkout docs list, and a MID provisioned on the new
  // host gets resultCode 239/501 "System Error" when called against the old one.
  const host = production ? 'https://secure.paytmpayments.com' : 'https://securestage.paytmpayments.com';
  return {
    mid: process.env.PAYTM_MID || '',
    key: process.env.PAYTM_MERCHANT_KEY || '',
    website: process.env.PAYTM_WEBSITE || (production ? 'DEFAULT' : 'WEBSTAGING'),
    host,
    // The CheckoutJS script the browser must load. It lives under the same
    // Paytm environment as the API host above, and is not the same string: the
    // merchantpgpui path is only valid on the host that matches PAYTM_ENV. Hard
    // coding the production host here is what made a staging MID load a script
    // that never published a CheckoutJS object for it.
    checkoutHost: production ? 'https://secure.paytmpayments.com' : 'https://securestage.paytmpayments.com',
    callbackUrl: process.env.PAYTM_CALLBACK_URL || ''
  };
}

async function checksum() {
  try {
    // paytmchecksum is a CommonJS module that does `module.exports = PaytmChecksum`,
    // so the dynamic import hands back a module namespace with the class on
    // `.default`. Reading it that way - rather than treating the namespace as
    // the class - is what makes `generateSignature` resolve. The fallback covers
    // a future ESM build that exports the named functions directly.
    const mod = await import('paytmchecksum');
    return mod.default || mod;
  } catch {
    throw new Error('Paytm checksum package is missing. Run npm install in the server folder.');
  }
}

function requirePaytmConfig() {
  const c = paytmConfig();
  if (!c.mid || !c.key) throw new Error('Hotel Darshan Paytm API keys are not configured yet. Add PAYTM_MID and PAYTM_MERCHANT_KEY to the server environment.');
  return c;
}

function parseOrder(order) {
  order.items = JSON.parse(order.items_json || '[]');
  order.address = JSON.parse(order.address_json || '{}');
  return order;
}

function markPaid(order, transactionId, method = 'Paytm') {
  if (order.payment_status === 'paid') return parseOrder(order);
  const autoConfirm = db.prepare("SELECT value FROM settings WHERE key = 'auto_confirm_orders'").get();
  const status = autoConfirm?.value === 'true' ? 'ORDER_CONFIRMED' : 'ORDER_PLACED';
  db.prepare(`UPDATE orders SET payment_status='paid', razorpay_payment_id=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(transactionId, status, order.id);
  const updated = parseOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
  emitOrderStatusUpdated(updated); emitOrderCreated(updated);
  return updated;
}

router.post('/paytm/create', async (req, res) => {
  try {
    const config = requirePaytmConfig();
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.body.order_id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.payment_status === 'paid') return res.status(400).json({ success: false, error: 'Order is already paid' });

    // Re-check ordering hours here as well. The order-create route enforces
    // this, but the payment session is created separately and a customer could
    // reach it with a pre-existing draft; never start a Paytm checkout outside
    // trading hours.
    const _paytmSettings = db.prepare('SELECT key, value FROM settings').all();
    const _paytmSettingsMap = {};
    _paytmSettings.forEach(r => { _paytmSettingsMap[r.key] = r.value; });
    const _paytmHours = orderingStatus(_paytmSettingsMap.opening_time, _paytmSettingsMap.closing_time);
    if (!_paytmHours.open) {
      return res.status(403).json({
        success: false,
        error: 'Ordering is currently closed',
        orderingHours: { opening: _paytmHours.opening, closing: _paytmHours.closing, timezone: ORDERING_HOURS.TIMEZONE }
      });
    }

    const PaytmChecksum = await checksum();
    const orderId = order.order_number;
    const callbackUrl = config.callbackUrl || `${process.env.PUBLIC_BASE_URL || ''}/api/payment/paytm/callback`;
    if (!callbackUrl.startsWith('https://') && !callbackUrl.startsWith('http://')) {
      throw new Error('PAYTM_CALLBACK_URL or PUBLIC_BASE_URL must be configured with a public HTTPS URL before Paytm checkout is enabled.');
    }

    const body = {
      requestType: 'Payment',
      mid: config.mid,
      websiteName: config.website,
      orderId,
      callbackUrl,
      txnAmount: { value: Number(order.grand_total).toFixed(2), currency: 'INR' },
      userInfo: { custId: `HDUSER${order.user_id || order.id}` }
    };
    const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), config.key);
    const endpoint = `${config.host}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(config.mid)}&orderId=${encodeURIComponent(orderId)}`;
    const midMasked = config.mid.length > 4 ? `${config.mid.slice(0, 2)}...${config.mid.slice(-2)}` : '***';
    const cbUrl = new URL(callbackUrl);
    console.log('[paytm-diag] env=' + (process.env.PAYTM_ENV || 'staging') +
      ' endpoint=' + endpoint +
      ' midMasked=' + midMasked +
      ' websiteName=' + config.website +
      ' orderId=' + orderId +
      ' amount=' + body.txnAmount.value + ' ' + body.txnAmount.currency +
      ' callbackHost=' + cbUrl.hostname + ' callbackPath=' + cbUrl.pathname +
      ' bodyMidMatchesQueryMid=' + (config.mid === config.mid) +
      ' bodyOrderIdMatchesQueryOrderId=' + (orderId === orderId));
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, head: { signature } })
    });
    const rawText = await response.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    const ri = data?.body?.resultInfo;
    const redacted = JSON.stringify({
      httpStatus: response.status,
      resultStatus: ri?.resultStatus,
      resultCode: ri?.resultCode,
      resultMsg: ri?.resultMsg,
      txnToken: data?.body?.txnToken ? '[redacted]' : undefined,
      orderId: data?.body?.orderId,
      amount: data?.body?.txnAmount,
      fullBody: rawText.slice(0, 600)
    });
    console.log('[paytm-diag] response=' + redacted);
    if (!response.ok || ri?.resultStatus !== 'S') throw new Error(ri?.resultMsg || 'Paytm could not initialize the transaction.');

    db.prepare('UPDATE orders SET razorpay_order_id=? WHERE id=?').run(orderId, order.id);
    // checkoutHost is returned so the browser loads the CheckoutJS script from the
    // same Paytm environment this transaction was created against. The merchant
    // key is deliberately omitted - it signs requests server-side and never
    // leaves this process.
    return res.json({ success: true, mid: config.mid, orderId, txnToken: data.body.txnToken, amount: Number(order.grand_total).toFixed(2), checkoutHost: config.checkoutHost });
  } catch (e) {
    console.error('PAYTM CREATE ERROR:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

async function fetchPaytmStatus(order) {
  const config = requirePaytmConfig();
  const PaytmChecksum = await checksum();
  const body = { requestType: 'Payment', mid: config.mid, orderId: order.order_number };
  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), config.key);
  const response = await fetch(`${config.host}/merchant-status/api/v1/getPaymentStatus?mid=${encodeURIComponent(config.mid)}&orderId=${encodeURIComponent(order.order_number)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, head: { signature } })
  });
  const data = await response.json();
  return data?.body || {};
}

router.post('/paytm/status', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.body.order_id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const body = await fetchPaytmStatus(order);
    const status = body?.resultInfo?.resultStatus;
    const amount = Number(body?.txnAmount || 0);
    if (status !== 'TXN_SUCCESS') return res.status(400).json({ success: false, error: body?.resultInfo?.resultMsg || `Payment status: ${status || 'UNKNOWN'}` });
    if (amount && amount.toFixed(2) !== Number(order.grand_total).toFixed(2)) return res.status(400).json({ success: false, error: 'Payment amount mismatch. Order was not confirmed.' });
    const updated = markPaid(order, body.txnId || body.txnID || body.bankTxnId || `PAYTM-${order.order_number}`);
    return res.json({ success: true, message: 'Paytm payment verified successfully. Order confirmed!', order: updated });
  } catch (e) {
    console.error('PAYTM STATUS ERROR:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/paytm/callback', async (req, res) => {
  try {
    const orderNumber = req.body?.ORDERID;
    const order = orderNumber ? db.prepare('SELECT * FROM orders WHERE order_number=?').get(orderNumber) : null;
    if (order) {
      const body = await fetchPaytmStatus(order);
      if (body?.resultInfo?.resultStatus === 'TXN_SUCCESS' && Number(body?.txnAmount || 0).toFixed(2) === Number(order.grand_total).toFixed(2)) {
        markPaid(order, body.txnId || body.txnID || `PAYTM-${order.order_number}`);
      }
    }
    res.status(200).send('Payment response received. You can return to Hotel Darshan.');
  } catch (e) {
    console.error('PAYTM CALLBACK ERROR:', e);
    res.status(200).send('Payment response received.');
  }
});

// Backward-compatible endpoint names; Razorpay is intentionally no longer used.
router.post('/create-order', (req, res) => res.status(410).json({ error: 'Razorpay has been removed. Use /api/payment/paytm/create.' }));
router.post('/create-razorpay-order', (req, res) => res.status(410).json({ error: 'Razorpay has been removed. Use /api/payment/paytm/create.' }));
router.post('/verify', (req, res) => res.status(410).json({ success: false, error: 'Razorpay verification has been removed. Paytm verifies payments server-side.' }));

export default router;
