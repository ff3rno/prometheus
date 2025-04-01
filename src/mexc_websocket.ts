import WS from 'ws';
import { LiveOrderManager } from './live_order_manager';
import { StatsLogger } from './logger';
import { MEXCTrade } from './types';
import * as crypto from 'crypto';
import axios from 'axios';

// WebSocket connection states
enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING'
}

// MEXC WebSocket URL for spot market
const MEXC_WS_URL = 'wss://wbs.mexc.com/ws';
const MEXC_API_URL = 'https://api.mexc.com';

export class MEXCWebSocket {
  private ws!: WS;
  private orderManager: LiveOrderManager;
  private logger: StatsLogger;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 100;
  private initialReconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private reconnecting: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private lastCloseCode: number = 0;
  private lastCloseReason: string = '';
  private apiKey: string;
  private apiSecret: string;
  private symbol: string;
  private listenKey: string = '';
  private listenKeyKeepAliveInterval: NodeJS.Timeout | null = null;

  constructor(
    orderManager: LiveOrderManager,
    logger: StatsLogger,
    apiKey: string,
    apiSecret: string,
    symbol: string
  ) {
    this.orderManager = orderManager;
    this.logger = logger;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.symbol = symbol;
    this.logStatusChange(ConnectionState.DISCONNECTED, 'Initializing MEXC WebSocket client');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this.apiKey && this.apiSecret) {
      try {
        // Get a listen key for user data stream
        await this.getListenKey();
        this.connect();
      } catch (error) {
        this.logger.error(`Failed to get listen key: ${error}`);
        // Connect anyway for public streams
        this.connect();
      }
    } else {
      // Connect for public streams only
      this.connect();
    }
  }

  /**
   * Request a listen key from MEXC API for user data stream
   */
  private async getListenKey(): Promise<void> {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      
      // Generate signature
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(queryString)
        .digest('hex');
      
      // Make POST request to get listen key
      const response = await axios({
        method: 'POST',
        url: `${MEXC_API_URL}/api/v3/userDataStream`,
        headers: {
          'X-MEXC-APIKEY': this.apiKey,
          'Content-Type': 'application/json'
        },
        params: {
          timestamp,
          signature
        }
      });
      
      if (response.data && response.data.listenKey) {
        this.listenKey = response.data.listenKey;
        this.logger.success(`Obtained listen key for user data stream: ${this.listenKey.substring(0, 10)}...`);
        
        // Set up interval to keep the listen key alive
        this.startListenKeyKeepAlive();
      } else {
        throw new Error('No listen key received');
      }
    } catch (error) {
      this.logger.error(`Failed to get listen key: ${error}`);
      throw error;
    }
  }

  /**
   * Keep the listen key alive with periodic PUT requests
   */
  private startListenKeyKeepAlive(): void {
    // Clear any existing interval
    if (this.listenKeyKeepAliveInterval) {
      clearInterval(this.listenKeyKeepAliveInterval);
    }
    
    // Ping every 30 minutes to keep the listen key alive
    this.listenKeyKeepAliveInterval = setInterval(async () => {
      try {
        const timestamp = Date.now();
        const queryString = `listenKey=${this.listenKey}&timestamp=${timestamp}`;
        
        // Generate signature
        const signature = crypto
          .createHmac('sha256', this.apiSecret)
          .update(queryString)
          .digest('hex');
        
        // Extend listen key validity
        await axios({
          method: 'PUT',
          url: `${MEXC_API_URL}/api/v3/userDataStream`,
          headers: {
            'X-MEXC-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
          },
          params: {
            listenKey: this.listenKey,
            timestamp,
            signature
          }
        });
        
        this.logger.debug('Successfully extended listen key validity');
      } catch (error) {
        this.logger.error(`Failed to extend listen key: ${error}`);
        // Try to get a new listen key
        try {
          await this.getListenKey();
          this.logger.info('Successfully obtained new listen key after failure to extend');
        } catch (error) {
          this.logger.error(`Failed to get new listen key: ${error}`);
        }
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  private connect(): void {
    this.logStatusChange(ConnectionState.CONNECTING, 'Establishing MEXC WebSocket connection');
    this.ws = new WS(MEXC_WS_URL);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('error', this.onError.bind(this));
    this.ws.on('close', this.onClose.bind(this));
  }

  private logStatusChange(newState: ConnectionState, message: string): void {
    const prevState = this.connectionState;
    this.connectionState = newState;
    
    if (prevState !== newState) {
      this.logger.star(`MEXC Connection status: ${prevState} -> ${newState} | ${message}`);
    } else {
      this.logger.info(`MEXC Connection status: ${newState} | ${message}`);
    }
  }

  private onOpen(): void {
    this.logStatusChange(ConnectionState.CONNECTED, 'MEXC WebSocket connection established successfully');
    
    // Reset reconnection counter on successful connection
    this.reconnectAttempts = 0;
    this.reconnecting = false;
    
    // Subscribe to market trade data for the specified symbol
    const publicTradesSubscription = {
      method: 'SUBSCRIPTION',
      params: [`spot@public.aggre.deals.v3.api.pb@100ms@${this.symbol}`]
    };
    
    this.ws.send(JSON.stringify(publicTradesSubscription));
    this.logger.success(`Subscribed to ${this.symbol} trade data on MEXC spot market`);
    
    // If we have a listen key, subscribe to user data stream
    if (this.listenKey) {
      const userDataSubscription = {
        method: 'SUBSCRIPTION',
        params: [`spot@private.orders.v3.api@${this.symbol}`],
        listenKey: this.listenKey
      };
      
      this.ws.send(JSON.stringify(userDataSubscription));
      this.logger.info(`Subscribed to user data stream for ${this.symbol} using listen key`);
    }
  }

  private onMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle ping messages to keep connection alive
      if (message.ping) {
        const pongMessage = { pong: message.ping };
        this.ws.send(JSON.stringify(pongMessage));
        return;
      }
      
      // Handle trade data
      if (message.d && message.c === `spot@public.deals.v3.api@${this.symbol}`) {
        if (message.d && Array.isArray(message.d)) {
          const trades = message.d;
          
          // Process each trade
          trades.forEach((trade: any) => {
            const mexcTrade: MEXCTrade = {
              price: parseFloat(trade.p),
              size: parseFloat(trade.v),
              side: trade.S.toLowerCase(),
              symbol: this.symbol,
              timestamp: parseInt(trade.t),
              id: trade.i
            };
            
            this.orderManager.processTrade(mexcTrade);
          });
        }
      }
      // Handle order execution updates
      else if (message.c && message.c === `spot@private.orders.v3.api@${this.symbol}`) {
        if (message.d) {
          const order = message.d;
          
          if (order.status === 'FILLED') {
            this.logger.star(`Order executed: ${order.orderId} - ${order.side} ${order.executedQty} @ ${order.price}`);
            
            // Handle order fill in the order manager
            this.orderManager.handleOrderFill(
              order.orderId,
              parseFloat(order.price),
              order.side.toLowerCase(),
              parseFloat(order.executedQty)
            );
          } else if (order.status === 'CANCELED') {
            this.logger.warn(`Order ${order.orderId} was cancelled`);
          }
        }
      }
      // Handle subscription confirmation
      else if (message.code === 0 && message.msg && message.msg.includes('Subscribed successfully')) {
        this.logger.success(`MEXC WebSocket subscription confirmed: ${message.msg}`);
      }
      // Handle subscription errors
      else if (message.code === 0 && message.msg && message.msg.includes('Not Subscribed successfully')) {
        this.logger.error(`MEXC WebSocket subscription failed: ${message.msg}`);
      }
      else {
        // For debugging, log other messages
        this.logger.debug(`MEXC WebSocket message: ${JSON.stringify(message).substring(0, 200)}...`);
      }
    } catch (error) {
      this.logger.error(`Error processing MEXC WebSocket message: ${error}`);
    }
  }

  private onError(error: Error): void {
    this.logger.error(`MEXC WebSocket error: ${error.message}`);
    this.logger.warn('Connection may close due to error (awaiting close event)');
  }

  private onClose(code: number, reason: string): void {
    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    
    let closeType = 'Unexpected';
    if (code === 1000) {
      closeType = 'Normal';
    } else if (code >= 1001 && code <= 1015) {
      closeType = 'Protocol';
    } else if (code >= 4000) {
      closeType = 'Application';
    }
    
    this.logStatusChange(
      ConnectionState.DISCONNECTED, 
      `${closeType} disconnection (Code: ${code}, Reason: ${reason || 'No reason provided'})`
    );
    
    // Don't attempt to reconnect if we're deliberately closing the connection
    if (this.reconnecting) {
      this.logger.info('Not attempting to reconnect as connection was deliberately closed');
      return;
    }
    
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    // Calculate exponential backoff delay with jitter
    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    
    this.reconnectAttempts++;
    this.reconnecting = true;
    
    this.logStatusChange(
      ConnectionState.RECONNECTING,
      `Scheduling reconnection in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );
    
    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    // Schedule reconnection
    this.reconnectTimeout = setTimeout(() => {
      this.logger.info(`Initiating reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      // Close the existing connection if it's still somehow open
      if (this.ws.readyState === WS.OPEN) {
        this.logger.warn('Existing connection still open, closing before reconnect');
        this.ws.close();
      }
      
      // Attempt to reconnect
      this.initialize();
    }, delay);
  }

  public getConnectionState(): string {
    return this.connectionState;
  }

  public getLastDisconnectInfo(): {code: number, reason: string} {
    return {
      code: this.lastCloseCode,
      reason: this.lastCloseReason
    };
  }

  public close(): void {
    this.logStatusChange(ConnectionState.DISCONNECTED, 'Deliberately closing MEXC WebSocket connection');
    
    // Clear any pending reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Clear listen key keep-alive interval
    if (this.listenKeyKeepAliveInterval) {
      clearInterval(this.listenKeyKeepAliveInterval);
      this.listenKeyKeepAliveInterval = null;
    }
    
    // Try to delete the listen key if we have one
    if (this.listenKey && this.apiKey && this.apiSecret) {
      try {
        const timestamp = Date.now();
        const queryString = `listenKey=${this.listenKey}&timestamp=${timestamp}`;
        const signature = crypto
          .createHmac('sha256', this.apiSecret)
          .update(queryString)
          .digest('hex');
        
        axios({
          method: 'DELETE',
          url: `${MEXC_API_URL}/api/v3/userDataStream`,
          headers: {
            'X-MEXC-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
          },
          params: {
            listenKey: this.listenKey,
            timestamp,
            signature
          }
        }).catch(error => {
          this.logger.warn(`Failed to delete listen key: ${error}`);
        });
      } catch (error) {
        this.logger.warn(`Error while attempting to delete listen key: ${error}`);
      }
    }
    
    // Set flag to prevent reconnection attempts
    this.reconnecting = true;
    
    // Close the connection
    this.ws.close();
  }
} 