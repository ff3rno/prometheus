import Bottleneck from 'bottleneck';
import { Order, MEXCOrder, MEXCPosition, MEXCInstrument, MEXCTrade, ExchangeAPI, MEXCAPIResponse } from './types';
import { StatsLogger } from './logger';
import { FEE_RATE, getNextOrderId } from './constants';
import axios from 'axios';
import * as crypto from 'crypto';

// Define types for MEXC Spot API responses
interface MEXCSpotExchangeInfoResponse {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<{
      filterType: string;
      tickSize?: string;
      stepSize?: string;
      minQty?: string;
      maxQty?: string;
      minNotional?: string;
    }>;
  }>;
}

interface MEXCSpotOrderResponse {
  orderId: string;
  symbol: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  type: string;
  side: 'BUY' | 'SELL';
  time: number;
  updateTime: number;
  transactTime?: number;
}

interface MEXCSpotAccountResponse {
  balances: Array<{
    asset: string;
    free: string;
    locked: string;
  }>;
}

export class MEXCAPI implements ExchangeAPI {
  private apiKey: string;
  private apiSecret: string;
  private logger: StatsLogger;
  private instrumentCache: Map<string, MEXCInstrument> = new Map();
  private baseUrl: string = 'https://api.mexc.com';
  
  // Main limiter for API rate limiting
  private mainLimiter: Bottleneck;

  constructor(apiKey: string, apiSecret: string, logger: StatsLogger) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.logger = logger;
    
    // Initialize rate limiter
    this.mainLimiter = new Bottleneck({
      reservoir: 100, // 100 requests
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 60 * 1000, // 1 minute
      maxConcurrent: 10, // Maximum concurrent requests
      minTime: 100 // Minimum time between requests (ms)
    });
    
