import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './lib/config';
import { errorHandler } from './lib/middleware';
import { apiRoutes } from './routes/api';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.ALLOWED_ORIGIN || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Special handling for Stripe webhooks (needs raw body)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version endpoint
app.get('/api/version', (req, res) => {
  res.json({
    version: '1.0.0',
    buildTime: new Date().toISOString()
  });
});

// API routes
app.use('/api', apiRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = config.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TradeReferee backend running on port ${PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`Allowed origin: ${config.ALLOWED_ORIGIN}`);
});

export default app;

