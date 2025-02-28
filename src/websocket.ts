import WS from 'ws';
import { BITMEX_WS_API_URL } from './constants';
import { BitMEXTrade } from './types';
import { OrderManager } from './order_manager';
import { StatsLogger } from './logger';

// WebSocket connection states for better logging
enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING'
}

export class BitMEXWebSocket {
  private ws!: WS;
  private orderManager: OrderManager;
  private logger: StatsLogger;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 100; // Very high number for "indefinite" reconnection
  private initialReconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000; // Maximum delay between reconnection attempts
  private reconnecting: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private lastCloseCode: number = 0;
  private lastCloseReason: string = '';

  constructor(orderManager: OrderManager, logger: StatsLogger) {
    this.orderManager = orderManager;
    this.logger = logger;
    this.logStatusChange(ConnectionState.DISCONNECTED, 'Initializing WebSocket client');
    this.connect();
  }

  private connect(): void {
    this.logStatusChange(ConnectionState.CONNECTING, 'Establishing WebSocket connection');
    this.ws = new WS(BITMEX_WS_API_URL);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('error', this.onError.bind(this));
    this.ws.on('close', this.onClose.bind(this));
    
    // Log readyState changes for more detailed connection tracking
    const originalReadyState = this.ws.readyState;
    const readyStateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    
    // Monitor readyState changes
    const checkReadyState = () => {
      const currentReadyState = this.ws.readyState;
      if (currentReadyState !== originalReadyState) {
        this.logger.debug(
          `WebSocket readyState changed: ${readyStateNames[originalReadyState]} -> ${readyStateNames[currentReadyState]}`
        );
      }
    };
    
    // Periodically check for readyState changes (every 5 seconds)
    const intervalId = setInterval(checkReadyState, 5000);
    
    // Clear interval when the connection is closed
    this.ws.on('close', () => {
      clearInterval(intervalId);
    });
  }

  private logStatusChange(newState: ConnectionState, message: string): void {
    const prevState = this.connectionState;
    this.connectionState = newState;
    
    if (prevState !== newState) {
      this.logger.star(`Connection status: ${prevState} -> ${newState} | ${message}`);
    } else {
      this.logger.info(`Connection status: ${newState} | ${message}`);
    }
  }

  private onOpen(): void {
    this.logStatusChange(ConnectionState.CONNECTED, 'WebSocket connection established successfully');
    
    // Reset reconnection counter on successful connection
    this.reconnectAttempts = 0;
    this.reconnecting = false;
    
    // Subscribe to XBT/USD trade data
    this.ws.send(JSON.stringify({
      op: 'subscribe',
      args: ['trade:XBTUSD']
    }));
    
    this.logger.success('Subscribed to XBTUSD trade data');
  }

  private onMessage(data: Buffer): void {
    const message = JSON.parse(data.toString());
    
    // Handle trade data
    if (message.table === 'trade' && message.data && message.data.length > 0) {
      const trades = message.data as BitMEXTrade[];
      
      // Process each trade in the message
      trades.forEach((trade: BitMEXTrade) => {
        this.orderManager.processTrade(trade);
      });
    } else {
      // If the message contains connection status information, log it appropriately
      if (message.info || message.success) {
        const statusMsg = message.info || message.success;
        this.logger.info(`WebSocket status: ${statusMsg}`);
      } else if (message.error) {
        this.logger.error(`WebSocket error response: ${message.error}`);
      } else {
        this.logger.debug(data.toString());
      }
    }
  }

  private onError(error: Error): void {
    this.logger.error(`WebSocket error: ${error.message}`);
    this.logger.warn('Connection may close due to error (awaiting close event)');
    // We don't need to manually close or reconnect here as the 'close' event will be triggered after an error
  }

  private onClose(code: number, reason: string): void {
    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    
    let closeType = 'Unexpected';
    // Categorize the close reason
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
      this.connect();
    }, delay);
  }

  // Public method to get current connection state
  public getConnectionState(): string {
    return this.connectionState;
  }

  // Public method to get last disconnect information
  public getLastDisconnectInfo(): {code: number, reason: string} {
    return {
      code: this.lastCloseCode,
      reason: this.lastCloseReason
    };
  }

  // Method to properly close the connection (for intentional shutdowns)
  public close(): void {
    this.logStatusChange(ConnectionState.DISCONNECTED, 'Deliberately closing WebSocket connection');
    
    // Clear any pending reconnect attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Set flag to prevent reconnection attempts
    this.reconnecting = true;
    
    // Close the connection
    this.ws.close();
  }
} 