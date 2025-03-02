// BitMEX WebSocket API URL
export const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

// Market making parameters
export const ORDER_COUNT = 6 // Number of orders on each side
export const ORDER_DISTANCE = 100 // Distance between each order in USD
export const ORDER_SIZE = 0.007 // Size of each order in BTC (for FFWCSX instruments like XBTUSD, this will be converted to contracts)

// Safety measures
export const MAX_POSITION_SIZE_BTC = 0.08 // Maximum allowed position size in BTC
export const MAX_OPEN_ORDERS = 30 // Maximum number of open orders allowed

// ATR parameters for dynamic grid sizing
export const ATR_PERIOD = 14 // Period for ATR calculation
export const ATR_MULTIPLIER = 1.5 // Multiplier for ATR to determine grid spacing
export const ATR_MINIMUM_GRID_DISTANCE = 60 // Minimum grid distance in USD
export const ATR_MAXIMUM_GRID_DISTANCE = 225 // Maximum grid distance in USD
export const GAP_DETECTION_TOLERANCE = 2.0 // Multiplier for grid distance to identify gaps (higher = less sensitive)
export const ATR_RECALCULATION_INTERVAL =  1000 * 60 * 15 // Recalculate ATR
export const ATR_HISTORICAL_TRADES_LOOKBACK = 90 // How many minutes to look back for historical trades

// Dynamic infinity grid parameters
export const INFINITY_GRID_ENABLED = true // Enable infinity grid features
export const GRID_SHIFT_THRESHOLD = 0.1 // Shift grid when price moves beyond this fraction of the grid range
export const GRID_SHIFT_OVERLAP = 0.5 // Fraction of orders to keep when shifting the grid
export const GRID_AUTO_SHIFT_CHECK_INTERVAL = 30000 // Check for grid shift every 30 seconds

// Variable order size parameters
export const VARIABLE_ORDER_SIZE_ENABLED = true // Enable variable order sizes
export const BASE_ORDER_SIZE = ORDER_SIZE // Base size for orders (same as ORDER_SIZE by default)
export const MAX_ORDER_SIZE_MULTIPLIER = 3.0 // Maximum multiplier for order size (at lowest prices)
export const MIN_ORDER_SIZE_MULTIPLIER = 0.5 // Minimum multiplier for order size (at highest prices)
export const ORDER_SIZE_PRICE_RANGE_FACTOR = 2.0 // Price range factor for scaling order sizes

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