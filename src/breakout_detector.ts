import { StatsLogger } from './logger'
import { Candle } from './types/candle'
import { BreakoutDetectionResult, BreakoutDirection } from './types/breakout'
import {
  BREAKOUT_ATR_THRESHOLD,
  BREAKOUT_CANDLE_BODY_THRESHOLD,
  BREAKOUT_VOLUME_THRESHOLD
} from './constants'

export class BreakoutDetector {
  private readonly logger: StatsLogger
  private readonly volumeHistory: number[] = []
  private readonly volumeHistoryMaxSize = 20
  private lastAtrValue = 0

  constructor(logger: StatsLogger) {
    this.logger = logger
  }

  public updateAtrValue(atrValue: number): void {
    this.lastAtrValue = atrValue
  }

  public detectBreakout(candles: Candle[]): BreakoutDetectionResult {
    if (candles.length < 5) {
      return {
        detected: false,
        direction: null,
        strength: 0,
        candle: {
          open: 0,
          high: 0,
          close: 0,
          low: 0,
          volume: 0,
          timestamp: 0
        },
        atrValue: this.lastAtrValue
      }
    }

    const currentCandle = candles[candles.length - 1]
    const previousCandles = candles.slice(-6, -1)

    // Update volume history
    this.updateVolumeHistory(currentCandle.volume)

    // Calculate average volume excluding current candle
    const avgVolume = this.calculateAverageVolume()

    // Calculate body to wick ratio
    const bodySize = Math.abs(currentCandle.close - currentCandle.open)
    const wickSize = currentCandle.high - currentCandle.low - bodySize
    const bodyToWickRatio = wickSize > 0 ? bodySize / wickSize : bodySize

    // Determine candle direction
    const direction: BreakoutDirection = 
      currentCandle.close > currentCandle.open ? 'up' : 'down'

    // Calculate price range of previous candles to determine if we're breaking through
    const prevHigh = Math.max(...previousCandles.map(c => c.high))
    const prevLow = Math.min(...previousCandles.map(c => c.low))
    const prevRange = prevHigh - prevLow

    // Check if breaking through previous range
    const breakingThrough = direction === 'up' 
      ? currentCandle.close > prevHigh
      : currentCandle.close < prevLow

    // Calculate candle size relative to ATR
    const candleSizeToAtr = this.lastAtrValue > 0 
      ? bodySize / this.lastAtrValue 
      : 0

    // Calculate volume relative to average
    const volumeRatio = avgVolume > 0 
      ? currentCandle.volume / avgVolume 
      : 1

    // Overall strength metric
    const strength = candleSizeToAtr * bodyToWickRatio * volumeRatio * (breakingThrough ? 1.5 : 0.8)

    const isBreakout = 
      candleSizeToAtr >= BREAKOUT_ATR_THRESHOLD &&
      bodyToWickRatio >= BREAKOUT_CANDLE_BODY_THRESHOLD &&
      volumeRatio >= BREAKOUT_VOLUME_THRESHOLD &&
      breakingThrough

    if (isBreakout) {
      this.logger.star(`BREAKOUT DETECTED: ${direction.toUpperCase()} | Strength: ${strength.toFixed(2)} | ATR Ratio: ${candleSizeToAtr.toFixed(2)} | Body/Wick: ${bodyToWickRatio.toFixed(2)} | Vol Ratio: ${volumeRatio.toFixed(2)}`)
    }

    return {
      detected: isBreakout,
      direction,
      strength,
      candle: {
        open: currentCandle.open,
        high: currentCandle.high,
        close: currentCandle.close,
        low: currentCandle.low,
        volume: currentCandle.volume,
        timestamp: currentCandle.timestamp
      },
      atrValue: this.lastAtrValue
    }
  }

  private updateVolumeHistory(volume: number): void {
    this.volumeHistory.push(volume)
    if (this.volumeHistory.length > this.volumeHistoryMaxSize) {
      this.volumeHistory.shift()
    }
  }

  private calculateAverageVolume(): number {
    if (this.volumeHistory.length <= 1) {
      return this.volumeHistory[0] || 0
    }
    
    const sum = this.volumeHistory.slice(0, -1).reduce((a, b) => a + b, 0)
    return sum / (this.volumeHistory.length - 1)
  }
} 