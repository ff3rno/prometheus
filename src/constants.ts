// BitMEX WebSocket API URL
export const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'

// Market making parameters
export const ORDER_COUNT = 20 // Number of orders on each side
export const ORDER_DISTANCE = 150 // Distance between each order in USD
export const ORDER_SIZE = 0.003 // Size of each order in BTC

// Trading fee rate (in percentage)
export const FEE_RATE = 0.0500 // 0.0500% of trade value

// Order ID counter
let orderIdCounter = 1

// Function to get and increment the order ID
export const getNextOrderId = (): number => {
  return orderIdCounter++
} 