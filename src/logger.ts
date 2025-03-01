import { Signale } from 'signale'

// Create a custom logger with stats
export class StatsLogger {
  private signale: Signale;
  private cumulativePnL: number = 0;
  private totalTrades: number = 0;
  private winningTrades: number = 0;
  private losingTrades: number = 0;
  private cumulativeFees: number = 0; // Track total fees paid
  private cumulativeVolume: number = 0; // Track total trading volume in BTC
  private activeOrders: number = 0; // Track active order count

  constructor(scope: string) {
    this.signale = new Signale({ scope: `prometheus:${scope}` });
  }

  private getStatsPrefix(): string {
    return `[$${this.cumulativePnL.toFixed(6)}|${this.totalTrades}|${this.activeOrders} ORDERS|FEES:$${this.cumulativeFees.toFixed(4)}|VOL:${this.cumulativeVolume.toFixed(4)}]`;
  }

  recordTrade(profit: number, fees: number = 0, volume: number = 0): void {
    this.cumulativePnL += profit;
    this.cumulativeFees += fees;
    this.cumulativeVolume += volume;
    this.totalTrades++;
    
    if (profit > 0) {
      this.winningTrades++;
    } else if (profit < 0) {
      this.losingTrades++;
    }
    // If profit is exactly 0, it's neither a win nor a loss
  }

  setStatus(status: string): void {
    this.signale.info(`Status changed to: ${status}`);
  }
  
  setActiveOrders(count: number): void {
    this.activeOrders = count;
  }

  info(message: string): void {
    this.signale.info(`${this.getStatsPrefix()} ${message}`);
  }

  success(message: string): void {
    this.signale.success(`${this.getStatsPrefix()} ${message}`);
  }

  error(message: string): void {
    this.signale.error(`${this.getStatsPrefix()} ${message}`);
  }

  debug(message: string): void {
    this.signale.debug(`${this.getStatsPrefix()} ${message}`);
  }

  star(message: string): void {
    this.signale.star(`${this.getStatsPrefix()} ${message}`);
  }
  
  warn(message: string): void {
    this.signale.warn(`${this.getStatsPrefix()} ${message}`);
  }
} 