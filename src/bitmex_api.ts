import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { URL } from 'url';
import Bottleneck from 'bottleneck';
import { Order, BitMEXOrder, BitMEXPosition, BitMEXInstrument } from './types';
import { StatsLogger } from './logger';

export class BitMEXAPI {
  private apiKey: string;
  private apiSecret: string;
  private logger: StatsLogger;
  private testnet: boolean;
  private baseUrl: string;
  private instrumentCache: Map<string, BitMEXInstrument> = new Map();
  
  // Main limiter: 120 requests per minute (2 per second)
  private mainLimiter: Bottleneck;
  
  // Order-specific limiter: 10 requests per second
  private orderLimiter: Bottleneck;

  constructor(apiKey: string, apiSecret: string, logger: StatsLogger, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.logger = logger;
    this.testnet = testnet;
    this.baseUrl = testnet ? 'https://testnet.bitmex.com' : 'https://www.bitmex.com';
    
    // Initialize rate limiters
    this.mainLimiter = new Bottleneck({
      reservoir: 120, // 120 requests
      reservoirRefreshAmount: 120,
      reservoirRefreshInterval: 60 * 1000, // 1 minute
      maxConcurrent: 10, // Maximum concurrent requests
      minTime: 50 // Minimum time between requests (ms)
    });
    
    this.orderLimiter = new Bottleneck({
      reservoir: 10, // 10 requests
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 1000, // 1 second
      maxConcurrent: 5, // Maximum concurrent requests
      minTime: 100 // Minimum time between requests (ms)
    });
    
    // Set up limiter events for logging
    this.setupLimiterEvents();
  }

  /**
   * Set up event handlers for rate limiters
   */
  private setupLimiterEvents(): void {
    // Main limiter events
    this.mainLimiter.on('depleted', () => {
      this.logger.warn('Main rate limit reached - throttling requests');
    });
    
    this.mainLimiter.on('error', (error) => {
      this.logger.error(`Main limiter error: ${error}`);
    });
    
    // Order limiter events
    this.orderLimiter.on('depleted', () => {
      this.logger.warn('Order rate limit reached - throttling order requests');
    });
    
    this.orderLimiter.on('error', (error) => {
      this.logger.error(`Order limiter error: ${error}`);
    });
  }

  /**
   * Update rate limiters based on response headers
   */
  private updateRateLimits(headers: Record<string, any>): void {
    // Update main rate limiter based on headers
    if (headers['x-ratelimit-remaining'] && headers['x-ratelimit-limit']) {
      const remaining = parseInt(String(headers['x-ratelimit-remaining']), 10);
      const limit = parseInt(String(headers['x-ratelimit-limit']), 10);
      
      if (!isNaN(remaining) && !isNaN(limit)) {
        this.mainLimiter.updateSettings({ 
          reservoir: remaining,
          reservoirRefreshAmount: limit,
          reservoirRefreshInterval: 60 * 1000 // 1 minute
        });
      }
    }
    
    // Update order rate limiter based on headers
    if (headers['x-ratelimit-remaining-1s']) {
      const remaining1s = parseInt(String(headers['x-ratelimit-remaining-1s']), 10);
      
      if (!isNaN(remaining1s)) {
        this.orderLimiter.updateSettings({ 
          reservoir: remaining1s,
          reservoirRefreshAmount: 10,
          reservoirRefreshInterval: 1000 // 1 second
        });
      }
    }
    
    // Handle retry-after header for rate limiting
    if (headers['retry-after']) {
      const retryAfter = parseInt(String(headers['retry-after']), 10);
      if (!isNaN(retryAfter)) {
        this.logger.warn(`Rate limited - retry after ${retryAfter} seconds`);
      }
    }
  }

  /**
   * Generates the signature for BitMEX API authentication
   */
  private generateSignature(
    verb: string,
    path: string,
    expires: number,
    data: string = ''
  ): string {
    const message = verb + path + expires + data;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');
  }

