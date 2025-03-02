import { RSI, EMA, SMA } from 'bfx-hf-indicators';
import { Candle } from './types';
import { StatsLogger } from './logger';
import { 
  TREND_RSI_PERIOD, 
  TREND_FAST_EMA_PERIOD, 
  TREND_SLOW_EMA_PERIOD, 
  TREND_RSI_OVERBOUGHT, 
  TREND_RSI_OVERSOLD, 
  TREND_MAX_ASYMMETRY, 
  TREND_MIN_ASYMMETRY 
} from './constants';

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

export interface TrendAnalysis {
  direction: TrendDirection;
  strength: number; // 0 to 1, where 1 is strongest
  asymmetryFactor: number; // Factor to apply to grid spacing (> 1 for wider, < 1 for tighter)
}

export class TrendAnalyzer {
  private rsiInstance: any;
  private fastEMAInstance: any;
  private slowEMAInstance: any;
  private logger: StatsLogger;
  
  // Track historical values for debugging
  private lastRsiValue: number | null = null;
  private lastFastEMA: number | null = null;
  private lastSlowEMA: number | null = null;
  private valueChangeCount = 0;

  // Configuration from constants
  private rsiPeriod: number = TREND_RSI_PERIOD;
  private fastEMAPeriod: number = TREND_FAST_EMA_PERIOD;
  private slowEMAPeriod: number = TREND_SLOW_EMA_PERIOD;
  
  // Thresholds from constants
  private rsiOverbought: number = TREND_RSI_OVERBOUGHT;
  private rsiOversold: number = TREND_RSI_OVERSOLD;
  private strongTrendThreshold: number = 0.7;
  
  // Asymmetry configuration from constants
  private maxAsymmetryFactor: number = TREND_MAX_ASYMMETRY;
  private minAsymmetryFactor: number = TREND_MIN_ASYMMETRY;

  constructor(logger: StatsLogger) {
    this.logger = logger;
    
    // Initialize indicators
    this.rsiInstance = new RSI([this.rsiPeriod]);
    this.fastEMAInstance = new EMA([this.fastEMAPeriod]);
    this.slowEMAInstance = new EMA([this.slowEMAPeriod]);
    
    this.logger.info(`Trend analyzer initialized with RSI(${this.rsiPeriod}), EMA(${this.fastEMAPeriod}), EMA(${this.slowEMAPeriod})`);
    this.logger.debug(`Indicator constructor details: RSI=${typeof this.rsiInstance}, Fast EMA=${typeof this.fastEMAInstance}, Slow EMA=${typeof this.slowEMAInstance}`);
  }

  public reset(): void {
    this.rsiInstance.reset();
    this.fastEMAInstance.reset();
    this.slowEMAInstance.reset();
    this.lastRsiValue = null;
    this.lastFastEMA = null;
    this.lastSlowEMA = null;
    this.valueChangeCount = 0;
    this.logger.info('Trend analyzer indicators reset');
  }

  public update(candle: Candle): void {
    // Update all indicators with the latest price
    const closePrice = candle.close;
    
    this.rsiInstance.update(closePrice);
    this.fastEMAInstance.update(closePrice);
    this.slowEMAInstance.update(closePrice);
  }

  public addCandle(candle: Candle): void {
    // Add data to all indicators
    const closePrice = candle.close;
    
    this.logger.debug(`Adding candle to indicators: timestamp=${new Date(candle.timestamp).toISOString()}, close=${closePrice}`);
    
    this.rsiInstance.add(closePrice);
    this.fastEMAInstance.add(closePrice);
    this.slowEMAInstance.add(closePrice);
    
    // Check if values have changed
    const newRsi = this.rsiInstance.v();
    const newFastEMA = this.fastEMAInstance.v();
    const newSlowEMA = this.slowEMAInstance.v();
    
    // Track if values are changing
    let changed = false;
    
    if (newRsi !== null && this.lastRsiValue !== null && Math.abs(newRsi - this.lastRsiValue) > 0.0001) {
      changed = true;
    }
    
    if (newFastEMA !== null && this.lastFastEMA !== null && Math.abs(newFastEMA - this.lastFastEMA) > 0.0001) {
      changed = true;
    }
    
    if (newSlowEMA !== null && this.lastSlowEMA !== null && Math.abs(newSlowEMA - this.lastSlowEMA) > 0.0001) {
      changed = true;
    }
    
    if (changed) {
      this.valueChangeCount++;
    }
    
    this.lastRsiValue = newRsi;
    this.lastFastEMA = newFastEMA;
    this.lastSlowEMA = newSlowEMA;
  }

