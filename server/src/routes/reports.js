import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { authMiddleware, requireRole } from '../auth.js';
import { db, dbPath } from '../db.js';

const router = express.Router();
router.use(authMiddleware, requireRole(['admin']));

function dateFilter(period) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  let start = null;
  if (period === '7d') start = new Date(istNow.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === '30d') start = new Date(istNow.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === '12m') start = new Date(istNow.getTime() - 365 * 24 * 60 * 60 * 1000);
  return start ? start.toISOString().slice(0, 19).replace('T', ' ') : null;
}

router.get('/download', async (req, res) => {
  try {
    const period = req.query.period || 'all';
    const type = req.query.type || 'all';
    const format = req.query.format || 'csv';
    const start = dateFilter(period);
    const where = start ? `WHERE created_at >= ?` : '';
    const params = start ? [start] : [];

    const orders = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC`).all(...params);
    const reviews = db.prepare(`SELECT r.*, o.order_number, o.items_json FROM reviews r LEFT JOIN orders o ON r.order_id=o.id ${start ? 'WHERE r.created_at >= ?' : ''} ORDER BY r.id DESC`).all(...params);
    const users = db.prepare(`SELECT * FROM users WHERE role='customer' ${start ? 'AND created_at >= ?' : ''}`).all(...params);

    console.log('[reports] db=%s period=%s type=%s format=%s orders=%d reviews=%d customers=%d', dbPath, period, type, format, orders.length, reviews.length, users.length);

    if (!orders.length && !reviews.length && !users.length) {
      return res.status(404).json({ error: 'No records found for the selected period' });
    }

    const paidOrders = orders.filter(o => o.payment_status === 'paid');
    const revenueTotal = paidOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);

    res.setHeader('Content-Disposition', `attachment; filename="hotel-darshan-report.${format === 'excel' ? 'xlsx' : format === 'pdf' ? 'pdf' : format === 'zip' ? 'zip' : 'csv'}"`);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      let lines = [];
      if (type === 'orders' || type === 'all') {
        lines.push('Order ID,Date,Customer,Phone,Items,Item Total,Delivery Fee,Tax,Discount,Grand Total,Payment Method,Payment Status,Status,Type');
        for (const o of orders) lines.push([o.order_number, o.created_at, o.customer_name, o.customer_phone, (JSON.parse(o.items_json||'[]').map(i=>i.name_en||i.id).join('; ')), o.item_total, o.delivery_fee, o.tax_amount, o.discount_amount, o.grand_total, o.payment_method, o.payment_status, o.status, o.order_type].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
      }
      if (type === 'customers' || type === 'all') {
        lines.push('');
        lines.push('Customer,Phone,Total Orders,Total Spending,Last Order');
        for (const u of users) {
          const uOrders = orders.filter(o => o.user_id === u.id || o.customer_phone === u.phone);
          const spent = uOrders.filter(o=>o.payment_status==='paid').reduce((s,o)=>s+Number(o.grand_total||0),0);
          const last = uOrders.length ? uOrders[0].created_at : '';
          lines.push([u.name, u.phone, uOrders.length, spent, last].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
        }
      }
      if (type === 'reviews' || type === 'all') {
        lines.push('');
        lines.push('Customer,Order,Rating,Comment,Date');
        for (const r of reviews) lines.push([r.customer_name, r.order_number, r.rating, r.comment, r.created_at].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
      }
      if (type === 'revenue' || type === 'all') {
        lines.push('');
        lines.push('Metric,Value');
        lines.push(`"Total Collected Revenue","${revenueTotal}"`);
        lines.push(`"Successful Orders","${paidOrders.length}"`);
      }
      res.send(lines.join('\n'));
      return;
    }

    if (format === 'excel') {
      const wb = new ExcelJS.Workbook();
      if (type === 'orders' || type === 'all') {
        const ws = wb.addWorksheet('Orders');
        ws.columns = [{header:'Order ID',key:'order_number'},{header:'Date',key:'created_at'},{header:'Customer',key:'customer_name'},{header:'Phone',key:'customer_phone'},{header:'Items',key:'items'},{header:'Item Total',key:'item_total'},{header:'Delivery Fee',key:'delivery_fee'},{header:'Tax',key:'tax_amount'},{header:'Discount',key:'discount_amount'},{header:'Grand Total',key:'grand_total'},{header:'Payment Method',key:'payment_method'},{header:'Payment Status',key:'payment_status'},{header:'Status',key:'status'},{header:'Type',key:'order_type'}];
        for (const o of orders) ws.addRow({...o, items: JSON.parse(o.items_json||'[]').map(i=>i.name_en||i.id).join(', ')});
      }
      if (type === 'customers' || type === 'all') {
        const ws = wb.addWorksheet('Customers');
        ws.columns = [{header:'Customer',key:'name'},{header:'Phone',key:'phone'},{header:'Total Orders',key:'orders'},{header:'Total Spending',key:'spent'},{header:'Last Order',key:'last'}];
        for (const u of users) {
          const uOrders = orders.filter(o => o.user_id === u.id || o.customer_phone === u.phone);
          const spent = uOrders.filter(o=>o.payment_status==='paid').reduce((s,o)=>s+Number(o.grand_total||0),0);
          const last = uOrders.length ? uOrders[0].created_at : '';
          ws.addRow({name:u.name, phone:u.phone, orders:uOrders.length, spent, last});
        }
      }
      if (type === 'reviews' || type === 'all') {
        const ws = wb.addWorksheet('Reviews');
        ws.columns = [{header:'Customer',key:'customer_name'},{header:'Order',key:'order_number'},{header:'Rating',key:'rating'},{header:'Comment',key:'comment'},{header:'Date',key:'created_at'}];
        for (const r of reviews) ws.addRow(r);
      }
      if (type === 'revenue' || type === 'all') {
        const ws = wb.addWorksheet('Revenue');
        ws.columns = [{header:'Metric',key:'metric'},{header:'Value',key:'value'}];
        ws.addRow({metric:'Total Collected Revenue', value: revenueTotal});
        ws.addRow({metric:'Successful Orders', value: paidOrders.length});
        ws.addRow({metric:'Total Orders', value: orders.length});
      }
      const buffer = await wb.xlsx.writeBuffer();
      const check = new ExcelJS.Workbook();
      await check.xlsx.load(buffer);
      if (!check.worksheets.length) throw new Error('Generated workbook has no worksheets');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="hotel-darshan-report.xlsx"');
      res.send(buffer);
      return;
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      const doc = new PDFDocument();
      doc.pipe(res);
      doc.fontSize(16).text('Hotel Darshan Report', {align:'center'});
      doc.moveDown();
      doc.fontSize(10).text(`Period: ${period}  Type: ${type}`);
      doc.moveDown();
      if (type === 'orders' || type === 'all') {
        doc.fontSize(12).text('Orders');
        for (const o of orders.slice(0,100)) doc.fontSize(9).text(`${o.order_number} | ${o.customer_name} | ${o.grand_total} | ${o.status}`);
        doc.moveDown();
      }
      if (type === 'customers' || type === 'all') {
        doc.fontSize(12).text('Customers');
        for (const u of users) doc.fontSize(9).text(`${u.name} | ${u.phone}`);
        doc.moveDown();
      }
      if (type === 'reviews' || type === 'all') {
        doc.fontSize(12).text('Reviews');
        for (const r of reviews) doc.fontSize(9).text(`${r.customer_name} | ${r.rating} | ${r.comment || ''}`);
        doc.moveDown();
      }
      if (type === 'revenue' || type === 'all') {
        doc.fontSize(12).text('Revenue');
        doc.fontSize(9).text(`Total Collected Revenue: ${revenueTotal}`);
        doc.fontSize(9).text(`Successful Orders: ${paidOrders.length}`);
      }
      doc.end();
      return;
    }
    res.status(400).json({error:'Unsupported format'});
  } catch (e) {
    console.error('[reports] error', e);
    res.status(500).json({error:e.message});
  }
});

export default router;
