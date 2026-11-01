import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { authMiddleware, requireRole } from '../auth.js';
import { db } from '../db.js';

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

    res.setHeader('Content-Disposition', `attachment; filename="hotel-darshan-report.${format === 'excel' ? 'xlsx' : format === 'pdf' ? 'pdf' : format === 'zip' ? 'zip' : 'csv'}"`);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      let rows = [];
      if (type === 'orders' || type === 'all') {
        rows.push('Order ID,Date,Customer,Phone,Items,Item Total,Delivery Fee,Tax,Discount,Grand Total,Payment Method,Payment Status,Status,Type');
        for (const o of orders) rows.push([o.order_number, o.created_at, o.customer_name, o.customer_phone, (JSON.parse(o.items_json||'[]').map(i=>i.name_en||i.id).join('; ')), o.item_total, o.delivery_fee, o.tax_amount, o.discount_amount, o.grand_total, o.payment_method, o.payment_status, o.status, o.order_type].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','));
      }
      res.send(rows.join('\n'));
      return;
    }
    if (format === 'excel') {
      const wb = new ExcelJS.Workbook();
      if (type === 'orders' || type === 'all') {
        const ws = wb.addWorksheet('Orders');
        ws.columns = [{header:'Order ID',key:'order_number'},{header:'Date',key:'created_at'},{header:'Customer',key:'customer_name'},{header:'Phone',key:'customer_phone'},{header:'Grand Total',key:'grand_total'},{header:'Payment',key:'payment_status'},{header:'Status',key:'status'}];
        for (const o of orders) ws.addRow(o);
      }
      if (type === 'reviews' || type === 'all') {
        const ws = wb.addWorksheet('Reviews');
        ws.columns = [{header:'Customer',key:'customer_name'},{header:'Order',key:'order_number'},{header:'Rating',key:'rating'},{header:'Comment',key:'comment'},{header:'Date',key:'created_at'}];
        for (const r of reviews) ws.addRow(r);
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await wb.xlsx.write(res);
      res.end();
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
      for (const o of orders.slice(0,50)) {
        doc.text(`${o.order_number} | ${o.customer_name} | ${o.grand_total} | ${o.status}`);
      }
      doc.end();
      return;
    }
    res.status(400).json({error:'Unsupported format'});
  } catch (e) {
    res.status(500).json({error:e.message});
  }
});

export default router;
