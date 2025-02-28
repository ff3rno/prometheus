// Order interface
export interface Order {
  id: number
  price: number
  size: number
  side: 'buy' | 'sell'
  fee: number
  oppositeOrderPrice: number | null // Price where an opposite order would be placed if filled
  filled: boolean // Whether the order has been filled
  entryPrice?: number // Price at which the order entered the market (for tracking profit)
}

// Completed trade interface
export interface CompletedTrade {
  entryOrder: Order
  exitOrder: Order
  profit: number
  fees: number
}

// BitMEX trade message interface
export interface BitMEXTrade {
  price: number
  size: number
  side: string
  [key: string]: any
} 