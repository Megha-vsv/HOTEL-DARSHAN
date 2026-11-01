// FIRST import, deliberately. ES modules evaluate their dependencies before the
// importing file's own body, so this is the only position from which dotenv is
// guaranteed to have run before db.js, authRoutes.js, auth.js and the payment
// config read process.env. See server/src/env.js for the full explanation.
import './env.js';

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase } from './db.js';
import { initSocketIO } from './socket.js';
import { startOrderProgression } from './orderProgression.js';

import authRoutes from './routes/authRoutes.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payment.js';
import couponRoutes from './routes/coupons.js';
import customerRoutes from './routes/customers.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import staffRoutes from './routes/staff.js';
import geocodeRoutes from './routes/geocode.js';
import riderRoutes from './routes/rider.js';
import reportRoutes from './routes/reports.js';

// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================
//
// Loaded by server/src/env.js, imported above before any other module. Calling
// dotenv.config() here as well would be redundant and misleading: by the time this
// line runs, every module that reads process.env has already been evaluated, so a
// second load could not reach them anyway. The ordering, not this position, is
// what makes the environment visible.

// ============================================
// PATH CONFIGURATION
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// DATABASE INITIALIZATION
// ============================================

initDatabase();

// ============================================
// AUTOMATIC ORDER PROGRESSION (Domino's-style live tracking)
// ============================================
// Starts a timer that advances order status automatically.
// In dev mode the timeline is compressed for testing.
startOrderProgression();

// ============================================
// EXPRESS APPLICATION
// ============================================

const app = express();

// Create HTTP server
const server = http.createServer(app);

// ============================================
// SOCKET.IO CONFIGURATION
// ============================================

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: [
      'GET',
      'POST',
      'PATCH',
      'PUT',
      'DELETE'
    ]
  }
});

// Initialize Socket.IO events
initSocketIO(io);

// ============================================
// MIDDLEWARE
// ============================================

// Enable CORS
app.use(
  cors({
    origin: '*',
    methods: [
      'GET',
      'POST',
      'PATCH',
      'PUT',
      'DELETE',
      'OPTIONS'
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization'
    ]
  })
);

// Parse JSON requests
app.use(
  express.json({
    limit: '10mb'
  })
);

// Parse URL encoded data
app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb'
  })
);

// ============================================
// API ROUTES
// ============================================

// Authentication
app.use(
  '/api/auth',
  authRoutes
);

// Menu
app.use(
  '/api/menu',
  menuRoutes
);

// Orders
app.use(
  '/api/orders',
  orderRoutes
);

// Payments
app.use(
  '/api/payment',
  paymentRoutes
);

// Coupons
app.use(
  '/api/coupons',
  couponRoutes
);

// Customers
app.use(
  '/api/customers',
  customerRoutes
);

// Analytics
app.use(
  '/api/analytics',
  analyticsRoutes
);

// Restaurant Settings
app.use(
  '/api/settings',
  settingsRoutes
);

// Staff Management (admin only)
app.use(
  '/api/staff',
  staffRoutes
);

// Address lookup (signed-in customers only)
app.use(
  '/api/geocode',
  geocodeRoutes
);

// Reports
app.use(
  '/api/reports',
  reportRoutes
);
// rider routes inside `/api/orders`, and gated to the rider role inside the
// router, where the identity it trusts is the verified token's.
app.use(
  '/api/rider',
  riderRoutes
);

// ============================================
// HEALTH CHECK
// ============================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      success: true,
      status: 'ok',
      restaurant: 'Hotel Darshan',
      address:
        'Char Rasta, Mosda Road, Dediapada, Gujarat - 393040',
      timestamp: new Date().toISOString()
    });
  }
);

// ============================================
// API 404 HANDLER
// ============================================

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint not found',
      path: req.originalUrl
    });
  }
);

// ============================================
// SERVE FRONTEND IN PRODUCTION
// ============================================

const clientDist = path.join(
  __dirname,
  '..',
  '..',
  'client',
  'dist'
);

// Serve static frontend files
app.use(
  express.static(clientDist)
);

// React/Vite SPA fallback
app.get(
  '*',
  (req, res, next) => {

    // Do not handle API or Socket.IO routes here
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/socket.io')
    ) {
      return next();
    }

    const indexPath =
      path.join(
        clientDist,
        'index.html'
      );

    res.sendFile(
      indexPath,
      (error) => {

        if (error) {

          console.error(
            'Frontend file error:',
            error.message
          );

          res
            .status(200)
            .send(
              'Hotel Darshan API Server is Running.'
            );
        }

      }
    );
  }
);

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use(
  (error, req, res, next) => {

    console.error(
      'Server Error:',
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(
      error.status || 500
    ).json({
      success: false,
      message:
        error.message ||
        'Internal server error'
    });
  }
);

// ============================================
// START SERVER
// ============================================

const PORT =
  process.env.PORT || 5000;

server.listen(
  PORT,
  () => {

    console.log(
      '===================================================='
    );

    console.log(
      '  HOTEL DARSHAN BACKEND & WEBSOCKET SERVER RUNNING  '
    );

    console.log(
      `  URL: http://localhost:${PORT}`
    );

    console.log(
      '===================================================='
    );

    console.log(
      '  API:       /api'
    );

    console.log(
      '  Auth:      /api/auth'
    );

    console.log(
      '  Menu:      /api/menu'
    );

    console.log(
      '  Orders:    /api/orders'
    );

    console.log(
      '  Customers: /api/customers'
    );

    console.log(
      '  Health:    /api/health'
    );

    console.log(
      '===================================================='
    );

  }
);

// ============================================
// EXPORTS
// ============================================

export {
  app,
  server,
  io
};