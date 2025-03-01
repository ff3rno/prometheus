import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { URL } from 'url';
import { Order, BitMEXOrder, BitMEXPosition } from './types';
import { StatsLogger } from './logger';

export class BitMEXAPI {
  private apiKey: string;
  private apiSecret: string;
  private logger: StatsLogger;
  private testnet: boolean;
  private baseUrl: string;

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
      this.logger.info(`Making ${config.method} request to ${config.url} with data: ${JSON.stringify(config.data)}`);
      const response = await axios(config);
      this.logger.debug(`Response received: ${JSON.stringify(response.data)}`);
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
   * Places a limit order on BitMEX
   */
  async placeLimitOrder(side: 'Buy' | 'Sell', price: number, quantity: number, symbol: string = 'XBTUSD'): Promise<BitMEXOrder> {
    try {
      const orderData = {
        symbol,
        side,
        orderQty: quantity,
        price,
        ordType: 'Limit',
        execInst: 'ParticipateDoNotInitiate', // Only make, never take
      };

      this.logger.info(`Placing ${side} limit order: ${quantity} @ $${price} on ${symbol}`);
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
      const data = {
        symbol
      };
      
      this.logger.info(`Cancelling all open orders for ${symbol}`);
      return await this.makeRequest('DELETE', '/api/v1/order/all', data);
    } catch (error) {
      this.logger.error(`Failed to cancel all orders for ${symbol}`);
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