  public processCandleHistory(candles: Candle[]): void {
    this.reset();
    
    this.logger.info(`Processing ${candles.length} candles to initialize trend indicators`);
    
    // Validate candle data before processing
    if (candles.length === 0) {
      this.logger.warn('No candles provided for trend analysis');
      return;
    }
    
    // Check for price variation in candles
    const prices = candles.map(c => c.close);
    const uniquePrices = new Set(prices);
    
    if (uniquePrices.size === 1) {
      this.logger.warn(`All ${candles.length} candles have the same closing price (${prices[0]}). This will not produce meaningful trend analysis.`);
    } else {
      this.logger.info(`Candles have ${uniquePrices.size} unique closing prices, which should allow for trend detection`);
    }
    
    // Process each candle to build up indicator state
    for (const candle of candles) {
      this.addCandle(candle);
    }
    
    // Check if indicators are ready
    const rsiValue = this.rsiInstance.v();
    const fastEMA = this.fastEMAInstance.v();
    const slowEMA = this.slowEMAInstance.v();
    
    this.logger.info(`Indicator status after processing candles: RSI=${rsiValue !== null ? rsiValue.toFixed(2) : 'null'}, fastEMA=${fastEMA !== null ? fastEMA.toFixed(2) : 'null'}, slowEMA=${slowEMA !== null ? slowEMA.toFixed(2) : 'null'}`);
    this.logger.debug(`Values changed ${this.valueChangeCount} times during processing`);
    
    // Log the current trend after processing
    const trend = this.analyzeTrend();
    this.logger.info(`Initial trend analysis: ${trend.direction} (strength: ${trend.strength.toFixed(2)}, asymmetry: ${trend.asymmetryFactor.toFixed(2)})`);
  }

  public analyzeTrend(): TrendAnalysis {
    // Get current indicator values
    const rsiValue = this.rsiInstance.v();
    const fastEMA = this.fastEMAInstance.v();
    const slowEMA = this.slowEMAInstance.v();
    
    // Log the actual values
    this.logger.debug(`Analyzing trend with values: RSI=${rsiValue !== null ? rsiValue.toFixed(2) : 'null'}, fastEMA=${fastEMA !== null ? fastEMA.toFixed(2) : 'null'}, slowEMA=${slowEMA !== null ? slowEMA.toFixed(2) : 'null'}`);
    
    // If indicators aren't ready yet, return neutral
    if (rsiValue === null || fastEMA === null || slowEMA === null) {
      this.logger.warn(`Indicators not ready: RSI=${rsiValue}, fastEMA=${fastEMA}, slowEMA=${slowEMA}`);
      return {
        direction: 'neutral',
        strength: 0,
        asymmetryFactor: 1.0
      };
    }

    // Determine trend direction
    let direction: TrendDirection = 'neutral';
    
    // EMA crossover for primary trend direction
    if (fastEMA > slowEMA) {
      direction = 'bullish';
      this.logger.debug(`EMA crossover indicates bullish trend: fastEMA(${this.fastEMAPeriod})=${fastEMA.toFixed(2)} > slowEMA(${this.slowEMAPeriod})=${slowEMA.toFixed(2)}`);
    } else if (fastEMA < slowEMA) {
      direction = 'bearish';
      this.logger.debug(`EMA crossover indicates bearish trend: fastEMA(${this.fastEMAPeriod})=${fastEMA.toFixed(2)} < slowEMA(${this.slowEMAPeriod})=${slowEMA.toFixed(2)}`);
    } else {
      this.logger.debug(`EMA values equal, no clear trend: fastEMA=${fastEMA.toFixed(2)}, slowEMA=${slowEMA.toFixed(2)}`);
    }
    
    // RSI can override or strengthen the signal
    if (rsiValue >= this.rsiOverbought) {
      // Overbought - bearish pressure
      const oldDirection = direction;
      direction = direction === 'bullish' ? 'neutral' : 'bearish';
      this.logger.debug(`RSI overbought (${rsiValue.toFixed(2)} >= ${this.rsiOverbought}): changed direction from ${oldDirection} to ${direction}`);
    } else if (rsiValue <= this.rsiOversold) {
      // Oversold - bullish pressure
      const oldDirection = direction;
      direction = direction === 'bearish' ? 'neutral' : 'bullish';
      this.logger.debug(`RSI oversold (${rsiValue.toFixed(2)} <= ${this.rsiOversold}): changed direction from ${oldDirection} to ${direction}`);
    } else {
      this.logger.debug(`RSI in neutral zone (${rsiValue.toFixed(2)}): not modifying trend direction`);
    }

    // Calculate trend strength (0 to 1)
    let strength = 0;
    
    // EMA distance factor (normalized)
    const emaDifference = Math.abs(fastEMA - slowEMA) / ((fastEMA + slowEMA) / 2);
    const emaStrength = Math.min(emaDifference * 10, 1); // Scale up and cap at 1
    this.logger.debug(`EMA strength calculation: difference=${emaDifference.toFixed(4)}, strength=${emaStrength.toFixed(2)}`);
    
    // RSI extremity factor
    let rsiStrength = 0;
    if (rsiValue >= this.rsiOverbought) {
      rsiStrength = Math.min((rsiValue - this.rsiOverbought) / (100 - this.rsiOverbought), 1);
      this.logger.debug(`RSI overbought strength: ${rsiStrength.toFixed(2)} based on value ${rsiValue.toFixed(2)}`);
    } else if (rsiValue <= this.rsiOversold) {
      rsiStrength = Math.min((this.rsiOversold - rsiValue) / this.rsiOversold, 1);
      this.logger.debug(`RSI oversold strength: ${rsiStrength.toFixed(2)} based on value ${rsiValue.toFixed(2)}`);
    } else {
      // Neutral RSI area - lower strength
      rsiStrength = 0;
      this.logger.debug(`RSI in neutral zone: strength=0`);
    }
    
    // Combined strength (weighted)
    strength = (emaStrength * 0.7) + (rsiStrength * 0.3);
    this.logger.debug(`Combined trend strength: ${strength.toFixed(2)} (EMA: ${emaStrength.toFixed(2)} * 0.7, RSI: ${rsiStrength.toFixed(2)} * 0.3)`);
    
    // Calculate grid asymmetry factor based on trend
    let asymmetryFactor = 1.0; // Default is symmetric
    
    if (direction !== 'neutral') {
      // Strong trends get more asymmetric grids
      if (strength >= this.strongTrendThreshold) {
        // For strong trends, use maximum asymmetry
        if (direction === 'bullish') {
          // In strong bullish trend: wider above, tighter below
          asymmetryFactor = this.maxAsymmetryFactor;
          this.logger.debug(`Strong bullish trend: using maximum asymmetry factor ${asymmetryFactor}`);
        } else {
          // In strong bearish trend: wider below, tighter above
          asymmetryFactor = this.minAsymmetryFactor;
          this.logger.debug(`Strong bearish trend: using minimum asymmetry factor ${asymmetryFactor}`);
        }
      } else {
        // For weaker trends, scale the asymmetry factor based on strength
        const scaledFactor = 1.0 + ((strength / this.strongTrendThreshold) * (this.maxAsymmetryFactor - 1.0));
        asymmetryFactor = direction === 'bullish' ? scaledFactor : 1.0 / scaledFactor;
        this.logger.debug(`Scaled asymmetry factor for ${direction} trend: ${asymmetryFactor.toFixed(2)} (strength=${strength.toFixed(2)}, threshold=${this.strongTrendThreshold})`);
      }
    } else {
      this.logger.debug(`Neutral trend: using symmetric grid (factor=1.0)`);
    }

    this.logger.info(`Trend analysis result: ${direction} (strength: ${strength.toFixed(2)}, asymmetry: ${asymmetryFactor.toFixed(2)})`);
    
    return {
      direction,
      strength,
      asymmetryFactor
    };
  }

