// BitMEX WebSocket API URL
export const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

export const DEFAULT_SYMBOL = 'XBTUSD'

export const MAX_ORDER_SIZE_CONTRACTS = 300 // Maximum order size in contracts allowed to be sent to BitMEX

// Market making parameters
export const MARKET_MAKING = {
  ORDER_COUNT: 3, // Number of orders on each side
  ORDER_DISTANCE: 70, // Distance between each order in USD (must be positive and appropriate for the instrument price range)
  ORDER_SIZE: 0.002, // Size of each order in BTC (for FFWCSX instruments like XBTUSD, this will be converted to contracts using price)
  BREAKEVEN_GRID_ENABLED: true, // Enable grid spacing based on fee calculation for breakeven trading
  POSITION_ROE_CLOSE_THRESHOLD: 0.02 // Maximum unrealised ROE to close a position
}

// Safety measures
export const SAFETY = {
  MAX_POSITION_SIZE_BTC: 0.008, // Maximum allowed position size in BTC
  MAX_OPEN_ORDERS: 8 // Maximum number of open orders allowed
}

// ATR parameters for dynamic grid sizing
export const ATR_CONFIG = {
  PERIOD: 14, // Period for ATR calculation
  MULTIPLIER: 1.5, // Multiplier for ATR to determine grid spacing
  MINIMUM_GRID_DISTANCE: 70, // Minimum grid distance in USD (increased for safety)
  MAXIMUM_GRID_DISTANCE: 90, // Maximum grid distance in USD (increased for higher price volatility)
  GAP_DETECTION_TOLERANCE: 2.0, // Multiplier for grid distance to identify gaps (higher = less sensitive)
  RECALCULATION_INTERVAL: 1000 * 60 * 15, // Recalculate ATR
  HISTORICAL_TRADES_LOOKBACK: 90 // How many minutes to look back for historical trades
}

// Dynamic infinity grid parameters
export const INFINITY_GRID = {
  ENABLED: true, // Enable infinity grid features
  GRID_SHIFT_THRESHOLD: 0.2, // Shift grid when price moves beyond this fraction of the grid range
  GRID_SHIFT_OVERLAP: 0.5, // Fraction of orders to keep when shifting the grid
  GRID_AUTO_SHIFT_CHECK_INTERVAL: 15000 // Check for grid shift every 15 seconds
}

// Variable order size parameters
export const VARIABLE_ORDER_SIZE = {
  ENABLED: false, // Enable variable order sizes
  BASE_ORDER_SIZE: MARKET_MAKING.ORDER_SIZE, // Base size for orders (same as ORDER_SIZE by default)
  MAX_ORDER_SIZE_MULTIPLIER: 1.8, // Maximum multiplier for order size (at lowest prices)
  MIN_ORDER_SIZE_MULTIPLIER: 0.8, // Minimum multiplier for order size (at highest prices)
  ORDER_SIZE_PRICE_RANGE_FACTOR: 1.0 // Price range factor for scaling order sizes
}

// Trend analyzer parameters
export const TREND_ANALYZER = {
  RSI_PERIOD: 14, // RSI period for trend detection
  FAST_EMA_PERIOD: 8, // Fast EMA period for trend detection
  SLOW_EMA_PERIOD: 21, // Slow EMA period for trend detection
  RSI_OVERBOUGHT: 70, // RSI overbought threshold 
  RSI_OVERSOLD: 30, // RSI oversold threshold
  MAX_ASYMMETRY: 1.5, // Maximum grid spacing multiplier in trend direction
  MIN_ASYMMETRY: 0.75 // Minimum grid spacing multiplier against trend
}

// Breakout trading parameters
export const BREAKOUT = {
  DETECTION_ENABLED: true, // Enable breakout detection and directional trading
  ATR_THRESHOLD: 1.8, // ATR multiplier threshold to consider a breakout (higher means stronger moves required)
  CANDLE_BODY_THRESHOLD: 0.7, // Minimum candle body to wick ratio to consider a strong breakout candle
  VOLUME_THRESHOLD: 1.5, // Minimum volume multiplier compared to average to confirm breakout
  PROFIT_TARGET_ATR_MULTIPLE: 2.0, // Take profit at this multiple of ATR from entry
  STOP_LOSS_ATR_MULTIPLE: 1.0, // Stop loss at this multiple of ATR from entry
  TIMEOUT_MINUTES: 60, // Maximum time to stay in breakout mode before reverting to grid trading
  POSITION_SIZE_MULTIPLIER: 2.0, // Multiplier for position size during breakout trades
  COOLDOWN_MINUTES: 60 // Minimum time between breakout trades
}

// Sync interval for checking order statuses (in milliseconds)
export const ORDER_SYNC_INTERVAL = 60000 // 60 seconds

// Trading fee rate (in percentage)
export const FEE_RATE = 0.0400 // 0.0400% of trade value

