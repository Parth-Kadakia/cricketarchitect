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
import marketplaceRoutes from './routes/marketplaceRoutes.js';
import squadRoutes from './routes/squadRoutes.js';
import youthRoutes from './routes/youthRoutes.js';

const app = express();

app.use(
  cors({
    origin: env.frontendOrigin,
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
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

export default app;
