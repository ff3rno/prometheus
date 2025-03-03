export type BreakoutDirection = 'up' | 'down' | null

export type BreakoutState = {
  active: boolean
  direction: BreakoutDirection
  entryPrice: number
  profitTargetPrice: number
  stopLossPrice: number
  entryTimestamp: number
  timeoutTimestamp: number
  positionSize: number
  orderIds: string[]
  lastBreakoutEndTimestamp: number
}

export type BreakoutDetectionResult = {
  detected: boolean
  direction: BreakoutDirection
  strength: number
  candle: {
    open: number
    high: number
    close: number
    low: number
    volume: number
    timestamp: number
  }
  atrValue: number
}

export type BreakoutTradeResult = {
  direction: BreakoutDirection
  entryPrice: number
  exitPrice: number
  positionSize: number
  profit: number
  duration: number
  exitReason: 'take_profit' | 'stop_loss' | 'timeout' | 'manual'
} 