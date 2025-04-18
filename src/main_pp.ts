import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { StatsLogger } from './logger';
import { LiveOrderManager } from './live_order_manager';
import { LiveWebSocket } from './live_websocket';
import { BitMEXAPI } from './bitmex_api';
import { StateManager } from './state_manager';
import { MetricsManager, MetricsConfig } from './metrics_manager';
import { 
  INFINITY_GRID_ENABLED, 
  VARIABLE_ORDER_SIZE_ENABLED, 
  ORDER_SIZE_PRICE_RANGE_FACTOR, 
  MAX_ORDER_SIZE_MULTIPLIER, 
  MIN_ORDER_SIZE_MULTIPLIER,
  ORDER_DISTANCE,
  ORDER_SIZE,
  BREAKOUT_DETECTION_ENABLED,
  BREAKOUT_ATR_THRESHOLD,
  BREAKOUT_PROFIT_TARGET_ATR_MULTIPLE,
  BREAKOUT_STOP_LOSS_ATR_MULTIPLE,
  DEFAULT_SYMBOL,
  BREAKEVEN_GRID_ENABLED
} from './constants';

dotenv.config();

const API_KEY = process.env.BITMEX_API_KEY || '';
const API_SECRET = process.env.BITMEX_API_SECRET || '';
const SYMBOL = process.env.TRADING_SYMBOL || DEFAULT_SYMBOL;
const DRY_RUN = process.env.DRY_RUN === 'true' || !API_KEY || !API_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

const INFLUX_HOST = process.env.INFLUX_HOST || '';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const INFLUX_DATABASE = process.env.INFLUX_DATABASE || 'prometheus_grid';
const INFLUX_ENABLED = process.env.INFLUX_ENABLED === 'true' && !!INFLUX_HOST;
const INFLUX_DEBUG = process.env.INFLUX_DEBUG === 'true';

const logger = new StatsLogger('pp-live');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (ORDER_DISTANCE <= 0) {
  throw new Error(`Invalid ORDER_DISTANCE: ${ORDER_DISTANCE}, must be positive`);
}

if (ORDER_SIZE <= 0) {
  throw new Error(`Invalid ORDER_SIZE: ${ORDER_SIZE}, must be positive`);
}

if (MAX_ORDER_SIZE_MULTIPLIER < MIN_ORDER_SIZE_MULTIPLIER) {
  throw new Error(`Invalid order size multipliers: MAX_ORDER_SIZE_MULTIPLIER (${MAX_ORDER_SIZE_MULTIPLIER}) must be >= MIN_ORDER_SIZE_MULTIPLIER (${MIN_ORDER_SIZE_MULTIPLIER})`);
}

