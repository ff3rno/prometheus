import { StatsLogger } from './logger';
import { OrderManager } from './orderManager';
import { BitMEXWebSocket } from './websocket';

// Create a logger instance
const logger = new StatsLogger('pp-sim');

const run = async (): Promise<void> => {
  try {
    // Initialize the order manager
    const orderManager = new OrderManager(logger);
    
    // Initialize the WebSocket connection
    const websocket = new BitMEXWebSocket(orderManager, logger);
    
    // Handle process termination signals
    process.on('SIGINT', () => {
      logger.warn('Received SIGINT signal, shutting down...');
      websocket.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.warn('Received SIGTERM signal, shutting down...');
      websocket.close();
      process.exit(0);
    });
    
    logger.info('Market maker bot started');
    
    // Optionally, you can simulate a specific market price before receiving WebSocket data
    // This can be useful for testing or if you want to initialize the grid at a specific price
    // Uncomment the line below and specify your desired price to use this feature
    // orderManager.simulateMarketPrice(30000); // Example: simulate market price at $30,000
  } catch (error) {
    logger.error(`Initialization error: ${(error as Error).message}`);
  }
};

run().catch((error: unknown): void => {
  const logger = new StatsLogger('error');
  logger.error((error as Error)?.message ?? String(error));
});