// BitMEX WebSocket API URL
export const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

// Market making parameters
export const ORDER_COUNT = 10 // Number of orders on each side
export const ORDER_DISTANCE = 100 // Distance between each order in USD
export const ORDER_SIZE = 0.005 // Size of each order in BTC (for FFWCSX instruments like XBTUSD, this will be converted to contracts)

// Safety measures
export const MAX_POSITION_SIZE_BTC = 0.1 // Maximum allowed position size in BTC
export const MAX_OPEN_ORDERS = 40 // Maximum number of open orders allowed
export const DEAD_MAN_SWITCH_INTERVAL = 1000 * 60 * 1 // Reset dead man's switch every minute
export const DEAD_MAN_SWITCH_TIMEOUT = 1000 * 60 * 2 // Cancel all orders after 2 minutes of inactivity

// ATR parameters for dynamic grid sizing
export const ATR_PERIOD = 14 // Period for ATR calculation
export const ATR_MULTIPLIER = 1.5 // Multiplier for ATR to determine grid spacing
export const ATR_MINIMUM_GRID_DISTANCE = 50 // Minimum grid distance in USD
export const ATR_MAXIMUM_GRID_DISTANCE = 250 // Maximum grid distance in USD
export const ATR_RECALCULATION_INTERVAL =  1000 * 60 * 15 // Recalculate ATR
export const ATR_HISTORICAL_TRADES_LOOKBACK = 60 // How many minutes to look back for historical trades

// Trend analyzer parameters
export const TREND_RSI_PERIOD = 14 // RSI period for trend detection
export const TREND_FAST_EMA_PERIOD = 8 // Fast EMA period for trend detection
export const TREND_SLOW_EMA_PERIOD = 21 // Slow EMA period for trend detection
export const TREND_RSI_OVERBOUGHT = 70 // RSI overbought threshold 
export const TREND_RSI_OVERSOLD = 30 // RSI oversold threshold
export const TREND_MAX_ASYMMETRY = 1.5 // Maximum grid spacing multiplier in trend direction
export const TREND_MIN_ASYMMETRY = 0.75 // Minimum grid spacing multiplier against trend

// Sync interval for checking order statuses (in milliseconds)
export const ORDER_SYNC_INTERVAL = 60000 // 60 seconds

// Trading fee rate (in percentage)
export const FEE_RATE = 0.0500 // 0.0500% of trade value

// Prevent placing orders too close to each other
export const ENFORCE_ORDER_DISTANCE = false

// Order ID counter
let orderIdCounter = 1

// Function to get and increment the order ID
export const getNextOrderId = (): number => {
  return orderIdCounter++
} 