// Prevent placing orders too close to each other
export const ENFORCE_ORDER_DISTANCE = false

// Order ID counter
let orderIdCounter = 1

// Function to get and increment the order ID
export const getNextOrderId = (): number => {
  return orderIdCounter++
}

// Maintain backwards compatibility with existing code
export const ORDER_COUNT = MARKET_MAKING.ORDER_COUNT
export const ORDER_DISTANCE = MARKET_MAKING.ORDER_DISTANCE
export const ORDER_SIZE = MARKET_MAKING.ORDER_SIZE
export const BREAKEVEN_GRID_ENABLED = MARKET_MAKING.BREAKEVEN_GRID_ENABLED
export const POSITION_ROE_CLOSE_THRESHOLD = MARKET_MAKING.POSITION_ROE_CLOSE_THRESHOLD
export const MAX_POSITION_SIZE_BTC = SAFETY.MAX_POSITION_SIZE_BTC
export const MAX_OPEN_ORDERS = SAFETY.MAX_OPEN_ORDERS
export const ATR_PERIOD = ATR_CONFIG.PERIOD
export const ATR_MULTIPLIER = ATR_CONFIG.MULTIPLIER
export const ATR_MINIMUM_GRID_DISTANCE = ATR_CONFIG.MINIMUM_GRID_DISTANCE
export const ATR_MAXIMUM_GRID_DISTANCE = ATR_CONFIG.MAXIMUM_GRID_DISTANCE
export const GAP_DETECTION_TOLERANCE = ATR_CONFIG.GAP_DETECTION_TOLERANCE
export const ATR_RECALCULATION_INTERVAL = ATR_CONFIG.RECALCULATION_INTERVAL
export const ATR_HISTORICAL_TRADES_LOOKBACK = ATR_CONFIG.HISTORICAL_TRADES_LOOKBACK
export const INFINITY_GRID_ENABLED = INFINITY_GRID.ENABLED
export const GRID_SHIFT_THRESHOLD = INFINITY_GRID.GRID_SHIFT_THRESHOLD
export const GRID_SHIFT_OVERLAP = INFINITY_GRID.GRID_SHIFT_OVERLAP
export const GRID_AUTO_SHIFT_CHECK_INTERVAL = INFINITY_GRID.GRID_AUTO_SHIFT_CHECK_INTERVAL
export const VARIABLE_ORDER_SIZE_ENABLED = VARIABLE_ORDER_SIZE.ENABLED
export const BASE_ORDER_SIZE = VARIABLE_ORDER_SIZE.BASE_ORDER_SIZE
export const MAX_ORDER_SIZE_MULTIPLIER = VARIABLE_ORDER_SIZE.MAX_ORDER_SIZE_MULTIPLIER
export const MIN_ORDER_SIZE_MULTIPLIER = VARIABLE_ORDER_SIZE.MIN_ORDER_SIZE_MULTIPLIER
export const ORDER_SIZE_PRICE_RANGE_FACTOR = VARIABLE_ORDER_SIZE.ORDER_SIZE_PRICE_RANGE_FACTOR
export const TREND_RSI_PERIOD = TREND_ANALYZER.RSI_PERIOD
export const TREND_FAST_EMA_PERIOD = TREND_ANALYZER.FAST_EMA_PERIOD
export const TREND_SLOW_EMA_PERIOD = TREND_ANALYZER.SLOW_EMA_PERIOD
export const TREND_RSI_OVERBOUGHT = TREND_ANALYZER.RSI_OVERBOUGHT
export const TREND_RSI_OVERSOLD = TREND_ANALYZER.RSI_OVERSOLD
export const TREND_MAX_ASYMMETRY = TREND_ANALYZER.MAX_ASYMMETRY
export const TREND_MIN_ASYMMETRY = TREND_ANALYZER.MIN_ASYMMETRY
export const BREAKOUT_DETECTION_ENABLED = BREAKOUT.DETECTION_ENABLED
export const BREAKOUT_ATR_THRESHOLD = BREAKOUT.ATR_THRESHOLD
export const BREAKOUT_CANDLE_BODY_THRESHOLD = BREAKOUT.CANDLE_BODY_THRESHOLD
export const BREAKOUT_VOLUME_THRESHOLD = BREAKOUT.VOLUME_THRESHOLD
export const BREAKOUT_PROFIT_TARGET_ATR_MULTIPLE = BREAKOUT.PROFIT_TARGET_ATR_MULTIPLE
export const BREAKOUT_STOP_LOSS_ATR_MULTIPLE = BREAKOUT.STOP_LOSS_ATR_MULTIPLE
export const BREAKOUT_TIMEOUT_MINUTES = BREAKOUT.TIMEOUT_MINUTES
export const BREAKOUT_POSITION_SIZE_MULTIPLIER = BREAKOUT.POSITION_SIZE_MULTIPLIER
export const BREAKOUT_COOLDOWN_MINUTES = BREAKOUT.COOLDOWN_MINUTES 