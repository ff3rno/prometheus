import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { URL } from 'url';
import { Order, BitMEXOrder, BitMEXPosition, BitMEXInstrument } from './types';
import { StatsLogger } from './logger';

export class BitMEXAPI {
  private apiKey: string;
  private apiSecret: string;
  private logger: StatsLogger;
  private testnet: boolean;
  private baseUrl: string;
  private instrumentCache: Map<string, BitMEXInstrument> = new Map();

  constructor(apiKey: string, apiSecret: string, logger: StatsLogger, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.logger = logger;
    this.testnet = testnet;
    this.baseUrl = testnet ? 'https://testnet.bitmex.com' : 'https://www.bitmex.com';
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
   * Makes a request to the BitMEX API
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
    
    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
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
   * Places a limit order on BitMEX
   */
  async placeLimitOrder(side: 'Buy' | 'Sell', price: number, quantity: number, symbol: string = 'XBTUSD'): Promise<BitMEXOrder> {
    try {
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
} 