  /**
   * Determines if a request should use the order-specific rate limiter
   */
  private isOrderEndpoint(endpoint: string, method: string): boolean {
    const orderEndpoints = [
      '/api/v1/order',
      '/api/v1/order/all',
      '/api/v1/position/isolate',
      '/api/v1/position/leverage',
      '/api/v1/position/transferMargin'
    ];
    
    // Check if the endpoint is in the list of order endpoints
    const isOrderPath = orderEndpoints.some(path => endpoint.startsWith(path));
    
    // For /api/v1/order, only POST, PUT, DELETE methods are limited
    if (endpoint.startsWith('/api/v1/order') && !endpoint.includes('/all')) {
      return ['POST', 'PUT', 'DELETE'].includes(method);
    }
    
    // For other order endpoints
    return isOrderPath;
  }

  /**
   * Makes a request to the BitMEX API with rate limiting
   */
  private async makeRequest(
    method: string,
    endpoint: string,
    data: Record<string, any> = {}
  ): Promise<any> {
    const url = new URL(endpoint, this.baseUrl);
    const path = url.pathname;
    
    // For GET requests, append query parameters to path
    const queryParams = method === 'GET' ? new URLSearchParams(data).toString() : '';
    const fullPath = queryParams ? `${path}?${queryParams}` : path;
    
    // Create expires and signature
    const expires = Math.round(Date.now() / 1000) + 60; // 1 minute in the future
    const signature = this.generateSignature(
      method,
      fullPath,
      expires,
      method === 'GET' ? '' : JSON.stringify(data)
    );
    
    // Set up request configuration
    const config: AxiosRequestConfig = {
      method,
      url: url.toString() + (queryParams && method === 'GET' ? `?${queryParams}` : ''),
      headers: {
        'Content-Type': 'application/json',
        'api-expires': expires.toString(),
        'api-key': this.apiKey,
        'api-signature': signature
      }
    };
    
    // Add request body for non-GET requests
    if (method !== 'GET' && Object.keys(data).length > 0) {
      config.data = data;
    }
    
    // Determine which limiter to use
    const isOrderRequest = this.isOrderEndpoint(endpoint, method);
    const limiter = isOrderRequest ? this.orderLimiter : this.mainLimiter;
    
    // Log which limiter we're using
    this.logger.debug(`Using ${isOrderRequest ? 'order' : 'main'} rate limiter for ${method} ${endpoint}`);
    
    try {
      // Schedule the request through the appropriate limiter
      const response = await limiter.schedule(() => axios(config));
      
      // Update rate limits based on response headers
      this.updateRateLimits(response.headers);
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // Handle rate limit errors (429)
        if (error.response.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          this.logger.error(`Rate limit exceeded (429). Retry after: ${retryAfter} seconds`);
          
          // Update rate limits based on response headers
          this.updateRateLimits(error.response.headers);
          
          // If retry-after header is present, wait and retry
          if (retryAfter) {
            const retryMs = parseInt(String(retryAfter), 10) * 1000;
            this.logger.info(`Waiting ${retryAfter} seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, retryMs));
            
            // Retry the request
            return this.makeRequest(method, endpoint, data);
          }
        }
        
        this.logger.error(`API Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else {
        this.logger.error(`API Error: ${error}`);
      }
      throw error;
    }
  }

  /**
   * Get instrument details from BitMEX
   */
  async getInstrument(symbol: string): Promise<BitMEXInstrument | null> {
    // Check cache first
    if (this.instrumentCache.has(symbol)) {
      return this.instrumentCache.get(symbol) || null;
    }
    
    try {
      this.logger.info(`Fetching instrument details for ${symbol}`);
      const queryParams = {
        symbol,
        // Only get the active instrument
        filter: JSON.stringify({ state: 'Open' })
      };
      
      const instruments = await this.makeRequest('GET', '/api/v1/instrument', queryParams);
      
      if (instruments && instruments.length > 0) {
        const instrument = instruments[0];
        // Cache the instrument details
        this.instrumentCache.set(symbol, instrument);
        this.logger.success(`Retrieved instrument details for ${symbol}: lotSize=${instrument.lotSize}, tickSize=${instrument.tickSize}, multiplier=${instrument.multiplier}`);
        return instrument;
      }
      
      this.logger.warn(`No instrument found for symbol: ${symbol}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch instrument details for ${symbol}: ${error}`);
      return null;
    }
  }
  
  /**
   * Get all active instruments
   */
  async getActiveInstruments(): Promise<BitMEXInstrument[]> {
    try {
      this.logger.info('Fetching all active instruments');
      const instruments = await this.makeRequest('GET', '/api/v1/instrument/active', {});
      
      if (instruments && instruments.length > 0) {
        // Cache all instruments
        instruments.forEach((instrument: BitMEXInstrument) => {
          this.instrumentCache.set(instrument.symbol, instrument);
        });
        
        this.logger.success(`Retrieved ${instruments.length} active instruments`);
        return instruments;
      }
      
      this.logger.warn('No active instruments found');
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch active instruments: ${error}`);
      return [];
    }
  }

  /**
   * Fetches open orders from the BitMEX API
   */
  async getOpenOrders(symbol: string = 'XBTUSD'): Promise<BitMEXOrder[]> {
    try {
      const queryParams = {
        symbol,
        filter: JSON.stringify({ open: true }),
        reverse: true
      };
      
      return await this.makeRequest('GET', '/api/v1/order', queryParams);
    } catch (error) {
      this.logger.error('Failed to fetch open orders');
      return [];
    }
  }

  /**
   * Rounds a quantity to be a multiple of the lot size for a given instrument
   */
  private roundToLotSize(quantity: number, lotSize: number): number {
    return Math.round(quantity / lotSize) * lotSize;
  }

  /**
   * Rounds a price to be a multiple of the tick size for a given instrument
   */
  private roundToTickSize(price: number, tickSize: number): number {
    const precision = this.getPrecisionFromTickSize(tickSize);
    const rounded = Math.round(price / tickSize) * tickSize;
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
   * Places a limit order on BitMEX
   */
  async placeLimitOrder(side: 'Buy' | 'Sell', price: number, quantity: number, symbol: string = 'XBTUSD'): Promise<BitMEXOrder> {
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
      
      // For FFWCSX instruments like XBTUSD, the quantity needs to be converted to contracts
      // rather than directly using BTC quantity
      let orderQty: number;
      
      // For XBTUSD and similar FFWCSX instruments, quantity needs to be converted to contracts
      // These instruments use fixed contract sizes
      if (symbol.includes('USD')) {
        // Convert BTC quantity to contract quantity
        // For XBTUSD, 1 contract = 1 USD, so multiply by price to get equivalent contracts
        orderQty = Math.round(quantity * price);
        this.logger.debug(`Converting ${quantity} BTC to ${orderQty} contracts at price $${price} for ${symbol}`);
      } else {
        // For other instruments, use the quantity directly
        orderQty = quantity;
      }
      
      // Ensure the order quantity is a multiple of the lot size
      const lotSize = instrument.lotSize;
      const roundedOrderQty = this.roundToLotSize(orderQty, lotSize);
      
      if (roundedOrderQty !== orderQty) {
        this.logger.warn(`Adjusted order quantity from ${orderQty} to ${roundedOrderQty} to comply with lot size ${lotSize}`);
        orderQty = roundedOrderQty;
      }
      
      // Make sure we're not sending a zero order
      if (orderQty === 0) {
        orderQty = lotSize; // Use minimum lot size
        this.logger.warn(`Order quantity would be zero after adjustment - using minimum lot size ${lotSize} instead`);
      }

      // Ensure the price is a multiple of the tick size
      const tickSize = instrument.tickSize;
      const roundedPrice = this.roundToTickSize(price, tickSize);
      
      if (roundedPrice !== price) {
        this.logger.warn(`Adjusted price from ${price} to ${roundedPrice} to comply with tick size ${tickSize}`);
        price = roundedPrice;
      }

      const orderData = {
        symbol,
        side,
        orderQty,
        price,
        ordType: 'Limit',
        execInst: 'ParticipateDoNotInitiate', // Only make, never take
      };

      this.logger.info(`Placing ${side} limit order: ${orderQty} contracts (${quantity} BTC) @ $${price} on ${symbol}`);
      return await this.makeRequest('POST', '/api/v1/order', orderData);
    } catch (error) {
      this.logger.error(`Failed to place ${side} limit order at ${price}`);
      throw error;
    }
  }

  /**
   * Cancels an open order
   */
  async cancelOrder(orderId: string): Promise<BitMEXOrder> {
    try {
      const data = {
        orderID: orderId
      };
      
      this.logger.info(`Cancelling order ID: ${orderId}`);
      return await this.makeRequest('DELETE', '/api/v1/order', data);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}`);
      throw error;
    }
  }

  /**
   * Cancels all open orders for a given symbol
   */
  async cancelAllOrders(symbol: string = 'XBTUSD'): Promise<BitMEXOrder[]> {
    try {
      const response = await this.makeRequest(
        'DELETE',
        '/api/v1/order/all',
        { symbol }
      );
      return response;
    } catch (error) {
      this.logger.error(`Failed to cancel all orders: ${error}`);
      throw error;
    }
  }

  /**
   * Get recently filled orders for the specified symbol
   */
  async getRecentFilledOrders(symbol: string = 'XBTUSD'): Promise<BitMEXOrder[]> {
    try {
      // Get recent orders with status 'Filled'
      const response = await this.makeRequest(
        'GET',
        '/api/v1/order',
        { 
          symbol,
          filter: JSON.stringify({
            ordStatus: 'Filled'
          }),
          count: 50, // Limit to 50 most recent orders
          reverse: true // Most recent first
        }
      );
      
      this.logger.debug(`Retrieved ${response.length} recently filled orders for ${symbol}`);
      return response;
    } catch (error) {
      this.logger.error(`Failed to get recent filled orders: ${error}`);
      throw error;
    }
  }

  /**
   * Gets current position for a symbol
   */
  async getPosition(symbol: string = 'XBTUSD'): Promise<BitMEXPosition | null> {
    try {
      const queryParams = {
        filter: JSON.stringify({ symbol })
      };
      
      const positions = await this.makeRequest('GET', '/api/v1/position', queryParams);
      return positions.length > 0 ? positions[0] : null;
    } catch (error) {
      this.logger.error(`Failed to fetch position for ${symbol}`);
      return null;
    }
  }

  /**
   * Fetch historical trades for ATR calculation
   * @param symbol The trading symbol
   * @param lookbackMinutes How many minutes to look back
   * @param maxResults Maximum number of trades to fetch
   */
  async getHistoricalTrades(symbol: string = 'XBTUSD', lookbackMinutes: number = 120, maxResults: number = 1000): Promise<any[]> {
    try {
      // Calculate timestamp for lookback period
      const lookbackTime = new Date();
      lookbackTime.setMinutes(lookbackTime.getMinutes() - lookbackMinutes);
      const startTime = lookbackTime.toISOString();
      
      this.logger.info(`Fetching historical trades for ${symbol} since ${startTime}`);
      
      let allTrades: any[] = [];
      let startIndex = 0;
      const maxResultsPerPage = 500; // BitMEX API max per request
      let hasMore = true;
      
      // Loop until we've fetched all trades or reached maxResults
      while (hasMore && allTrades.length < maxResults) {
        const response = await this.makeRequest('GET', '/api/v1/trade', {
          symbol: symbol,
          startTime: startTime,
          count: Math.min(maxResultsPerPage, maxResults - allTrades.length),
          start: startIndex,
          reverse: true // Newest first
        });
        
        if (!response || response.length === 0) {
          hasMore = false;
        } else {
          allTrades = allTrades.concat(response);
          startIndex += response.length;
          
          // If we got fewer results than the max, we've reached the end
          if (response.length < maxResultsPerPage) {
            hasMore = false;
          }
          
          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      
      this.logger.success(`Fetched ${allTrades.length} historical trades for ${symbol}`);
      
      // Sort by timestamp (oldest first for proper ATR calculation)
      return allTrades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (error) {
      this.logger.error(`Failed to fetch historical trades: ${error}`);
      throw error;
    }
  }

  /**
   * Places a stop limit order on BitMEX
   */
  async placeStopLimitOrder(
    side: 'Buy' | 'Sell', 
    stopPrice: number, 
    limitPrice: number, 
    quantity: number, 
    symbol: string = 'XBTUSD'
  ): Promise<BitMEXOrder> {
    try {
      // Validate prices are positive
      if (stopPrice <= 0 || limitPrice <= 0) {
        throw new Error(`Invalid prices: stop=${stopPrice}, limit=${limitPrice} - must be positive`);
      }
      
      // Fetch instrument details to get the lotSize and tickSize
      const instrument = await this.getInstrument(symbol);
      if (!instrument) {
        throw new Error(`Could not retrieve instrument details for ${symbol}`);
      }
      
      // For FFWCSX instruments like XBTUSD, the quantity needs to be converted to contracts
      let orderQty: number;
      
      // For XBTUSD and similar FFWCSX instruments, quantity needs to be converted to contracts
      if (symbol.includes('USD')) {
        // Convert BTC quantity to contract quantity (using limit price for calculation)
        orderQty = Math.round(quantity * limitPrice);
        this.logger.debug(`Converting ${quantity} BTC to ${orderQty} contracts at price $${limitPrice} for ${symbol}`);
      } else {
        // For other instruments, use the quantity directly
        orderQty = quantity;
      }
      
      // Ensure the order quantity is a multiple of the lot size
      const lotSize = instrument.lotSize;
      const roundedOrderQty = this.roundToLotSize(orderQty, lotSize);
      
      if (roundedOrderQty !== orderQty) {
        this.logger.warn(`Adjusted stop order quantity from ${orderQty} to ${roundedOrderQty} to comply with lot size ${lotSize}`);
        orderQty = roundedOrderQty;
      }
      
      // Make sure we're not sending a zero order
      if (orderQty === 0) {
        orderQty = lotSize; // Use minimum lot size
        this.logger.warn(`Stop order quantity would be zero after adjustment - using minimum lot size ${lotSize} instead`);
      }

      // Ensure the prices are multiples of the tick size
      const tickSize = instrument.tickSize;
      const roundedStopPrice = this.roundToTickSize(stopPrice, tickSize);
      const roundedLimitPrice = this.roundToTickSize(limitPrice, tickSize);
      
      if (roundedStopPrice !== stopPrice) {
        this.logger.warn(`Adjusted stop price from ${stopPrice} to ${roundedStopPrice} to comply with tick size ${tickSize}`);
        stopPrice = roundedStopPrice;
      }
      
      if (roundedLimitPrice !== limitPrice) {
        this.logger.warn(`Adjusted limit price from ${limitPrice} to ${roundedLimitPrice} to comply with tick size ${tickSize}`);
        limitPrice = roundedLimitPrice;
      }

      const orderData = {
        symbol,
        side,
        orderQty,
        stopPx: stopPrice,
        price: limitPrice,
        ordType: 'StopLimit',
        execInst: 'LastPrice', // Trigger based on last price
        timeInForce: 'GoodTillCancel'
      };

      this.logger.info(`Placing ${side} stop limit order: ${orderQty} contracts (${quantity} BTC) @ stop $${stopPrice}, limit $${limitPrice} on ${symbol}`);
      return await this.makeRequest('POST', '/api/v1/order', orderData);
    } catch (error) {
      this.logger.error(`Failed to place ${side} stop limit order at stop ${stopPrice}, limit ${limitPrice}`);
      throw error;
    }
  }
} 