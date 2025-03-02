// Order interface
export interface Order {
  id: number
  price: number
  size: number
  contractQty?: number // Quantity in contracts (for FFWCSX instruments)
  side: 'buy' | 'sell'
  fee: number
  oppositeOrderPrice: number | null // Price where an opposite order would be placed if filled
  filled: boolean // Whether the order has been filled
  entryPrice?: number // Price at which the order entered the market (for tracking profit)
  bitmexOrderId?: string // BitMEX order ID for tracking real orders
  entryTimestamp?: number // When this order was created
  fillTimestamp?: number // When this order was filled
  isEntryOrder?: boolean // Whether this order is an entry (starting a new position)
  entryOrderId?: number // Reference to the entry order by ID (for exit orders)
  exitOrderId?: number // Reference to the exit order by ID (for entry orders)
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

// BitMEX instrument interface based on API documentation
export interface BitMEXInstrument {
  symbol: string
  rootSymbol: string
  state: string
  typ: string
  listing: string
  front: string
  expiry?: string
  settle?: string
  relistInterval?: string
  inverseLeg?: string
  sellLeg?: string
  buyLeg?: string
  optionStrikePcnt?: number
  optionStrikeRound?: number
  optionStrikePrice?: number
  optionMultiplier?: number
  positionCurrency?: string
  underlying?: string
  quoteCurrency?: string
  underlyingSymbol?: string
  reference?: string
  referenceSymbol?: string
  calcInterval?: string
  publishInterval?: string
  publishTime?: string
  maxOrderQty?: number
  maxPrice?: number
  lotSize: number
  tickSize: number
  multiplier?: number
  settlCurrency?: string
  underlyingToPositionMultiplier?: number
  quoteToSettleMultiplier?: number
  isQuanto?: boolean
  isInverse?: boolean
  initMargin?: number
  maintMargin?: number
  riskLimit?: number
  riskStep?: number
  limit?: number
  capped?: boolean
  taxed?: boolean
  deleverage?: boolean
  makerFee?: number
  takerFee?: number
  settlementFee?: number
  insuranceFee?: number
  fundingBaseSymbol?: string
  fundingQuoteSymbol?: string
  fundingPremiumSymbol?: string
  fundingTimestamp?: string
  fundingInterval?: string
  fundingRate?: number
  indicativeFundingRate?: number
  rebalanceTimestamp?: string
  rebalanceInterval?: string
  openingTimestamp?: string
  closingTimestamp?: string
  sessionInterval?: string
  prevClosePrice?: number
  limitDownPrice?: number
  limitUpPrice?: number
  bankruptLimitDownPrice?: number
  bankruptLimitUpPrice?: number
  prevTotalVolume?: number
  totalVolume?: number
  volume?: number
  volume24h?: number
  prevTotalTurnover?: number
  totalTurnover?: number
  turnover?: number
  turnover24h?: number
  homeNotional24h?: number
  foreignNotional24h?: number
  prevPrice24h?: number
  vwap?: number
  highPrice?: number
  lowPrice?: number
  lastPrice?: number
  lastPriceProtected?: number
  lastTickDirection?: string
  lastChangePcnt?: number
  bidPrice?: number
  midPrice?: number
  askPrice?: number
  impactBidPrice?: number
  impactMidPrice?: number
  impactAskPrice?: number
  hasLiquidity?: boolean
  openInterest?: number
  openValue?: number
  fairMethod?: string
  fairBasisRate?: number
  fairBasis?: number
  fairPrice?: number
  markMethod?: string
  markPrice?: number
  indicativeTaxRate?: number
  indicativeSettlePrice?: number
  optionUnderlyingPrice?: number
  settledPrice?: number
  timestamp?: string
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

// Candle data interface for technical indicators
export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

// Grid sizing configuration
export interface GridSizingConfig {
  useATR: boolean
  currentDistance: number
  lastATRValue: number
  lastRecalculation: number
  // Trend-based parameters for asymmetric grid spacing
  trendDirection?: 'bullish' | 'bearish' | 'neutral'
  trendStrength?: number
  asymmetryFactor?: number
  upwardGridSpacing?: number // Spacing for orders above current price
  downwardGridSpacing?: number // Spacing for orders below current price
} 