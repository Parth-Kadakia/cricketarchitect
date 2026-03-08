import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import env from './config/env.js';
import errorHandler from './middleware/errorHandler.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import cityRoutes from './routes/cityRoutes.js';
import financialRoutes from './routes/financialRoutes.js';
import franchiseRoutes from './routes/franchiseRoutes.js';
import leagueRoutes from './routes/leagueRoutes.js';
import managerRoutes from './routes/managerRoutes.js';
import marketplaceRoutes from './routes/marketplaceRoutes.js';
import statbookRoutes from './routes/statbookRoutes.js';
import squadRoutes from './routes/squadRoutes.js';
import youthRoutes from './routes/youthRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: env.nodeEnv === 'production' ? true : env.frontendOrigin,
    credentials: true
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    service: 'Global T20 Franchise Manager API',
    status: 'ok',
    now: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/franchises', franchiseRoutes);
app.use('/api/squad', squadRoutes);
app.use('/api/youth', youthRoutes);
app.use('/api/league', leagueRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/statbook', statbookRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/admin', adminRoutes);

// --- Serve built frontend in production ---
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback: any non-API route serves index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use(errorHandler);

export default app;
