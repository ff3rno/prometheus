// Types for volatility-based trading

export type VolatilityState = {
  isHighVolatility: boolean
  currentATR: number
  baselineATR: number
  volatilityRatio: number
  lastStateChangeTimestamp: number
  lastCheckTimestamp: number
  appliedOrderSizeMultiplier: number
  appliedGridSpacingMultiplier: number
  appliedPositionSizeMultiplier: number
}

export type VolatilityAnalysis = {
  isHighVolatility: boolean
  volatilityRatio: number
  currentATR: number
  baselineATR: number
  recommendations: {
    orderSizeMultiplier: number
    gridSpacingMultiplier: number
    positionSizeMultiplier: number
  }
}

export type VolatilityTradeResult = {
  entryTimestamp: number
  exitTimestamp: number
  duration: number
  averageVolatilityRatio: number
  trades: number
  profit: number
  totalVolume: number
} 