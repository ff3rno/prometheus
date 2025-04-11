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
  STATIC_REFERENCE_PRICE_ENABLED,
  POSITION_BALANCING_ENABLED,
  POSITION_BALANCING_FACTOR,
  POSITION_ROE_CLOSE_THRESHOLD,
  SAFETY_STOPS_ENABLED,
  SAFETY_STOP_DISTANCE_PERCENT,
  SAFETY_STOP_SIZE_MULTIPLIER,
  ROLLING_GRID_ENABLED,
  ROLLING_GRID_STEP_PERCENT,
  ROLLING_GRID_KEEP_ORDERS
} from './constants';

// Load environment variables
dotenv.config();

// Extract API credentials
const API_KEY = process.env.BITMEX_API_KEY || '';
const API_SECRET = process.env.BITMEX_API_SECRET || '';
const SYMBOL = process.env.TRADING_SYMBOL || 'XBTUSD';
const DRY_RUN = process.env.DRY_RUN === 'true' || !API_KEY || !API_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// InfluxDB configuration
const INFLUX_HOST = process.env.INFLUX_HOST || '';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const INFLUX_DATABASE = process.env.INFLUX_DATABASE || 'prometheus_grid';
const INFLUX_ENABLED = process.env.INFLUX_ENABLED === 'true' && !!INFLUX_HOST;
const INFLUX_DEBUG = process.env.INFLUX_DEBUG === 'true';

// Create a logger instance
const logger = new StatsLogger('pp-live');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Validate configuration constants
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
    // Display startup banner
    logger.star('==========================================');
    logger.star('   Prometheus BitMEX Grid Trading Bot    ');
    logger.star('==========================================');
    
    // Log configuration details
    logger.info(`Trading symbol: ${SYMBOL}`);
    logger.info(`Data directory: ${DATA_DIR}`);
    
    // Log information about dynamic features
    if (ROLLING_GRID_ENABLED) {
      logger.star('Rolling Grid Mode: ENABLED - Grid follows price in fixed steps, maintaining spread');
      logger.info(`Step trigger: Price reaches ${ROLLING_GRID_STEP_PERCENT}% of grid edge`);
      logger.info(`Order retention: ${ROLLING_GRID_KEEP_ORDERS}% of orders kept during grid roll`);
      logger.info('This mode ensures continuous trading as price moves, with less order cancellations');
    } else if (INFINITY_GRID_ENABLED) {
      logger.star('Infinity Grid Mode: ENABLED - Grid will automatically shift to follow price trends');
      
      if (STATIC_REFERENCE_PRICE_ENABLED) {
        logger.star('Static Reference Price: ENABLED - Grid will maintain original reference price when shifting');
        logger.info('This prevents losing trades that could be caused by reference price changes during grid shifts');
      } else {
        logger.info('Static Reference Price: DISABLED - Reference price will change when grid shifts');
      }
    } else {
      logger.info('Fixed Grid Mode: ENABLED - Grid will remain fixed at initialization price');
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
    
    // Log information about position balancing
    if (POSITION_BALANCING_ENABLED) {
      logger.star('Position Balancing: ENABLED - Grid will adjust order sizes to help close open positions');
      logger.info(`Position balancing factor: ${POSITION_BALANCING_FACTOR.toFixed(2)}x (higher = more aggressive closing)`);
      logger.info(`Auto-close threshold: ${(POSITION_ROE_CLOSE_THRESHOLD * 100).toFixed(2)}% ROE`);
    } else {
      logger.info('Position Balancing: DISABLED - Grid will use consistent order sizes regardless of position');
    }
    
    // Log information about safety stop orders
    if (SAFETY_STOPS_ENABLED) {
      logger.star('Safety Stop Orders: ENABLED - Will place stop limit orders outside grid boundaries');
      logger.info(`Distance from grid boundary: ${SAFETY_STOP_DISTANCE_PERCENT.toFixed(1)}% of grid size`);
      logger.info(`Order size multiplier: ${SAFETY_STOP_SIZE_MULTIPLIER.toFixed(1)}x regular grid orders`);
      logger.info('These stops protect against sudden price moves that leave grid one-sided');
      logger.info('Safety stops automatically adjust to match and close out your position size');
    } else {
      logger.info('Safety Stop Orders: DISABLED - No automatic stop orders outside grid');
    }
    
    if (DRY_RUN) {
      logger.warn('RUNNING IN DRY RUN MODE - NO REAL ORDERS WILL BE PLACED');
      if (!API_KEY || !API_SECRET) {
        logger.warn('API credentials not provided, system will run in DRY RUN mode');
      }
    } else {
      logger.star('LIVE TRADING MODE ACTIVATED - REAL ORDERS WILL BE PLACED');
    }

    // InfluxDB metrics configuration
    const metricsConfig: MetricsConfig = {
      host: INFLUX_HOST,
      token: INFLUX_TOKEN,
      database: INFLUX_DATABASE,
      enabled: INFLUX_ENABLED,
      debug: INFLUX_DEBUG
    };

    // Initialize metrics manager
    let metricsManager: MetricsManager | null = null;
    
    if (INFLUX_ENABLED) {
      logger.info(`Initializing InfluxDB metrics: ${INFLUX_HOST} (${INFLUX_DATABASE})${INFLUX_DEBUG ? ' [DEBUG MODE]' : ''}`);
      metricsManager = new MetricsManager(logger, metricsConfig, SYMBOL);
      
      // Log metrics capabilities
      logger.info('Metrics tracking enabled for:');
      logger.info('- Trade performance (profit/loss, fees, volume)');
      logger.info('- Order execution (creation, fills, cancellations)');
      logger.info('- Grid statistics (distance, trend adaptation)');
      logger.info('- Position metrics (size, direction, duration, P&L)');
      logger.info('- Open position tracking (real-time position data)');
      logger.info('- Grid level profitability (which levels generate most profit)');
      logger.info('- Fill time distribution (time between fills at each level)');
      logger.info('- Grid boundary efficiency (how often price hits boundaries)');
      logger.info('- Grid rebalancing metrics (frequency and impact of shifts)');
      
      // Enable additional debug logging if in debug mode
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