    // Set up limiter events for logging
    this.setupLimiterEvents();
  }

  /**
   * Set up event handlers for rate limiters
   */
  private setupLimiterEvents(): void {
    this.mainLimiter.on('depleted', () => {
      this.logger.warn('Main rate limit reached - throttling requests');
    });
    
    this.mainLimiter.on('error', (error) => {
      this.logger.error(`Main limiter error: ${error}`);
    });
  }

  /**
   * Makes a direct REST API call to MEXC
   */
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    params: Record<string, any> = {},
    isPrivate: boolean = false
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const timestamp = Date.now();
    
    let queryString = Object.entries(params)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // For private endpoints, add authentication
    if (isPrivate) {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('API key and secret are required for private endpoints');
      }
      
      headers['X-MEXC-APIKEY'] = this.apiKey;
      
      // Add timestamp to query string
      queryString = queryString ? `${queryString}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
      
      // Create signature
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(queryString)
        .digest('hex');
      
      // Add signature to query string
      queryString = `${queryString}&signature=${signature}`;
    }
    
    const requestUrl = queryString ? `${url}?${queryString}` : url;
    
    try {
      const response = await this.mainLimiter.schedule(() => 
        axios({
          method,
          url: requestUrl,
          headers,
        })
      );
      
      return response.data as T;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        this.logger.error(`API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        throw new Error(`API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Get instrument details from MEXC
   */
  async getInstrument(symbol: string): Promise<MEXCInstrument | null> {
    // Check cache first
    if (this.instrumentCache.has(symbol)) {
      return this.instrumentCache.get(symbol) || null;
    }
    
    try {
      this.logger.info(`Fetching instrument details for ${symbol}`);
      
      // Direct API call to exchange info endpoint
      const response = await this.makeRequest<MEXCSpotExchangeInfoResponse>(
        '/api/v3/exchangeInfo', 
        'GET',
        { symbols: symbol },
        false
      );
      
      if (response && response.symbols && response.symbols.length > 0) {
        const spotData = response.symbols[0];
        
        // Find needed filters
        const priceFilter = spotData.filters.find((f) => f.filterType === 'PRICE_FILTER');
        const lotSizeFilter = spotData.filters.find((f) => f.filterType === 'LOT_SIZE');
        const minNotionalFilter = spotData.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
        
        const instrument: MEXCInstrument = {
          symbol: spotData.symbol,
          state: spotData.status || 'TRADING',
          baseCoin: spotData.baseAsset,
          quoteCoin: spotData.quoteAsset,
          tickSize: parseFloat(priceFilter?.tickSize || '0.00000001'),
          lotSize: parseFloat(lotSizeFilter?.stepSize || '0.00000001'),
          minQty: parseFloat(lotSizeFilter?.minQty || '0'),
          maxQty: parseFloat(lotSizeFilter?.maxQty || '0'),
          minNotional: parseFloat(minNotionalFilter?.minNotional || '0'),
          makerFee: 0.002, // Default spot maker fee
          takerFee: 0.002  // Default spot taker fee
        };
        
        // Cache the instrument details
        this.instrumentCache.set(symbol, instrument);
        this.logger.success(`Retrieved spot instrument details for ${symbol}: lotSize=${instrument.lotSize}, tickSize=${instrument.tickSize}`);
        return instrument;
      }
      
      this.logger.warn(`No instrument found for symbol: ${symbol}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch instrument details for ${symbol}: ${error instanceof Error ? error.stack : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get all active instruments
   */
  async getActiveInstruments(): Promise<MEXCInstrument[]> {
    try {
      this.logger.info('Fetching all active instruments from MEXC spot market');
      
      // Direct API call to exchange info endpoint
      const response = await this.makeRequest<MEXCSpotExchangeInfoResponse>(
        '/api/v3/exchangeInfo',
        'GET',
        {},
        false
      );
      
      const instruments: MEXCInstrument[] = [];
      
      if (response && response.symbols) {
        for (const symbol of response.symbols) {
          if (symbol.status === 'TRADING') {
            // Find needed filters
            const priceFilter = symbol.filters.find((f) => f.filterType === 'PRICE_FILTER');
            const lotSizeFilter = symbol.filters.find((f) => f.filterType === 'LOT_SIZE');
            const minNotionalFilter = symbol.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
            
            const instrument: MEXCInstrument = {
              symbol: symbol.symbol,
              state: symbol.status,
              baseCoin: symbol.baseAsset,
              quoteCoin: symbol.quoteAsset,
              tickSize: parseFloat(priceFilter?.tickSize || '0.00000001'),
              lotSize: parseFloat(lotSizeFilter?.stepSize || '0.00000001'),
              minQty: parseFloat(lotSizeFilter?.minQty || '0'),
              maxQty: parseFloat(lotSizeFilter?.maxQty || '0'),
              minNotional: parseFloat(minNotionalFilter?.minNotional || '0'),
              makerFee: 0.002, // Default spot maker fee
              takerFee: 0.002  // Default spot taker fee
            };
            
            // Cache the instrument
            this.instrumentCache.set(symbol.symbol, instrument);
            instruments.push(instrument);
          }
        }
      }
      
      this.logger.success(`Retrieved ${instruments.length} active instruments from MEXC spot market`);
      return instruments;
    } catch (error) {
      this.logger.error(`Failed to fetch active instruments: ${error}`);
      return [];
    }
  }

  /**
   * Fetches open orders from the MEXC API
   */
  async getOpenOrders(symbol: string): Promise<MEXCOrder[]> {
    try {
      this.logger.info(`Fetching open orders for ${symbol}`);
      
      // Direct API call to open orders endpoint
      const response = await this.makeRequest<MEXCSpotOrderResponse[]>(
        '/api/v3/openOrders',
        'GET',
        { symbol },
        true
      );
      
      if (response && Array.isArray(response)) {
        return response.map((order) => ({
          orderId: order.orderId,
          symbol: order.symbol,
          price: parseFloat(order.price),
          quantity: parseFloat(order.origQty),
          executedQty: parseFloat(order.executedQty),
          remainingQty: parseFloat(order.origQty) - parseFloat(order.executedQty),
          side: order.side,
          status: order.status,
          type: order.type,
          time: order.time,
          updateTime: order.updateTime
        }));
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch open orders: ${error}`);
      return [];
    }
  }

  /**
   * Rounds a quantity to be a multiple of the lot size
   */
  private roundToLotSize(quantity: number, lotSize: number): number {
    return Math.floor(quantity / lotSize) * lotSize;
  }

  /**
   * Rounds a price to be a multiple of the tick size
   */
  private roundToTickSize(price: number, tickSize: number): number {
    const precision = this.getPrecisionFromTickSize(tickSize);
    const rounded = Math.floor(price / tickSize) * tickSize;
    return parseFloat(rounded.toFixed(precision));
  }

  /**
   * Determines the decimal precision from a tick size
   */
  private getPrecisionFromTickSize(tickSize: number): number {
    const tickSizeStr = tickSize.toString();
    const decimalIndex = tickSizeStr.indexOf('.');
    
    if (decimalIndex === -1) {
      return 0;
    }
    
    return tickSizeStr.length - decimalIndex - 1;
  }

  /**
   * Places a limit order on MEXC
   */
  async placeLimitOrder(side: 'Buy' | 'Sell', price: number, quantity: number, symbol: string): Promise<MEXCOrder> {
    try {
      // Validate price is positive
      if (price <= 0) {
        throw new Error(`Invalid price ${price} - must be positive`);
      }
      
      // Fetch instrument details to get the lotSize
      const instrument = await this.getInstrument(symbol);
      if (!instrument) {
        throw new Error(`Could not retrieve instrument details for ${symbol}`);
      }
      
      // Ensure the order quantity is a multiple of the lot size
      const lotSize = instrument.lotSize;
      const roundedOrderQty = this.roundToLotSize(quantity, lotSize);
      
      if (roundedOrderQty !== quantity) {
        this.logger.warn(`Adjusted order quantity from ${quantity} to ${roundedOrderQty} to comply with lot size ${lotSize}`);
        quantity = roundedOrderQty;
      }
      
      // Make sure we're not sending a zero order
      if (quantity === 0) {
        quantity = lotSize; // Use minimum lot size
        this.logger.warn(`Order quantity would be zero after adjustment - using minimum lot size ${lotSize} instead`);
      }

      // Ensure the price is a multiple of the tick size
      const tickSize = instrument.tickSize;
      const roundedPrice = this.roundToTickSize(price, tickSize);
      
      if (roundedPrice !== price) {
        this.logger.warn(`Adjusted price from ${price} to ${roundedPrice} to comply with tick size ${tickSize}`);
        price = roundedPrice;
      }

      // Check minNotional (minimum order value)
      if (instrument.minNotional && price * quantity < instrument.minNotional) {
        const oldQty = quantity;
        quantity = Math.ceil(instrument.minNotional / price / lotSize) * lotSize;
        this.logger.warn(`Adjusted quantity from ${oldQty} to ${quantity} to meet minimum notional value of ${instrument.minNotional}`);
      }

      this.logger.info(`Placing ${side} limit order: ${quantity} @ $${price} on ${symbol}`);
      
      // Direct API call to place order endpoint
      const params = {
        symbol,
        side: side.toUpperCase(),
        type: 'LIMIT',
        quantity: quantity.toString(),
        price: price.toString(),
        timeInForce: 'GTC' // Good Till Canceled
      };
      
      const response = await this.makeRequest<MEXCSpotOrderResponse>(
        '/api/v3/order',
        'POST',
        params,
        true
      );
      
      if (response && response.orderId) {
        return {
          orderId: response.orderId,
          symbol,
          price,
          quantity,
          executedQty: parseFloat(response.executedQty || '0'),
          remainingQty: quantity - parseFloat(response.executedQty || '0'),
          side: side.toUpperCase() as 'BUY' | 'SELL',
          status: response.status || 'NEW',
          type: 'LIMIT',
          time: response.transactTime || Date.now(),
          updateTime: response.transactTime || Date.now()
        };
      }
      
      throw new Error(`Failed to place order: ${JSON.stringify(response)}`);
    } catch (error) {
      this.logger.error(`Failed to place ${side} limit order at ${price}: ${error}`);
      throw error;
    }
  }

  /**
   * Cancels an open order
   */
  async cancelOrder(orderId: string, symbol: string): Promise<MEXCOrder> {
    try {
      this.logger.info(`Cancelling order ID: ${orderId} for ${symbol}`);
      
      const response = await this.makeRequest<MEXCSpotOrderResponse>(
        '/api/v3/order',
        'DELETE',
        {
          symbol,
          orderId
        },
        true
      );
      
      if (response && response.orderId) {
        return {
          orderId: response.orderId,
          symbol,
          price: parseFloat(response.price || '0'),
          quantity: parseFloat(response.origQty || '0'),
          executedQty: parseFloat(response.executedQty || '0'),
          remainingQty: parseFloat(response.origQty || '0') - parseFloat(response.executedQty || '0'),
          side: response.side,
          status: 'CANCELED',
          type: response.type || 'LIMIT',
          time: response.time || Date.now(),
          updateTime: response.updateTime || Date.now()
        };
      }
      
      throw new Error(`Failed to cancel order: ${JSON.stringify(response)}`);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}: ${error}`);
      throw error;
    }
  }

  /**
   * Cancels all open orders for a given symbol
   */
  async cancelAllOrders(symbol: string): Promise<MEXCOrder[]> {
    try {
      this.logger.info(`Cancelling all orders for ${symbol}`);
      
      const response = await this.makeRequest<MEXCSpotOrderResponse[]>(
        '/api/v3/openOrders',
        'DELETE',
        {
          symbol
        },
        true
      );
      
      if (response && Array.isArray(response)) {
        return response.map((order) => ({
          orderId: order.orderId,
          symbol: order.symbol,
          price: parseFloat(order.price || '0'),
          quantity: parseFloat(order.origQty || '0'),
          executedQty: parseFloat(order.executedQty || '0'),
          remainingQty: parseFloat(order.origQty || '0') - parseFloat(order.executedQty || '0'),
          side: order.side,
          status: 'CANCELED',
          type: order.type || 'LIMIT',
          time: order.time || Date.now(),
          updateTime: order.updateTime || Date.now()
        }));
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Failed to cancel all orders: ${error}`);
      return [];
    }
  }

  /**
   * Gets current position for a symbol
   * Note: For spot, 'position' generally means account balance
   */
  async getPosition(symbol: string): Promise<MEXCPosition | null> {
    try {
      this.logger.info(`Fetching account balances for ${symbol}`);
      
      const response = await this.makeRequest<MEXCSpotAccountResponse>(
        '/api/v3/account',
        'GET',
        {},
        true
      );
      
      if (response && response.balances) {
        // Extract base and quote asset from symbol (like BTCUSDT → BTC and USDT)
        const instrument = await this.getInstrument(symbol);
        if (!instrument) {
          this.logger.warn(`Could not find instrument info for ${symbol}`);
          return null;
        }
        
        const baseAsset = instrument.baseCoin;
        const quoteAsset = instrument.quoteCoin;
        
        // Find balances
        const baseBalance = response.balances.find((b) => b.asset === baseAsset);
        const quoteBalance = response.balances.find((b) => b.asset === quoteAsset);
        
        if (baseBalance && quoteBalance) {
          // Get latest price
          const tickerResponse = await this.makeRequest<{ price: string }>(
            '/api/v3/ticker/price',
            'GET',
            { symbol },
            false
          );
          
          const lastPrice = parseFloat(tickerResponse?.price || '0');
          const baseAssetBalance = parseFloat(baseBalance.free);
          
          // Construct a position-like object
          return {
            symbol,
            positionValue: baseAssetBalance * lastPrice,
            unrealisedPnl: 0, // Not directly available in spot
            unRealizedProfit: 0, // Same as unrealisedPnl but required by the type
            leverage: 1, // Spot trading is always 1x
            markPrice: lastPrice,
            positionAmt: baseAssetBalance,
            entryPrice: 0, // Not tracked in spot trading
            baseAssetBalance: baseAssetBalance,
            quoteAssetBalance: parseFloat(quoteBalance.free),
            liquidationPrice: 0, // No liquidation in spot
            marginType: 'cross', // Default value
            positionSide: 'BOTH' // Default value
          };
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch position for ${symbol}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch historical trades
   */
  async getHistoricalTrades(symbol: string, lookbackMinutes: number = 120, maxResults: number = 1000): Promise<any[]> {
    try {
      this.logger.info(`Fetching historical trades for ${symbol}`);
      
      // Calculate timestamp for lookback period
      const lookbackTime = new Date();
      lookbackTime.setMinutes(lookbackTime.getMinutes() - lookbackMinutes);
      const startTime = lookbackTime.getTime();
      
      interface MEXCSpotTradeResponse {
        id: number;
        price: string;
        qty: string;
        time: number;
        isBuyerMaker: boolean;
        symbol: string;
      }
      
      const response = await this.makeRequest<MEXCSpotTradeResponse[]>(
        '/api/v3/trades',
        'GET',
        { symbol, limit: maxResults },
        false
      );
      
      if (response && Array.isArray(response)) {
        // Filter by time
        const filteredTrades = response.filter((trade) => 
          trade.time >= startTime
        );
        
        // Convert to a common format
        const formattedTrades = filteredTrades.map((trade) => ({
          price: parseFloat(trade.price),
          size: parseFloat(trade.qty),
          side: trade.isBuyerMaker ? 'sell' : 'buy', // If buyer is maker, it's a sell from market perspective
          symbol: trade.symbol,
          timestamp: trade.time,
          id: trade.id.toString()
        }));
        
        this.logger.success(`Fetched ${formattedTrades.length} historical trades for ${symbol}`);
        
        // Sort by timestamp (oldest first)
        return formattedTrades.sort((a, b) => a.timestamp - b.timestamp);
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch historical trades: ${error}`);
      return [];
    }
  }
  
  /**
   * Get recently filled orders
   */
  async getRecentFilledOrders(symbol: string): Promise<MEXCOrder[]> {
    try {
      this.logger.info(`Fetching recent filled orders for ${symbol}`);
      
      const response = await this.makeRequest<MEXCSpotOrderResponse[]>(
        '/api/v3/allOrders',
        'GET',
        {
          symbol,
          limit: 50 // Get last 50 orders
        },
        true
      );
      
      if (response && Array.isArray(response)) {
        // Filter filled orders
        const filledOrders = response
          .filter((order) => order.status === 'FILLED')
          .map((order) => ({
            orderId: order.orderId,
            symbol: order.symbol,
            price: parseFloat(order.price),
            quantity: parseFloat(order.origQty),
            executedQty: parseFloat(order.executedQty),
            remainingQty: 0, // Filled orders have no remaining quantity
            side: order.side,
            status: order.status,
            type: order.type,
            time: order.time,
            updateTime: order.updateTime
          }));
        
        this.logger.debug(`Retrieved ${filledOrders.length} recently filled orders for ${symbol}`);
        return filledOrders;
      }
      
      return [];
    } catch (error) {
      this.logger.error(`Failed to get recent filled orders: ${error}`);
      return [];
    }
  }
} 