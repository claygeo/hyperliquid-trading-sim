import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app.js';
import { WebSocketServer } from './websocket/index.js';
import { HyperliquidService } from './services/hyperliquid/index.js';
import { StressTestService } from './services/stress-test/index.js';
import { setHyperliquidService } from './routes/trading.routes.js';
import { setStressTestService } from './routes/stressTest.routes.js';
import { logger } from './lib/logger.js';
import { config } from './config/index.js';

const PORT = config.port;

async function main() {
  // Create HTTP server
  const server = createServer(app);

  // Initialize WebSocket server
  const wss = new WebSocketServer(server);

  // Initialize Hyperliquid service
  const hyperliquid = new HyperliquidService(wss);
  
  // Initialize Stress Test service
  const stressTest = new StressTestService(wss);
  
  // Inject services into routes
  setHyperliquidService(hyperliquid);
  setStressTestService(stressTest);

  // Connect to Hyperliquid
  try {
    await hyperliquid.connect();
    logger.info('Connected to Hyperliquid');
  } catch (error) {
    logger.error('Failed to connect to Hyperliquid:', error);
  }

  // Start server
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`WebSocket server ready`);
    logger.info(`Environment: ${config.nodeEnv}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    
    stressTest.setSpeed('off'); // Stop stress test
    hyperliquid.disconnect();
    wss.close();
    
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