const run = async (): Promise<void> => {
  try {
    logger.star('==========================================');
    logger.star('   Prometheus BitMEX Grid Trading Bot    ');
    logger.star('==========================================');
    
    logger.info(`Trading symbol: ${SYMBOL}`);
    logger.info(`Data directory: ${DATA_DIR}`);
    
    if (INFINITY_GRID_ENABLED) {
      logger.star('Infinity Grid Mode: ENABLED - Grid will automatically shift to follow price trends');
    } else {
      logger.info('Infinity Grid Mode: DISABLED - Grid will remain fixed at initialization price');
    }
    
    if (VARIABLE_ORDER_SIZE_ENABLED) {
      logger.star('Variable Order Size: ENABLED - Order sizes will adapt to price levels');
      logger.info(`Order size range: ${MIN_ORDER_SIZE_MULTIPLIER.toFixed(2)}x - ${MAX_ORDER_SIZE_MULTIPLIER.toFixed(2)}x across ${ORDER_SIZE_PRICE_RANGE_FACTOR.toFixed(2)}x grid range`);
    } else {
      logger.info('Variable Order Size: DISABLED - All orders will use the same size');
    }
    
    if (BREAKOUT_DETECTION_ENABLED) {
      logger.star('Breakout Detection: ENABLED - Grid trading will pause during strong breakouts');
      logger.info(`Breakout settings: ATR Threshold: ${BREAKOUT_ATR_THRESHOLD}x, Profit Target: ${BREAKOUT_PROFIT_TARGET_ATR_MULTIPLE}x ATR, Stop Loss: ${BREAKOUT_STOP_LOSS_ATR_MULTIPLE}x ATR`);
    } else {
      logger.info('Breakout Detection: DISABLED - Grid trading will continue during all market conditions');
    }
    
    if (BREAKEVEN_GRID_ENABLED) {
      logger.star('Breakeven Grid Mode: ENABLED - Grid spacing will adapt to ensure breakeven trades after fees');
    } else {
      logger.info(`Breakeven Grid Mode: DISABLED - Using fixed grid spacing of ${ORDER_DISTANCE}`);
    }
    
    if (DRY_RUN) {
      logger.warn('RUNNING IN DRY RUN MODE - NO REAL ORDERS WILL BE PLACED');
      if (!API_KEY || !API_SECRET) {
        logger.warn('API credentials not provided, system will run in DRY RUN mode');
      }
    } else {
      logger.star('LIVE TRADING MODE ACTIVATED - REAL ORDERS WILL BE PLACED');
    }

    let metricsManager: MetricsManager | null = null;
    
    if (INFLUX_ENABLED) {
      logger.info(`Initializing InfluxDB metrics: ${INFLUX_HOST} (${INFLUX_DATABASE})${INFLUX_DEBUG ? ' [DEBUG MODE]' : ''}`);

      metricsManager = new MetricsManager(logger, {
        host: INFLUX_HOST,
        token: INFLUX_TOKEN,
        database: INFLUX_DATABASE,
        enabled: INFLUX_ENABLED,
        debug: INFLUX_DEBUG
      }, SYMBOL);
      
      if (INFLUX_DEBUG) {
        logger.info('Metrics debug mode enabled, additional verbose logging will be shown');
      }
    } else {
      logger.warn('InfluxDB metrics disabled');
    }
    
    // Initialize state manager
    const statePath = path.join(DATA_DIR, `prometheus_${SYMBOL.toLowerCase()}.json`);
    const stateManager = new StateManager(statePath, logger);
    await stateManager.initialize();
    
    // Initialize BitMEX API client
    const api = new BitMEXAPI(API_KEY, API_SECRET, logger, false);
    
    // Fetch all active instruments to cache them for later use
    try {
      logger.info('Pre-fetching all active instruments...');
      const instruments = await api.getActiveInstruments();
      logger.success(`Cached ${instruments.length} active instruments for quick access`);
      
      // Log details about our trading instrument
      const tradingInstrument = instruments.find(i => i.symbol === SYMBOL);
      if (tradingInstrument) {
        logger.info(`Trading instrument details: ${SYMBOL}`);
        logger.info(`  Type: ${tradingInstrument.typ}`);
        logger.info(`  Lot Size: ${tradingInstrument.lotSize}`);
        logger.info(`  Tick Size: ${tradingInstrument.tickSize}`);
        logger.info(`  Multiplier: ${tradingInstrument.multiplier || 'N/A'}`);
        logger.info(`  Quote Currency: ${tradingInstrument.quoteCurrency || 'N/A'}`);
        logger.info(`  Maker Fee: ${(tradingInstrument.makerFee || 0) * 100}%`);
        logger.info(`  Taker Fee: ${(tradingInstrument.takerFee || 0) * 100}%`);
      }
    } catch (error) {
      logger.warn(`Could not pre-fetch instruments: ${error}`);
      logger.warn('Will fetch instrument details as needed instead');
    }
    
    // Initialize the order manager
    const orderManager = new LiveOrderManager(api, stateManager, logger, SYMBOL, DRY_RUN, metricsManager);
    await orderManager.initialize();
    
    // Initialize the WebSocket connection
    const websocket = new LiveWebSocket(orderManager, logger, API_KEY, API_SECRET, SYMBOL);
    
    // Handle process termination signals
    const handleShutdown = async (signal: string) => {
      logger.warn(`Received ${signal} signal, shutting down...`);
      websocket.close();
      orderManager.cleanup();
      if (metricsManager) {
        metricsManager.close();
      }
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