  /**
   * Initialize with test data to ensure indicators are working properly
   * This can be called when actual data might not be providing enough variation
   */
  public initializeWithTestData(): void {
    this.reset();
    
    this.logger.info('Initializing trend analyzer with test data to ensure proper operation');
    
    const basePriceLevel = 30000; // Starting price
    const testDataLength = Math.max(this.rsiPeriod, this.slowEMAPeriod) * 2; // Ensure enough data for all indicators
    
    // Create a sample of prices with some volatility and a clear trend
    // First part: downtrend, second part: uptrend
    const testPrices: number[] = [];
    
    // First half: downtrend
    for (let i = 0; i < testDataLength / 2; i++) {
      const trend = -100; // Downward trend
      const volatility = (Math.random() - 0.5) * 200; // Random noise
      const price = basePriceLevel + trend * (i / (testDataLength / 2)) + volatility;
      testPrices.push(price);
    }
    
    // Second half: uptrend
    for (let i = testDataLength / 2; i < testDataLength; i++) {
      const trend = 150; // Upward trend
      const volatility = (Math.random() - 0.5) * 200; // Random noise
      const price = (basePriceLevel - 100) + trend * ((i - testDataLength / 2) / (testDataLength / 2)) + volatility;
      testPrices.push(price);
    }
    
    // Create candles from test prices
    const testCandles: Candle[] = testPrices.map((price, index) => {
      return {
        timestamp: Date.now() - (testDataLength - index) * 60000, // 1 minute intervals
        open: price,
        high: price + Math.random() * 50,
        low: price - Math.random() * 50,
        close: price
      };
    });
    
    // Feed candles to indicators
    this.logger.info(`Processing ${testCandles.length} test candles with price range: ${testPrices[0].toFixed(2)} to ${testPrices[testPrices.length-1].toFixed(2)}`);
    
    for (const candle of testCandles) {
      this.addCandle(candle);
    }
    
    // Check if indicators are ready
    const rsiValue = this.rsiInstance.v();
    const fastEMA = this.fastEMAInstance.v();
    const slowEMA = this.slowEMAInstance.v();
    
    this.logger.info(`Indicator status after test data: RSI=${rsiValue !== null ? rsiValue.toFixed(2) : 'null'}, fastEMA=${fastEMA !== null ? fastEMA.toFixed(2) : 'null'}, slowEMA=${slowEMA !== null ? slowEMA.toFixed(2) : 'null'}`);
    this.logger.debug(`Values changed ${this.valueChangeCount} times during test data processing`);
    
    // Log the current trend after processing
    const trend = this.analyzeTrend();
    this.logger.info(`Test data trend analysis: ${trend.direction} (strength: ${trend.strength.toFixed(2)}, asymmetry: ${trend.asymmetryFactor.toFixed(2)})`);
  }
} 