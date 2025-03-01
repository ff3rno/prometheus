import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { StatsLogger } from './logger';
import { LiveOrderManager } from './live_order_manager';
import { LiveWebSocket } from './live_websocket';
import { BitMEXAPI } from './bitmex_api';
import { StateManager } from './state_manager';

// Load environment variables
dotenv.config();

// Extract API credentials
const API_KEY = process.env.BITMEX_API_KEY || '';
const API_SECRET = process.env.BITMEX_API_SECRET || '';
const SYMBOL = process.env.TRADING_SYMBOL || 'XBTUSD';
const DRY_RUN = process.env.DRY_RUN === 'true' || !API_KEY || !API_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Create a logger instance
const logger = new StatsLogger('pp-live');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const run = async (): Promise<void> => {
  try {
    // Display startup banner
    logger.star('==========================================');
    logger.star('   Prometheus BitMEX Grid Trading Bot    ');
    logger.star('==========================================');
    
    // Log configuration details
    logger.info(`Trading symbol: ${SYMBOL}`);
    logger.info(`Data directory: ${DATA_DIR}`);
    
    if (DRY_RUN) {
      logger.warn('RUNNING IN DRY RUN MODE - NO REAL ORDERS WILL BE PLACED');
      if (!API_KEY || !API_SECRET) {
        logger.warn('API credentials not provided, system will run in DRY RUN mode');
      }
    } else {
      logger.star('LIVE TRADING MODE ACTIVATED - REAL ORDERS WILL BE PLACED');
    }
    
    // Initialize state manager
    const statePath = path.join(DATA_DIR, `prometheus_${SYMBOL.toLowerCase()}.json`);
    const stateManager = new StateManager(statePath, logger);
    await stateManager.initialize();
    
    // Initialize BitMEX API client
    const api = new BitMEXAPI(API_KEY, API_SECRET, logger, false);
    
    // Initialize the order manager
    const orderManager = new LiveOrderManager(api, stateManager, logger, SYMBOL, DRY_RUN);
    await orderManager.initialize();
    
    // Initialize the WebSocket connection
    const websocket = new LiveWebSocket(orderManager, logger, API_KEY, API_SECRET, SYMBOL);
    
    // Handle process termination signals
    const handleShutdown = async (signal: string) => {
      logger.warn(`Received ${signal} signal, shutting down...`);
      websocket.close();
      await stateManager.close();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    
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