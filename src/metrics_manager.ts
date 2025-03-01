import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { StatsLogger } from './logger';

export interface MetricsConfig {
  host: string;
  token: string;
  database: string;
  enabled: boolean;
}

export class MetricsManager {
  private client: InfluxDBClient | null = null;
  private logger: StatsLogger;
  private config: MetricsConfig;
  private enabled: boolean = false;
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
    
    if (config.database) {
      this.database = config.database;
    }
    
    if (this.config.enabled && this.config.host) {
      try {
        this.client = new InfluxDBClient({
          host: this.config.host,
          token: this.config.token,
          database: this.database
        });
        this.enabled = true;
        this.logger.success(`InfluxDB metrics enabled: ${this.config.host} (${this.database})`);
      } catch (error) {
        this.logger.error(`Failed to initialize InfluxDB client: ${error}`);
      }
    } else {
      this.logger.warn('InfluxDB metrics disabled: Missing configuration');
    }
  }

  /**
   * Helper method to safely write data to InfluxDB
   */
  private writeData(lineProtocol: string, description: string): void {
    if (!this.client) return;
    
    this.client.write(lineProtocol)
      .then(() => this.logger.debug(`Metrics: Recorded ${description}`))
      .catch((err) => this.logger.error(`Failed to record ${description}: ${err}`));
  }

  /**
   * Record a completed round-trip trade with profit/loss
   */
  public recordTrade(netProfit: number, fees: number, volume: number, entryPrice: number, exitPrice: number): void {
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('trade')
        .setTag('instrument', this.tradingPair)
        .setTag('type', 'round_trip')
        .setField('profit', netProfit)
        .setField('fees', fees)
        .setField('volume', volume)
        .setField('entry_price', entryPrice)
        .setField('exit_price', exitPrice);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, `trade profit ${netProfit.toFixed(4)} USD`);
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for trade: ${error}`);
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
    if (!this.enabled || !this.client) return;

    try {
      const point = Point.measurement('grid_stats')
        .setTag('instrument', this.tradingPair)
        .setField('total_profit', totalProfit)
        .setField('total_orders', totalOrders)
        .setField('buy_orders', buyOrders)
        .setField('sell_orders', sellOrders)
        .setField('total_fees', totalFees);

      const lineProtocol = point.toLineProtocol();
      if (lineProtocol) {
        this.writeData(lineProtocol, 'grid stats snapshot');
      }
    } catch (error) {
      this.logger.error(`Error creating metrics for grid stats: ${error}`);
    }
  }

  /**
   * Close the InfluxDB client connection
   */
  public close(): void {
    if (this.client) {
      this.client.close();
      this.logger.info('InfluxDB metrics client closed');
    }
  }
} 