import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { StatsLogger } from './logger';

export interface MetricsConfig {
  host: string;
  organization?: string;
  port?: number;
  token: string;
  database: string;
  enabled: boolean;
  debug?: boolean;
}

export class MetricsManager {
  private client: InfluxDBClient | null = null;
  private logger: StatsLogger;
  private config: MetricsConfig;
  private enabled: boolean = false;
  private debug: boolean = false;
  private tradingPair: string;
  private database: string = 'prometheus_grid';

  constructor(
    logger: StatsLogger,
    config: MetricsConfig,
    tradingPair: string = 'XBTUSD'
  ) {
    this.logger = logger;
    this.config = config;
    this.tradingPair = tradingPair;
    this.debug = !!config.debug;
    
    if (config.database) {
      this.database = config.database;
    }
    
    if (this.debug) {
      this.logger.info('InfluxDB metrics debug mode enabled - verbose logging will be used');
    }
    
    if (this.config.enabled && this.config.host) {
      try {
        this.logger.info(`Initializing InfluxDB client: ${this.config.host} (${this.database})`);
        
        this.client = new InfluxDBClient({
          host: this.config.host,
          token: this.config.token,
          database: this.database
        });
        
        this.enabled = true;
        
        // Verify connection with a test write
        const testPoint = Point.measurement('system')
          .setTag('component', 'prometheus')
          .setTag('status', 'startup')
          .setField('value', 1)
          .setTimestamp(new Date());
          
        const testLineProtocol = testPoint.toLineProtocol();
        if (testLineProtocol) {
          this.client.write(testLineProtocol)
            .then(() => {
              this.logger.success(`InfluxDB connection verified: ${this.config.host} (${this.database})`);
            })
            .catch((err) => {
              this.enabled = false;
              this.logger.error(`InfluxDB connection test failed: ${err}`);
            });
        }
        
        // Start heartbeat to maintain connection
        this.startHeartbeat();
      } catch (error) {
        this.enabled = false;
        this.logger.error(`Failed to initialize InfluxDB client: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.logger.warn(`InfluxDB metrics disabled: enabled=${this.config.enabled}, host=${this.config.host || 'missing'}`);
    }
  }

  /**
   * Helper method to safely write data to InfluxDB
   */
  private writeData(lineProtocol: string, description: string, retryCount: number = 0): void {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    
    if (!this.client) {
      this.logger.warn(`Metrics: Cannot record ${description} - InfluxDB client not initialized`);
      return;
    }
    
    if (this.debug) {
      this.logger.info(`Metrics data being sent to ${this.config.host}:`);
      this.logger.info(lineProtocol);
    }
    
    this.client.write(lineProtocol)
      .then(() => {
        if (this.debug) {
          this.logger.info(`Metrics: Successfully recorded ${description}`);
        } else {
          this.logger.debug(`Metrics: Recorded ${description}`);
        }
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        if (retryCount < MAX_RETRIES) {
          this.logger.warn(`Failed to record ${description} (attempt ${retryCount + 1}/${MAX_RETRIES + 1}): ${errorMessage}. Retrying in ${RETRY_DELAY_MS}ms...`);
          
          // Retry after delay
          setTimeout(() => {
            this.writeData(lineProtocol, description, retryCount + 1);
          }, RETRY_DELAY_MS);
        } else {
          this.logger.error(`Failed to record ${description} after ${MAX_RETRIES + 1} attempts: ${errorMessage}`);
        }
      });
  }

  /**
   * Record a completed round-trip trade with profit/loss
   */
  public recordTrade(netProfit: number, fees: number, volume: number, entryPrice: number, exitPrice: number): void {
    if (!this.enabled || !this.client) {
      this.logger.debug(`Metrics: Not recording trade - enabled: ${this.enabled}, client: ${!!this.client}`);
      return;
    }

    try {
      const point = Point.measurement('trade')
        .setTag('instrument', this.tradingPair)
        .setTag('type', 'round_trip')
        .setField('profit', netProfit)
        .setField('fees', fees)
        .setField('volume', volume)
        .setField('entry_price', entryPrice)
        .setField('exit_price', exitPrice)
        .setTimestamp(new Date());

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.logger.info(`Attempting to record trade metric: profit=${netProfit}, fees=${fees}, volume=${volume}`);
        this.writeData(lineProtocol, `trade profit ${netProfit.toFixed(4)} USD`);
      } else {
        this.logger.error('Failed to generate line protocol for trade metric');
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for trade: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record an order execution (fill)
   */
  public recordOrderExecution(orderId: number, side: string, price: number, size: number, fee: number): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('order')
        .setTag('instrument', this.tradingPair)
        .setTag('side', side)
        .setTag('order_id', orderId.toString())
        .setTag('action', 'execution')
        .setField('price', price)
        .setField('size', size)
        .setField('fee', fee)
        .setField('notional_value', price * size);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `${side} order execution @ ${price}`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for order: ${error}`);
    }
  }

  /**
   * Record order creation
   */
  public recordOrderCreation(orderId: number, side: string, price: number, size: number, oppositeOrderPrice: number | null = null): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('order')
        .setTag('instrument', this.tradingPair)
        .setTag('side', side)
        .setTag('order_id', orderId.toString())
        .setTag('action', 'creation')
        .setField('price', price)
        .setField('size', size)
        .setField('notional_value', price * size);
      
      if (oppositeOrderPrice !== null) {
        point.setField('opposite_price', oppositeOrderPrice);
      }

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `${side} order creation @ ${price}`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for order creation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record order cancellation
   */
  public recordOrderCancellation(orderId: number, side: string, price: number, size: number, reason: string): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('order')
        .setTag('instrument', this.tradingPair)
        .setTag('side', side)
        .setTag('order_id', orderId.toString())
        .setTag('action', 'cancellation')
        .setTag('reason', reason)
        .setField('price', price)
        .setField('size', size)
        .setField('notional_value', price * size);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `${side} order cancellation @ ${price}`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for order cancellation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record trading volume
   */
  public recordVolume(volume: number, notionalValue: number, side: string): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('volume')
        .setTag('instrument', this.tradingPair)
        .setTag('side', side)
        .setField('size', volume)
        .setField('notional_value', notionalValue);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `volume ${volume.toFixed(8)} (${notionalValue.toFixed(2)} USD)`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for volume: ${error}`);
    }
  }

  /**
   * Record grid statistics
   */
  public recordGridStats(totalProfit: number, totalOrders: number, buyOrders: number, sellOrders: number, totalFees: number): void {
    if (!this.enabled || !this.client) {
      this.logger.debug(`Metrics: Not recording grid stats - enabled: ${this.enabled}, client: ${!!this.client}`);
      return;
    }

    try {
      const point = Point.measurement('grid_stats')
        .setTag('instrument', this.tradingPair)
        .setField('total_profit', totalProfit)
        .setField('total_completed_orders', totalOrders)
        .setField('buy_entry_trades', buyOrders)
        .setField('sell_entry_trades', sellOrders)
        .setField('total_fees', totalFees);
        
      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, 'grid stats');
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for grid stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record order stats for monitoring
   */
  public recordOrderStats(
    activeOrders: number, 
    activeBuyOrders: number, 
    activeSellOrders: number, 
    createdOrders: number, 
    filledOrders: number, 
    cancelledOrders: number
  ): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('order_stats')
        .setTag('instrument', this.tradingPair)
        .setField('active_orders', activeOrders)
        .setField('active_buy_orders', activeBuyOrders)
        .setField('active_sell_orders', activeSellOrders)
        .setField('created_orders_count', createdOrders)
        .setField('filled_orders_count', filledOrders)
        .setField('cancelled_orders_count', cancelledOrders);
        
      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, 'order stats');
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for order stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record ATR value
   */
  public recordATR(atrValue: number): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('volatility')
        .setTag('instrument', this.tradingPair)
        .setTag('indicator', 'atr')
        .setField('value', atrValue);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `ATR value ${atrValue.toFixed(2)}`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for ATR: ${error}`);
    }
  }

  /**
   * Record grid distance
   */
  public recordGridDistance(distance: number): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('grid_config')
        .setTag('instrument', this.tradingPair)
        .setField('base_distance', distance);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `Grid distance ${distance}`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for grid distance: ${error}`);
    }
  }

  /**
   * Record trend metrics
   */
  public recordTrendMetrics(
    direction: string, 
    strength: number, 
    upwardSpacing: number, 
    downwardSpacing: number
  ): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('trend')
        .setTag('instrument', this.tradingPair)
        .setTag('direction', direction)
        .setField('strength', strength)
        .setField('upward_spacing', upwardSpacing)
        .setField('downward_spacing', downwardSpacing)
        .setField('asymmetry', upwardSpacing / downwardSpacing);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `Trend ${direction} (strength: ${strength.toFixed(2)})`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for trend: ${error}`);
    }
  }

  /**
   * Close the metrics client connection
   */
  public close(): void {
    if (!this.client) {
      this.logger.debug('InfluxDB metrics client already closed or not initialized');
      return;
    }
    
    try {
      // Record a shutdown metric
      const shutdownPoint = Point.measurement('system')
        .setTag('component', 'prometheus')
        .setTag('status', 'shutdown')
        .setField('value', 1);
        
      const shutdownLineProtocol = shutdownPoint.toLineProtocol();
      if (shutdownLineProtocol) {
        // Use direct promise for final writes to ensure they complete before closing
        this.client.write(shutdownLineProtocol)
          .then(() => {
            this.logger.debug('Final metrics recorded before shutdown');
            this.doClose();
          })
          .catch((err) => {
            this.logger.error(`Failed to record shutdown metrics: ${err instanceof Error ? err.message : String(err)}`);
            this.doClose();
          });
      } else {
        this.doClose();
      }
    } catch (error) {
      this.logger.error(`Error during metrics shutdown: ${error instanceof Error ? error.message : String(error)}`);
      this.doClose();
    }
  }
  
  /**
   * Actually close the client connection
   */
  private doClose(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.enabled = false;
      this.logger.info('InfluxDB metrics client closed');
    }
  }

  /**
   * Starts a heartbeat to periodically check the InfluxDB connection
   */
  private startHeartbeat(): void {
    const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
    
    setInterval(() => {
      if (!this.enabled || !this.client) return;
      
      try {
        const heartbeatPoint = Point.measurement('system')
          .setTag('component', 'prometheus')
          .setTag('status', 'alive')
          .setField('value', 1)
          .setTimestamp(new Date());
          
        const lineProtocol = heartbeatPoint.toLineProtocol();
        if (lineProtocol) {
          this.client.write(lineProtocol)
            .then(() => this.logger.debug('InfluxDB heartbeat successful'))
            .catch((err) => {
              this.logger.warn(`InfluxDB heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
              
              // Try to reinitialize connection
              this.reinitializeConnection();
            });
        }
      } catch (error) {
        this.logger.error(`Error in InfluxDB heartbeat: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
  
  /**
   * Attempts to reconnect to InfluxDB if the connection is lost
   */
  private reinitializeConnection(): void {
    if (!this.config.host) return;
    
    try {
      this.logger.info(`Attempting to reconnect to InfluxDB: ${this.config.host}`);
      
      this.client = new InfluxDBClient({
        host: this.config.host,
        token: this.config.token,
        database: this.database
      });
      
      this.enabled = true;
      
      // Test the new connection
      const testPoint = Point.measurement('system')
        .setTag('component', 'prometheus')
        .setTag('status', 'reconnect')
        .setField('value', 1)
        .setTimestamp(new Date());
        
      const testLineProtocol = testPoint.toLineProtocol();
      if (testLineProtocol) {
        this.client.write(testLineProtocol)
          .then(() => this.logger.success('InfluxDB reconnection successful'))
          .catch((err) => {
            this.enabled = false;
            this.logger.error(`InfluxDB reconnection failed: ${err instanceof Error ? err.message : String(err)}`);
          });
      }
    } catch (error) {
      this.enabled = false;
      this.logger.error(`Failed to reconnect to InfluxDB: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start periodic recording of grid stats
   */
  public startPeriodicGridStatsRecording(getStatsCallback: () => {
    totalProfit: number;
    totalOrders: number;
    buyOrders: number;
    sellOrders: number;
    totalFees: number;
  }): void {
    if (!this.enabled) {
      this.logger.debug('Periodic grid stats recording not started - metrics disabled');
      return;
    }
    
    const STATS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    
    this.logger.info(`Starting periodic grid stats recording (every ${STATS_INTERVAL_MS / 60000} minutes)`);
    
    setInterval(() => {
      if (!this.enabled || !this.client) return;
      
      try {
        const stats = getStatsCallback();
        this.recordGridStats(
          stats.totalProfit,
          stats.totalOrders,
          stats.buyOrders,
          stats.sellOrders,
          stats.totalFees
        );
      } catch (error) {
        this.logger.error(`Error in periodic grid stats recording: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, STATS_INTERVAL_MS);
  }

  /**
   * Get a template for an InfluxDB dashboard to visualize order metrics
   * This returns a string describing the recommended panels for a comprehensive order metrics dashboard.
   */
  public static getDashboardTemplate(): string {
    return `
# Order Metrics Dashboard Template

## Order Activity Panels

1. **Active Orders Count**
   - Measurement: order_stats
   - Fields: active_orders, active_buy_orders, active_sell_orders
   - Visualization: Line graph
   - Time Range: Last 24 hours

2. **Order Creation Rate**
   - Measurement: order_stats
   - Field: created_orders_count
   - Visualization: Rate graph (derivative)
   - Time Range: Last 24 hours

3. **Order Events**
   - Measurement: order
   - Filter by tag: action
   - Group by: action (creation, execution, cancellation)
   - Visualization: Stacked bar chart
   - Time Range: Last 24 hours

4. **Order Price Distribution**
   - Measurement: order
   - Field: price
   - Group by: side
   - Visualization: Scatter plot
   - Time Range: Last 24 hours

5. **Order Size Distribution**
   - Measurement: order
   - Field: size
   - Group by: side
   - Visualization: Heat map
   - Time Range: Last 24 hours

6. **Fees Paid**
   - Measurement: order
   - Field: fee
   - Group by: action
   - Visualization: Cumulative sum
   - Time Range: Last 24 hours

7. **Trading Volume**
   - Measurement: order
   - Field: notional_value
   - Group by: side
   - Visualization: Line graph
   - Time Range: Last 24 hours

## Grid Performance Panels

8. **Grid Profit**
   - Measurement: grid_stats
   - Field: total_profit
   - Visualization: Line graph
   - Time Range: Last 7 days

9. **Completed Trades**
   - Measurement: grid_stats
   - Fields: total_completed_orders, buy_entry_trades, sell_entry_trades
   - Visualization: Line graph
   - Time Range: Last 7 days

10. **Profit vs. Fees**
    - Measurement: grid_stats
    - Fields: total_profit, total_fees
    - Visualization: Line graph
    - Time Range: Last 7 days

## System Health Panels

11. **Heartbeat Status**
    - Measurement: system
    - Field: value
    - Filter by tag: status = 'alive'
    - Visualization: Status indicator
    - Time Range: Last 1 hour

12. **Grid Spacing**
    - Measurement: grid_distance
    - Field: distance
    - Visualization: Line graph
    - Time Range: Last 24 hours
`;
  }
} 