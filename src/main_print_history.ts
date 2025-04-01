import * as dotenv from 'dotenv';
import * as path from 'path';
import { HistoryLogger } from './history_logger';
import { BitMEXAPI } from './bitmex_api';
import { DEFAULT_SYMBOL } from './constants';

// Load environment variables
dotenv.config();

// Extract API credentials
const API_KEY = process.env.BITMEX_API_KEY || '';
const API_SECRET = process.env.BITMEX_API_SECRET || '';
const SYMBOL = process.env.TRADING_SYMBOL || DEFAULT_SYMBOL;
const DRY_RUN = process.env.DRY_RUN === 'true' || !API_KEY || !API_SECRET;

// Create a logger instance
const logger = new HistoryLogger('history');

const formatDate = (date: string): string => {
  return new Date(date).toLocaleString();
};

const formatNumber = (num: number): string => {
  return num.toFixed(8);
};

const formatPnl = (pnl: number): string => {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${formatNumber(pnl)}`;
};

const convertContractsToBTC = (contracts: number, price: number): number => {
  return contracts / price;
};

const run = async (): Promise<void> => {
  try {
    // Display startup banner
    logger.star('==========================================');
    logger.star('   Prometheus Trade History Viewer        ');
    logger.star('==========================================');
    
    // Log configuration details
    logger.info(`Trading symbol: ${SYMBOL}`);
    
    if (DRY_RUN) {
      logger.warn('RUNNING IN DRY RUN MODE - NO REAL ORDERS WILL BE PLACED');
      if (!API_KEY || !API_SECRET) {
        logger.warn('API credentials not provided, system will run in DRY RUN mode');
      }
    }

    // Initialize BitMEX API client
    const api = new BitMEXAPI(API_KEY, API_SECRET, logger, false);
    
    // Fetch recent filled orders
    logger.info('Fetching recent filled orders...');
    const filledOrders = await api.getRecentFilledOrders(SYMBOL);
    
    if (filledOrders.length === 0) {
      logger.warn('No filled orders found');
      return;
    }
    
    // Group orders by date (day)
    const ordersByDate = filledOrders.reduce((acc, order) => {
      const date = order.transactTime.split('T')[0];
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(order);
      return acc;
    }, {} as Record<string, typeof filledOrders>);
    
    // Print orders grouped by date
    Object.entries(ordersByDate).forEach(([date, orders]) => {
      logger.star(`\n${date}`);
      logger.star('----------------------------------------');
      
      let dailyPnl = 0;
      let dailyVolume = 0;
      
      orders.forEach((order) => {
        const price = order.avgPx || 0;
        const btcAmount = convertContractsToBTC(order.cumQty, price);
        const pnl = (price * order.cumQty * (order.side === 'Buy' ? -1 : 1)) / price; // Convert P&L to BTC
        dailyPnl += pnl;
        dailyVolume += btcAmount;
        
        logger.info(
          `${formatDate(order.transactTime)} | ` +
          `${order.side.padEnd(4)} | ` +
          `${formatNumber(btcAmount).padStart(12)} BTC | ` +
          `$${formatNumber(price).padStart(8)} | ` +
          `${formatPnl(pnl).padStart(12)} BTC`
        );
      });
      
      logger.star('----------------------------------------');
      logger.info(
        `Daily Summary: ` +
        `Volume: ${formatNumber(dailyVolume).padStart(12)} BTC | ` +
        `P&L: ${formatPnl(dailyPnl).padStart(12)} BTC`
      );
    });
    
    // Calculate and display overall statistics
    const totalPnl = filledOrders.reduce((sum, order) => {
      const price = order.avgPx || 0;
      return sum + ((price * order.cumQty * (order.side === 'Buy' ? -1 : 1)) / price);
    }, 0);
    
    const totalVolume = filledOrders.reduce((sum, order) => {
      return sum + convertContractsToBTC(order.cumQty, order.avgPx || 0);
    }, 0);
    
    logger.star('\nOverall Statistics');
    logger.star('----------------------------------------');
    logger.info(`Total Trades: ${filledOrders.length}`);
    logger.info(`Total Volume: ${formatNumber(totalVolume)} BTC`);
    logger.info(`Total P&L: ${formatPnl(totalPnl)} BTC`);
    logger.info(`Average Trade Size: ${formatNumber(totalVolume / filledOrders.length)} BTC`);
    logger.info(`Average P&L per Trade: ${formatPnl(totalPnl / filledOrders.length)} BTC`);
    
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
  }
};

run().catch((error: unknown): void => {
  const logger = new HistoryLogger('error');
  logger.error((error as Error)?.message ?? String(error));
}); 