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
  bitmexOrderId?: string // BitMEX order ID for tracking real orders
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

// BitMEX order interface based on API documentation
export interface BitMEXOrder {
  orderID: string
  clOrdID?: string
  clOrdLinkID?: string
  account?: number
  symbol: string
  side: 'Buy' | 'Sell'
  simpleOrderQty?: number
  orderQty: number
  price: number
  displayQty?: number
  stopPx?: number
  pegOffsetValue?: number
  pegPriceType?: string
  currency?: string
  settlCurrency?: string
  ordType: string
  timeInForce?: string
  execInst?: string
  contingencyType?: string
  exDestination?: string
  ordStatus: string
  triggered?: string
  workingIndicator: boolean
  ordRejReason?: string
  simpleLeavesQty?: number
  leavesQty: number
  simpleCumQty?: number
  cumQty: number
  avgPx?: number
  multiLegReportingType?: string
  text?: string
  transactTime: string
  timestamp: string
  execType?: string
  execID?: string
  open: boolean
}

// BitMEX position interface based on API documentation
export interface BitMEXPosition {
  account: number
  symbol: string
  currency: string
  underlying?: string
  quoteCurrency?: string
  commission?: number
  initMarginReq?: number
  maintMarginReq?: number
  riskLimit?: number
  leverage: number
  crossMargin?: boolean
  deleveragePercentile?: number
  rebalancedPnl?: number
  prevRealisedPnl?: number
  prevUnrealisedPnl?: number
  prevClosePrice?: number
  openingTimestamp?: string
  openingQty?: number
  openingCost?: number
  openingComm?: number
  openOrderBuyQty?: number
  openOrderBuyCost?: number
  openOrderBuyPremium?: number
  openOrderSellQty?: number
  openOrderSellCost?: number
  openOrderSellPremium?: number
  execBuyQty?: number
  execBuyCost?: number
  execSellQty?: number
  execSellCost?: number
  execQty?: number
  execCost?: number
  execComm?: number
  currentTimestamp?: string
  currentQty: number
  currentCost?: number
  currentComm?: number
  realisedCost?: number
  unrealisedCost?: number
  grossOpenCost?: number
  grossOpenPremium?: number
  grossExecCost?: number
  isOpen: boolean
  markPrice?: number
  markValue?: number
  riskValue?: number
  homeNotional?: number
  foreignNotional?: number
  posState?: string
  posCost?: number
  posCost2?: number
  posCross?: number
  posInit?: number
  posComm?: number
  posLoss?: number
  posMargin?: number
  posMaint?: number
  posAllowance?: number
  taxableMargin?: number
  initMargin?: number
  maintMargin?: number
  sessionMargin?: number
  targetExcessMargin?: number
  varMargin?: number
  realisedGrossPnl?: number
  realisedTax?: number
  realisedPnl?: number
  unrealisedGrossPnl?: number
  longBankrupt?: number
  shortBankrupt?: number
  taxBase?: number
  indicativeTaxRate?: number
  indicativeTax?: number
  unrealisedTax?: number
  unrealisedPnl?: number
  unrealisedPnlPcnt?: number
  unrealisedRoePcnt?: number
  simpleQty?: number
  simpleCost?: number
  simpleValue?: number
  simplePnl?: number
  simplePnlPcnt?: number
  avgCostPrice?: number
  avgEntryPrice?: number
  breakEvenPrice?: number
  marginCallPrice?: number
  liquidationPrice?: number
  bankruptPrice?: number
  timestamp: string
  lastPrice?: number
  lastValue?: number
} 