// BitMEX WebSocket API URL
export const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

// Market making parameters
export const ORDER_COUNT = 10 // Number of orders on each side
export const ORDER_DISTANCE = 50 // Distance between each order in USD
export const ORDER_SIZE = 0.004 // Size of each order in BTC (for FFWCSX instruments like XBTUSD, this will be converted to contracts)

// Sync interval for checking order statuses (in milliseconds)
export const ORDER_SYNC_INTERVAL = 10000 // 10 seconds

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