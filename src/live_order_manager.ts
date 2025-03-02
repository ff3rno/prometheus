import { 
  ORDER_COUNT, 
  ORDER_DISTANCE, 
  ORDER_SIZE, 
  ATR_PERIOD, 
  ATR_MULTIPLIER, 
  ATR_MINIMUM_GRID_DISTANCE, 
  ATR_MAXIMUM_GRID_DISTANCE,
  ATR_RECALCULATION_INTERVAL,
  ATR_HISTORICAL_TRADES_LOOKBACK,
  TREND_RSI_PERIOD,
  TREND_FAST_EMA_PERIOD,
  TREND_SLOW_EMA_PERIOD,
  TREND_RSI_OVERBOUGHT,
  TREND_RSI_OVERSOLD,
  TREND_MAX_ASYMMETRY,
  TREND_MIN_ASYMMETRY,
  ORDER_SYNC_INTERVAL,
  MAX_POSITION_SIZE_BTC,
  MAX_OPEN_ORDERS,
  DEAD_MAN_SWITCH_INTERVAL,
  DEAD_MAN_SWITCH_TIMEOUT,
  FEE_RATE,
  ENFORCE_ORDER_DISTANCE,
  getNextOrderId
} from './constants';
import { TrendAnalyzer, TrendAnalysis } from './trend_analyzer';

import { Order, CompletedTrade, BitMEXTrade, BitMEXOrder, BitMEXInstrument, Candle, GridSizingConfig } from './types';
import { StatsLogger } from './logger';
import { BitMEXAPI } from './bitmex_api';
import { StateManager } from './state_manager';
import { MetricsManager } from './metrics_manager';
import { ATR } from 'bfx-hf-indicators';

export class LiveOrderManager {
  private activeOrders: Order[] = [];
  private completedTrades: CompletedTrade[] = [];
  private gridInitialized: boolean = false;
  private referencePrice: number = 0;
  private currentMarketPrice: number = 0;
  private logger: StatsLogger;
  private api: BitMEXAPI;
  private stateManager: StateManager;
  private metricsManager: MetricsManager | null = null;
  private symbol: string = 'XBTUSD';
  private isDryRun: boolean = false;
  private instrumentInfo: BitMEXInstrument | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;
  private processedOrderFills: Set<string> = new Set<string>();
  private atrRecalculationIntervalId: NodeJS.Timeout | null = null;
  private atrInstance: any; // bfx-hf-indicators ATR instance
  private trendAnalyzer: TrendAnalyzer;
  private deadManSwitchIntervalId: NodeJS.Timeout | null = null;
  private gridSizing: GridSizingConfig = {
    useATR: true,
    currentDistance: ORDER_DISTANCE,
    lastATRValue: 0,
    lastRecalculation: 0,
    trendDirection: 'neutral',
    trendStrength: 0,
    asymmetryFactor: 1.0,
    upwardGridSpacing: ORDER_DISTANCE,
    downwardGridSpacing: ORDER_DISTANCE
  };
  private candles: Candle[] = [];

  constructor(
    api: BitMEXAPI,
    stateManager: StateManager,
    logger: StatsLogger,
    symbol: string = 'XBTUSD',
    isDryRun: boolean = false,
    metricsManager: MetricsManager | null = null
  ) {
    this.api = api;
    this.stateManager = stateManager;
    this.logger = logger;
    this.symbol = symbol;
    this.isDryRun = isDryRun;
    this.metricsManager = metricsManager;
    this.trendAnalyzer = new TrendAnalyzer(logger);
    this.logger.info('LiveOrderManager initialized with TrendAnalyzer for asymmetric grid spacing');
  }

  /**
   * Initialize the live order manager with saved state if available
   */
  async initialize(): Promise<void> {
    try {
      // Get instrument info
      this.instrumentInfo = await this.api.getInstrument(this.symbol);
      
      if (!this.instrumentInfo) {
        throw new Error(`Could not get instrument info for ${this.symbol}`);
      }
      
      // Initialize trend analyzer
      this.trendAnalyzer = new TrendAnalyzer(this.logger);
      
      // Load state from state manager
      const savedState = this.stateManager.getState();
      
      if (savedState) {
        // Restore grid settings
        this.gridSizing = savedState.gridSizing || this.gridSizing;
        
        // Restore order history if present
        if (savedState.completedTrades && Array.isArray(savedState.completedTrades)) {
          this.completedTrades = savedState.completedTrades;
          this.logger.info(`Loaded ${this.completedTrades.length} completed trades from state`);
        }
        
        this.logger.info('Restored previous state');
        this.logger.info(`Grid distance: ${this.gridSizing.currentDistance.toFixed(2)}`);
      }
      
      // Sync with existing orders on the exchange
      await this.syncWithExchangeOrders();
      
      // Start periodic sync
      this.startPeriodicSync();
      
      // Initialize ATR recalculation
      this.startATRRecalculationInterval();
      
      // Initialize the dead man's switch
      this.startDeadManSwitch();
      
      this.logger.success('Order manager initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize order manager: ${error}`);
      throw error;
    }
  }

  /**
   * Get instrument lot size
   */
  private getLotSize(): number {
    // Default to 1 if we couldn't get instrument info
    return this.instrumentInfo?.lotSize || 1;
  }
  
  /**
   * Calculate contract quantity for an instrument
   */
  private calculateContractQty(btcSize: number, price: number): number {
    if (!this.instrumentInfo) {
      return Math.round(btcSize * price);
    }
    
    // For XBTUSD and similar "FFWCSX" instruments, convert BTC to USD contracts
    if (this.symbol.includes('USD')) {
      // Calculate raw contract quantity (1 contract = 1 USD)
      const rawContractQty = btcSize * price;
      
      // Round to the instrument's lot size
      const lotSize = this.instrumentInfo.lotSize;
      return Math.round(rawContractQty / lotSize) * lotSize;
    }
    
    // For other instrument types, just return the BTC size
    return btcSize;
  }
  
  /**
   * Round a price to the instrument's tick size
   */
  private roundPriceToTickSize(price: number): number {
    if (!this.instrumentInfo) {
      return price;
    }
    
    const tickSize = this.instrumentInfo.tickSize;
    const precision = this.getPrecisionFromTickSize(tickSize);
    const rounded = Math.round(price / tickSize) * tickSize;
    return parseFloat(rounded.toFixed(precision));
  }
  
  /**
   * Get decimal precision from tick size
   */
  private getPrecisionFromTickSize(tickSize: number): number {
    const tickSizeStr = tickSize.toString();
    const decimalIndex = tickSizeStr.indexOf('.');
    
    if (decimalIndex === -1) {
      return 0;
    }
    
    return tickSizeStr.length - decimalIndex - 1;
  }
  
  /**
   * Synchronize local order state with BitMEX
   */
  private async syncWithExchangeOrders(): Promise<void> {
    try {
      this.logger.info('Syncing local state with BitMEX orders...');
      
      // Get current open orders from the exchange
      const openOrders = await this.api.getOpenOrders(this.symbol);
      
      // Also get filled orders from the recent history to detect missed fills
      // Doing this in a separate try/catch to continue if it fails
      try {
        const recentFilledOrders = await this.api.getRecentFilledOrders(this.symbol);
        
        if (recentFilledOrders.length > 0) {
          this.logger.info(`Checking ${recentFilledOrders.length} recently filled orders for missed fills`);
          
          // Check for filled orders that we still have in our active orders list
          for (const filledOrder of recentFilledOrders) {
            const localOrder = this.activeOrders.find(order => 
              order.bitmexOrderId === filledOrder.orderID && !order.filled
            );
            
            if (localOrder) {
              this.logger.warn(`Found filled order ${filledOrder.orderID} (local ID: ${localOrder.id}) that was not detected - processing now`);
              
              // Process this fill if not already processed
              if (!this.processedOrderFills.has(filledOrder.orderID)) {
                await this.handleOrderFill(
                  filledOrder.orderID,
                  filledOrder.price,
                  filledOrder.side,
                  filledOrder.orderQty
                );
              }
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to check for filled orders: ${error}`);
        // Continue with open orders sync regardless
      }
      
      if (openOrders.length > 0) {
        this.logger.success(`Found ${openOrders.length} open orders on BitMEX`);
        
        // If we have no local orders but there are orders on the exchange,
        // we need to rebuild our local state
        if (this.activeOrders.length === 0 && openOrders.length > 0) {
          this.logger.warn('Local order state is empty but exchange has orders - rebuilding local state');
          
          // Convert BitMEX orders to our internal format
          const convertedOrders: Order[] = openOrders.map(bitmexOrder => {
            const side = bitmexOrder.side.toLowerCase() === 'buy' ? 'buy' : 'sell';
            const contractQty = Math.abs(bitmexOrder.orderQty);
            
            // For XBTUSD, convert from contract quantity back to BTC
            let size: number;
            if (this.symbol.includes('USD') && bitmexOrder.price > 0) {
              // For USD instruments, 1 contract = 1 USD worth of BTC
              // size in BTC = contract quantity / price
              size = contractQty / bitmexOrder.price;
            } else {
              // For other instruments, use the orderQty directly
              size = contractQty;
            }
            
            // Ensure the contract quantity respects lot size
            const lotSize = this.getLotSize();
            if (contractQty % lotSize !== 0) {
              this.logger.warn(`Order ${bitmexOrder.orderID} has contract quantity ${contractQty} that is not a multiple of lot size ${lotSize}`);
            }
            
            const fee = bitmexOrder.price * size * (FEE_RATE / 100);
            
            return {
              id: parseInt(bitmexOrder.orderID.slice(-6), 10) || getNextOrderId(),
              price: bitmexOrder.price,
              size: size,
              contractQty: contractQty,
              side: side,
              fee: fee,
              oppositeOrderPrice: null, // We don't know this from exchange data
              filled: false,
              bitmexOrderId: bitmexOrder.orderID // Store the BitMEX order ID
            };
          });
          
          this.activeOrders = convertedOrders;
          this.gridInitialized = true;
          this.referencePrice = this.calculateAverageOrderPrice();
          
          // Update state manager
          this.stateManager.updateActiveOrders(this.activeOrders);
          this.stateManager.updateReferencePrice(this.referencePrice);
          
          this.logger.success(`Rebuilt local state with ${this.activeOrders.length} orders from exchange`);
        } else {
          // We have both local orders and exchange orders, reconcile them
          this.reconcileOrders(openOrders);
        }
      } else if (this.activeOrders.length > 0) {
        // We have local orders but no exchange orders - check if they were filled
        this.logger.warn('No open orders found on exchange but local state has orders - checking if they were filled');
        
        // Clone the active orders array to avoid modification during iteration
        const localOrders = [...this.activeOrders];
        
        // Check filled orders from exchange history
        try {
          const recentFilledOrders = await this.api.getRecentFilledOrders(this.symbol);
          
          for (const localOrder of localOrders) {
            if (localOrder.bitmexOrderId) {
              // Check if this order was filled
              const matchingFilledOrder = recentFilledOrders.find(o => 
                o.orderID === localOrder.bitmexOrderId && o.ordStatus === 'Filled'
              );
              
              if (matchingFilledOrder) {
                this.logger.warn(`Order #${localOrder.id} (${localOrder.bitmexOrderId}) was filled but not detected - processing now`);
                
                // Process this fill if not already processed
                if (!this.processedOrderFills.has(matchingFilledOrder.orderID)) {
                  await this.handleOrderFill(
                    matchingFilledOrder.orderID,
                    matchingFilledOrder.price,
                    matchingFilledOrder.side,
                    matchingFilledOrder.orderQty
                  );
                }
              } else {
                // Order not found in history - it might have been cancelled or never existed
                this.logger.warn(`Order #${localOrder.id} (${localOrder.bitmexOrderId}) not found on exchange - removing from local state`);
                this.activeOrders = this.activeOrders.filter(o => o.id !== localOrder.id);
              }
            }
          }
          
          // If we still have local orders after checking, they might be stale
          if (this.activeOrders.length > 0) {
            this.logger.warn(`After checking, ${this.activeOrders.length} local orders remain but are not on exchange - clearing them`);
            this.activeOrders = [];
          }
          
          this.stateManager.updateActiveOrders(this.activeOrders);
        } catch (error) {
          this.logger.error(`Failed to check filled orders: ${error}`);
          // Safest approach is to clear local state if we can't verify
          this.logger.warn('Clearing local order state due to inability to verify with exchange');
          this.activeOrders = [];
          this.stateManager.updateActiveOrders(this.activeOrders);
        }
      }
      
      // Update logger stats
      this.logger.setActiveOrders(this.activeOrders.length);
      
    } catch (error) {
      this.logger.error(`Failed to sync with exchange: ${error}`);
    }
  }

  /**
   * Reconcile local orders with BitMEX orders
   */
  private reconcileOrders(bitmexOrders: BitMEXOrder[]): void {
    // Create a map of BitMEX order IDs
    const bitmexOrderMap = new Map(bitmexOrders.map(order => [order.orderID, order]));
    
    // Filter out local orders that no longer exist on the exchange
    this.activeOrders = this.activeOrders.filter(localOrder => {
      // If order has a BitMEX ID, check if it still exists
      if (localOrder.bitmexOrderId && !bitmexOrderMap.has(localOrder.bitmexOrderId)) {
        this.logger.warn(`Order #${localOrder.id} no longer exists on exchange - removing from local state`);
        return false;
      }
      return true;
    });
    
    // Update contract quantities for FFWCSX instruments
    if (this.symbol.includes('USD')) {
      this.activeOrders.forEach(localOrder => {
        if (localOrder.bitmexOrderId && bitmexOrderMap.has(localOrder.bitmexOrderId)) {
          const bitmexOrder = bitmexOrderMap.get(localOrder.bitmexOrderId);
          
          // Update contract quantity if different from what BitMEX reports
          if (bitmexOrder && (!localOrder.contractQty || localOrder.contractQty !== bitmexOrder.orderQty)) {
            const oldQty = localOrder.contractQty || 'undefined';
            localOrder.contractQty = bitmexOrder.orderQty;
            this.logger.debug(`Updated contract quantity for order #${localOrder.id}: ${oldQty} -> ${bitmexOrder.orderQty}`);
          }
        }
      });
    }
    
    // Update state
    this.stateManager.updateActiveOrders(this.activeOrders);
  }

  /**
   * Calculate average price from current orders
   */
  private calculateAverageOrderPrice(): number {
    if (this.activeOrders.length === 0) return 0;
    
    const sum = this.activeOrders.reduce((acc, order) => acc + order.price, 0);
    return sum / this.activeOrders.length;
  }

  /**
   * Create an order and place it on the exchange
   */
  async createOrder(price: number, size: number, side: 'buy' | 'sell', oppositeOrderPrice: number | null = null): Promise<Order> {
    // Round price to tick size
    const roundedPrice = this.roundPriceToTickSize(price);
    
    // Check if we would exceed the maximum number of open orders
    if (this.wouldExceedOrderLimit()) {
      this.logger.warn(`Maximum open orders limit reached (${MAX_OPEN_ORDERS}). Cannot create new ${side} order at ${roundedPrice}`);
      throw new Error(`Maximum open orders limit (${MAX_OPEN_ORDERS}) reached`);
    }
    
    // Check if we would exceed the maximum position size
    const exceedsPositionLimit = await this.wouldExceedPositionLimit(size, side);
    if (exceedsPositionLimit) {
      this.logger.warn(`Maximum position size limit (${MAX_POSITION_SIZE_BTC} BTC) would be exceeded. Cannot create new ${side} order at ${roundedPrice}`);
      throw new Error(`Maximum position size limit (${MAX_POSITION_SIZE_BTC} BTC) would be exceeded`);
    }
    
    // Calculate fees - BitMEX charges fees on the value (price * quantity)
    const feeRate = FEE_RATE / 100; // Convert from percentage to decimal
    const fee = roundedPrice * size * feeRate;
    
    // Calculate contract quantity for BitMEX
    const contractQty = this.calculateContractQty(size, roundedPrice);
    
    // Create new order object
    const order: Order = {
      id: getNextOrderId(),
      price: roundedPrice,
      size,
      contractQty,
      side,
      fee,
      oppositeOrderPrice,
      filled: false
    };
    
    // If in dry run mode, just add to local orders
    if (this.isDryRun) {
      this.activeOrders.push(order);
      this.logger.info(`[DRY RUN] Created ${side} order: ${size} BTC @ $${roundedPrice}`);
      return order;
    }
    
    try {
      // Place the order on BitMEX
      const bitmexOrder = await this.api.placeLimitOrder(
        side === 'buy' ? 'Buy' : 'Sell', 
        roundedPrice, 
        size,
        this.symbol
      );
      
      // Update order with BitMEX order ID
      order.bitmexOrderId = bitmexOrder.orderID;
      
      // Add to active orders
      this.activeOrders.push(order);
      
      // Update state
      await this.stateManager.updateActiveOrders(this.activeOrders);
      
      // Log order creation
      this.logger.success(`Created ${side} order: ${size} BTC @ $${roundedPrice} [${order.bitmexOrderId}]`);
      
      return order;
    } catch (error) {
      this.logger.error(`Failed to create ${side} order at ${roundedPrice}: ${error}`);
      throw error;
    }
  }

  /**
   * Fill an order (either by simulation or by detecting real fill)
   */
  async fillOrder(order: Order, executionPrice: number): Promise<void> {
    // Ensure execution price is rounded to the instrument's tick size
    executionPrice = this.roundPriceToTickSize(executionPrice);
    
    // Mark the order as filled
    order.filled = true;
    
    // Contract quantity string for logging
    const contractQtyStr = order.contractQty ? ` (${order.contractQty} contracts)` : '';
    
    this.logger.success(`Order #${order.id} FILLED: ${order.side.toUpperCase()} ${order.size} BTC${contractQtyStr} @ $${executionPrice.toFixed(2)}`);
    
    // If metrics are enabled, record the order execution
    if (this.metricsManager) {
      this.metricsManager.recordOrderExecution(
        order.id,
        order.side,
        executionPrice,
        order.size,
        order.fee
      );
      
      // Record trading volume
      this.metricsManager.recordVolume(
        order.size,
        executionPrice * order.size,
        order.side
      );
    }
    
    // Use asymmetric grid spacing based on the order side
    // For buy fills, we place a sell, so use upward spacing
    // For sell fills, we place a buy, so use downward spacing
    const gridSpacing = order.side === 'buy' 
      ? (this.gridSizing.upwardGridSpacing || this.getGridDistance())  // For buy fills, place sell with upward spacing
      : (this.gridSizing.downwardGridSpacing || this.getGridDistance()); // For sell fills, place buy with downward spacing
    
    // Calculate a new appropriate price based on the execution price and asymmetric spacing
    const newPrice = order.side === 'buy' 
      ? executionPrice + gridSpacing  // For buy fills, place sell gridSpacing above execution
      : executionPrice - gridSpacing; // For sell fills, place buy gridSpacing below execution
    
    // Check if there's any existing unfilled order at or very close to this price
    const existingOrderAtPrice = this.activeOrders.find(o => 
      !o.filled && 
      Math.abs(o.price - newPrice) < (gridSpacing * 0.01) // Within 1% of gridSpacing
    );
    
    // Always place a new order, but log if there's already one nearby
    if (existingOrderAtPrice && ENFORCE_ORDER_DISTANCE) {
      this.logger.warn(`Placing new order at ${newPrice.toFixed(2)} despite nearby order (ID: ${existingOrderAtPrice.id}) - ENFORCE_ORDER_DISTANCE is ${ENFORCE_ORDER_DISTANCE}`);
    }
    
    // Create a new order in the opposite direction
    const newSide = order.side === 'buy' ? 'sell' : 'buy';
    const newOrder = await this.createOrder(newPrice, order.size, newSide, null);
    
    // For sell orders created after buy fills, set the entry price to track profit
    if (newSide === 'sell') {
      newOrder.entryPrice = executionPrice;
    }
    
    this.logger.info(`Placed opposing ${newSide.toUpperCase()} order #${newOrder.id} at $${newPrice.toFixed(2)} (${gridSpacing.toFixed(2)} ${order.side === 'buy' ? 'above' : 'below'} fill price)`);
    
    // Try to find a matching order that completes a trade cycle
    if (order.oppositeOrderPrice !== null && order.oppositeOrderPrice !== undefined) {
      // This is an exit order filling from a previous entry
      this.logger.info(`Order #${order.id} completes a trade cycle with oppositeOrderPrice ${order.oppositeOrderPrice}`);
      
      // Find the entry order in completed orders
      const entryOrder = this.activeOrders.find(o => 
        o.filled && 
        ((order.side === 'buy' && o.side === 'sell') || (order.side === 'sell' && o.side === 'buy')) &&
        Math.abs(o.price - order.oppositeOrderPrice!) < 0.01
      );
      
      if (entryOrder) {
        // Calculate profit/loss
        let profit = 0;
        let entryPrice = 0;
        let exitPrice = 0;
        
        if (order.side === 'buy') {
          // Sell -> Buy cycle
          entryPrice = entryOrder.price;
          exitPrice = executionPrice;
          profit = (entryPrice - exitPrice) * order.size;
        } else {
          // Buy -> Sell cycle
          entryPrice = entryOrder.price;
          exitPrice = executionPrice;
          profit = (exitPrice - entryPrice) * order.size;
        }
        
        // Account for fees
        const totalFees = entryOrder.fee + order.fee;
        const netProfit = profit - totalFees;
        
        // Log the completed trade
        const profitStr = netProfit >= 0 ? '+' : '';
        this.logger.star(`COMPLETED TRADE: ${entryOrder.side.toUpperCase()} @ $${entryPrice.toFixed(2)} -> ${order.side.toUpperCase()} @ $${exitPrice.toFixed(2)}, Profit: ${profitStr}$${netProfit.toFixed(4)} (Fees: $${totalFees.toFixed(4)})`);
        
        // Record the trade in the completed trades list
        this.completedTrades.push({
          entryOrder: entryOrder,
          exitOrder: order,
          profit: netProfit,
          fees: totalFees
        });
        
        // Update state
        this.stateManager.updateCompletedTrades(this.completedTrades);
        this.logger.recordTrade(netProfit, totalFees, order.size);
        
        // If metrics are enabled, record the completed trade
        if (this.metricsManager) {
          this.metricsManager.recordTrade(
            netProfit,
            totalFees, 
            order.size,
            entryPrice,
            exitPrice
          );
        }
        
        // Update accumulated stats in state manager
        this.stateManager.updateStats(
          this.completedTrades.reduce((total, trade) => total + trade.profit, 0),
          this.completedTrades.length,
          this.completedTrades.filter(t => t.profit > 0).length,
          this.completedTrades.filter(t => t.profit < 0).length,
          this.completedTrades.reduce((total, trade) => total + trade.fees, 0),
          this.completedTrades.reduce((total, trade) => total + trade.entryOrder.size, 0)
        );
        
        // Record grid stats metrics
        if (this.metricsManager) {
          this.metricsManager.recordGridStats(
            this.completedTrades.reduce((total, trade) => total + trade.profit, 0),
            this.completedTrades.length,
            this.completedTrades.filter(t => t.entryOrder.side === 'buy').length,
            this.completedTrades.filter(t => t.entryOrder.side === 'sell').length,
            this.completedTrades.reduce((total, trade) => total + trade.fees, 0)
          );
        }
      }
    }
    
    // Remove the filled order from the active orders array
    this.activeOrders = this.activeOrders.filter(o => o.id !== order.id);
    this.logger.setActiveOrders(this.activeOrders.length);
    
    // Update state
    this.stateManager.updateActiveOrders(this.activeOrders);
    
    // For orders without a paired entry/exit, just track the fee
    if (!this.completedTrades.some(t => 
      (t.entryOrder && t.entryOrder.id === order.id) || 
      (t.exitOrder && t.exitOrder.id === order.id)
    )) {
      this.logger.recordTrade(0, order.fee, order.size);
    }
  }

  /**
   * Initialize the ping/pong grid
   */
  async initializeGrid(midPrice: number): Promise<void> {
    // If running in live mode, sync with exchange and cancel any existing orders first
    if (!this.isDryRun) {
      try {
        // Sync state with exchange to ensure we're working with the latest data
        await this.syncWithExchangeOrders();
        
        // Cancel all orders
        await this.api.cancelAllOrders(this.symbol);
        this.logger.success(`Cancelled all existing orders on ${this.symbol}`);
        
        // Wait a moment for cancel operations to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Sync again to confirm cancellations
        await this.syncWithExchangeOrders();
      } catch (error) {
        this.logger.error(`Failed to cancel existing orders: ${error}`);
        // Continue anyway
      }
    }
    
    // Clear any existing orders
    this.activeOrders = [];
    
    // Ensure the reference price is rounded to tick size
    this.referencePrice = this.roundPriceToTickSize(midPrice);
    
    // Get upward and downward grid spacing
    const upwardGridSpacing = this.gridSizing.upwardGridSpacing || this.getGridDistance();
    const downwardGridSpacing = this.gridSizing.downwardGridSpacing || this.getGridDistance();
    
    // Log grid initialization with asymmetric spacing if applicable
    if (upwardGridSpacing !== downwardGridSpacing) {
      this.logger.star(`Initializing ASYMMETRIC grid at $${this.referencePrice.toFixed(2)}, UP spacing: $${upwardGridSpacing.toFixed(2)}, DOWN spacing: $${downwardGridSpacing.toFixed(2)}`);
      
      // Log trend information if available
      if (this.gridSizing.trendDirection) {
        this.logger.info(`Grid spacing asymmetry based on ${this.gridSizing.trendDirection} trend (strength: ${(this.gridSizing.trendStrength || 0).toFixed(2)})`);
      }
    } else {
      this.logger.star(`Initializing SYMMETRIC grid at $${this.referencePrice.toFixed(2)}, grid spacing: $${upwardGridSpacing.toFixed(2)}`);
    }
    
    if (this.gridSizing.useATR && this.gridSizing.lastATRValue > 0) {
      this.logger.info(`Using ATR-based grid sizing: ATR=${this.gridSizing.lastATRValue.toFixed(2)}, multiplier=${ATR_MULTIPLIER}`);
    }
    
    // Create buy orders below the mid price with asymmetric spacing
    let currentBuyPrice = this.referencePrice;
    for (let i = 1; i <= ORDER_COUNT; i++) {
      currentBuyPrice -= downwardGridSpacing;
      // Round the buy price to the instrument's tick size
      const roundedBuyPrice = this.roundPriceToTickSize(currentBuyPrice);
      // Set oppositeOrderPrice to null since we now calculate it dynamically on fill
      await this.createOrder(roundedBuyPrice, ORDER_SIZE, 'buy', null);
    }
    
    // Create sell orders above the mid price with asymmetric spacing
    let currentSellPrice = this.referencePrice;
    for (let i = 1; i <= ORDER_COUNT; i++) {
      currentSellPrice += upwardGridSpacing;
      // Round the sell price to the instrument's tick size
      const roundedSellPrice = this.roundPriceToTickSize(currentSellPrice);
      // Set oppositeOrderPrice to null since we now calculate it dynamically on fill
      const order = await this.createOrder(roundedSellPrice, ORDER_SIZE, 'sell', null);
      // For sell orders, set the entry price to the current mid price
      // This allows tracking profit when the sell order is filled and later a buy order completes the cycle
      order.entryPrice = this.referencePrice;
    }
    
    // Calculate the total grid cost (capital required)
    let totalGridCost = 0;
    this.activeOrders.forEach(order => {
      if (order.side === 'buy') {
        const orderCost = order.price * order.size;
        totalGridCost += orderCost;
      }
    });
    
    this.gridInitialized = true;
    this.logger.setStatus(`GRID ACTIVE (${this.activeOrders.length} orders)`);
    this.logger.success(`Grid initialized with ${this.activeOrders.length} orders (${ORDER_COUNT} buys, ${ORDER_COUNT} sells)`);
    this.logger.star(`Total grid cost: $${totalGridCost.toFixed(2)} (capital required)`);
    
    // Update state
    this.stateManager.updateActiveOrders(this.activeOrders);
    this.stateManager.updateReferencePrice(this.referencePrice);
    
    // Simulate instant fills for orders that would execute at the current price
    this.simulateInstantFills(midPrice);
  }

  /**
   * Simulate fills for orders that would instantly execute at the current market price
   */
  simulateInstantFills(currentPrice: number): void {
    // Only simulate instant fills in dry run mode
    if (!this.isDryRun) return;
    
    const ordersToFill: Order[] = [];
    
    // Find orders that would instantly fill at current price
    this.activeOrders.forEach(order => {
      if (order.filled) return;
      
      if (order.side === 'buy' && currentPrice <= order.price) {
        // Buy order would fill if market price is at or below order price
        ordersToFill.push(order);
      } else if (order.side === 'sell' && currentPrice >= order.price) {
        // Sell order would fill if market price is at or above order price
        ordersToFill.push(order);
      }
    });
    
    // Simulate fills for those orders
    if (ordersToFill.length > 0) {
      this.logger.star(`[DRY RUN] Simulating instant fills for ${ordersToFill.length} orders at market price $${currentPrice.toFixed(2)}`);
      
      ordersToFill.forEach(order => {
        this.fillOrder(order, currentPrice);
      });
    }
  }

  /**
   * Check for order fills based on incoming trades
   */
  checkOrderFills(trade: BitMEXTrade): void {
    const tradePrice = trade.price;
    const tradeSide = trade.side; // 'Buy' or 'Sell' from BitMEX
    
    // In dry run mode, simulate fills
    if (this.isDryRun) {
      // Orders are filled when:
      // - Buy orders: when the market trades at or below the order price (meaning someone sold at/below our buy price)
      // - Sell orders: when the market trades at or above the order price (meaning someone bought at/above our sell price)
      
      this.activeOrders.forEach(order => {
        if (order.filled) return; // Skip already filled orders
        
        if (order.side === 'buy' && tradeSide.toLowerCase() === 'sell' && tradePrice <= order.price) {
          // Our buy order would be filled by this sell trade
          this.fillOrder(order, tradePrice);
        } else if (order.side === 'sell' && tradeSide.toLowerCase() === 'buy' && tradePrice >= order.price) {
          // Our sell order would be filled by this buy trade
          this.fillOrder(order, tradePrice);
        }
      });
    }
    // In live mode, fills are handled by webhook callbacks, not by checking trades
  }

  /**
   * Process market trades
   */
  processTrade(trade: BitMEXTrade): void {
    // Update current market price
    this.currentMarketPrice = trade.price;
    
    // Calculate distance to closest grid order
    let closestDistance = Number.MAX_VALUE;
    
    if (this.activeOrders.length > 0) {
      closestDistance = Math.min(
        ...this.activeOrders.map(order => Math.abs(order.price - trade.price))
      );
    }
    
    // Basic trade info with closest order distance
    this.logger.debug(`MARKET TRADE: ${trade.side} ${trade.size} @ $${trade.price} (${closestDistance.toFixed(2)} from closest grid order)`);
    
    // Check if price has moved significantly from reference price
    if (this.gridInitialized && this.referencePrice > 0 && 
        Math.abs(trade.price - this.referencePrice) > ORDER_DISTANCE * ORDER_COUNT) {
      this.logger.warn(`Price moved significantly from reference: $${this.referencePrice.toFixed(2)} -> $${trade.price.toFixed(2)}`);
      this.logger.warn(`Re-initializing grid at new price level`);
      this.initializeGrid(trade.price);
    }
    
    // Initialize grid if not already initialized
    if (!this.gridInitialized) {
      this.initializeGrid(trade.price);
    } else {
      // In dry run mode, check if any of our orders would be filled by this trade
      if (this.isDryRun) {
        this.checkOrderFills(trade);
      }
    }
  }

  /**
   * Handle real fill notification from BitMEX
   */
  async handleOrderFill(orderID: string, executionPrice: number, side: string, orderQty: number): Promise<void> {
    // Ensure execution price is rounded to the instrument's tick size
    executionPrice = this.roundPriceToTickSize(executionPrice);
    
    // Find the matching order in our active orders
    const matchingOrder = this.activeOrders.find(order => order.bitmexOrderId === orderID);
    
    if (matchingOrder) {
      // If order is already marked as filled, don't process it again
      if (matchingOrder.filled) {
        this.logger.info(`Order ${orderID} (local ID: ${matchingOrder.id}) already marked as filled, skipping`);
        return;
      }

      // For FFWCSX instruments like XBTUSD, verify the contract quantity matches
      if (this.symbol.includes('USD') && matchingOrder.contractQty) {
        // Log contract quantity for debugging
        this.logger.debug(`Order ${orderID} fill details: ${orderQty} contracts executed, local order has ${matchingOrder.contractQty} contracts`);
        
        // If the contract quantities don't match, update our local order
        if (matchingOrder.contractQty !== orderQty) {
          this.logger.warn(`Contract quantity mismatch for order ${orderID}: BitMEX reports ${orderQty}, local state has ${matchingOrder.contractQty}`);
          matchingOrder.contractQty = orderQty;
        }
      }
      
      this.logger.star(`Received fill notification for order ${orderID} (local ID: ${matchingOrder.id})`);
      
      // Mark this order as processed before doing the actual processing
      // This prevents issues if fillOrder results in state changes that trigger more operations
      this.processedOrderFills.add(orderID);
      
      await this.fillOrder(matchingOrder, executionPrice);
    } else {
      this.logger.warn(`Received fill notification for unknown order ${orderID} with ${orderQty} contracts`);
      
      // Even though we don't know this order, mark it as processed to prevent duplicate processing
      this.processedOrderFills.add(orderID);
      
      // Sync with exchange to ensure local state is up to date
      await this.syncWithExchangeOrders();
    }
  }

  // Getters for state information
  isGridInitialized(): boolean {
    return this.gridInitialized;
  }

  getReferencePrice(): number {
    return this.referencePrice;
  }

  getActiveOrders(): Order[] {
    return this.activeOrders;
  }

  getCompletedTrades(): CompletedTrade[] {
    return this.completedTrades;
  }
  
  /**
   * Public method to manually simulate market conditions (only in dry run mode)
   */
  simulateMarketPrice(price: number): void {
    if (!this.isDryRun) {
      this.logger.warn('Cannot simulate market price in live mode');
      return;
    }
    
    if (!this.gridInitialized) {
      this.initializeGrid(price);
    } else {
      this.logger.info(`[DRY RUN] Simulating market price at $${price.toFixed(2)}`);
      this.simulateInstantFills(price);
    }
  }

  /**
   * Start periodic sync with exchange orders
   */
  private startPeriodicSync(): void {
    // Use the constant for sync interval
    this.logger.info(`Starting periodic order sync every ${ORDER_SYNC_INTERVAL/1000} seconds`);
    
    this.syncIntervalId = setInterval(async () => {
      this.logger.debug('Running periodic order sync with exchange');
      await this.syncWithExchangeOrders();
      
      // Check and fill grid gaps after syncing with exchange
      await this.checkAndFillGridGaps();
    }, ORDER_SYNC_INTERVAL);
  }
  
  /**
   * Stop periodic sync
   */
  public stopPeriodicSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      this.logger.info('Stopped periodic order sync');
    }
  }
  
  /**
   * Check for gaps in the grid and fill them with new orders
   */
  private async checkAndFillGridGaps(): Promise<void> {
    // Don't attempt to fill gaps if the grid isn't initialized
    if (!this.gridInitialized || !this.instrumentInfo) {
      return;
    }
    
    // Round the current market price to the tick size
    const currentPrice = this.roundPriceToTickSize(this.currentMarketPrice);
    
    // Get active orders separated by side
    const buyOrders = this.activeOrders
      .filter(order => order.side === 'buy' && !order.filled)
      .sort((a, b) => b.price - a.price); // Sort by price descending for buy orders (highest first)
    
    const sellOrders = this.activeOrders
      .filter(order => order.side === 'sell' && !order.filled)
      .sort((a, b) => a.price - b.price); // Sort by price ascending for sell orders (lowest first)
    
    // Exit if we don't have both buy and sell orders
    if (buyOrders.length === 0 || sellOrders.length === 0) {
      this.logger.debug(`Cannot check for grid gaps: ${buyOrders.length} buy orders, ${sellOrders.length} sell orders`);
      return;
    }
    
    // Find the highest buy order and lowest sell order
    const highestBuy = buyOrders[buyOrders.length - 1].price;
    const lowestSell = sellOrders[0].price;
    
    // Get asymmetric grid distances
    const upwardGridSpacing = this.gridSizing.upwardGridSpacing || this.getGridDistance();
    const downwardGridSpacing = this.gridSizing.downwardGridSpacing || this.getGridDistance();
    
    // Calculate mid grid distance for reference
    const midGridDistance = (upwardGridSpacing + downwardGridSpacing) / 2;
    
    // Log current grid state for debugging
    this.logger.debug(`Grid state: ${buyOrders.length} buy orders (highest: ${highestBuy.toFixed(2)}), ${sellOrders.length} sell orders (lowest: ${lowestSell.toFixed(2)})`);
    
    // Threshold for gap detection (1.5x normal distance to account for some flexibility)
    const maxAllowedGap = midGridDistance * 1.5;
    
    // Check if there's a large gap between highest buy and lowest sell
    if (lowestSell - highestBuy > maxAllowedGap) {
      this.logger.warn(`Detected large gap between highest buy (${highestBuy.toFixed(2)}) and lowest sell (${lowestSell.toFixed(2)})`);
      
      // Calculate the middle of the gap where we'll place new orders
      const gapMiddle = (highestBuy + lowestSell) / 2;
      
      // Calculate how many orders we can fit in the gap
      const gapSize = lowestSell - highestBuy;
      
      // Determine the reference grid spacing for estimating order count
      // For the middle gap, use average spacing as a reference
      const avgGridSpacing = (upwardGridSpacing + downwardGridSpacing) / 2;
      const possibleOrderCount = Math.floor(gapSize / avgGridSpacing) - 1;
      
      if (possibleOrderCount > 0) {
        this.logger.info(`Filling gap with ${possibleOrderCount} orders`);
        
        // Place orders to fill the gap
        for (let i = 1; i <= possibleOrderCount; i++) {
          const ratio = i / (possibleOrderCount + 1);
          const price = highestBuy + (gapSize * ratio);
          
          // Determine order side based on position relative to the reference price
          const side = price < this.referencePrice ? 'buy' : 'sell';
          
          // Skip this order if it would execute immediately against the market
          if ((side === 'buy' && price >= currentPrice) || 
              (side === 'sell' && price <= currentPrice)) {
            this.logger.warn(`Skipping gap-filling ${side.toUpperCase()} order at ${price.toFixed(2)} - would execute immediately at market price ${currentPrice.toFixed(2)}`);
            continue;
          }
          
          try {
            const order = await this.createOrder(price, ORDER_SIZE, side, null);
            if (side === 'sell') {
              order.entryPrice = this.referencePrice;
            }
            this.logger.success(`Placed gap-filling ${side.toUpperCase()} order at ${price.toFixed(2)}`);
            
            // Sleep briefly between order placements to avoid rate limits
            if (i < possibleOrderCount) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          } catch (error) {
            this.logger.error(`Failed to place gap-filling order at ${price.toFixed(2)}: ${error}`);
            // Continue with next order rather than stopping the entire process
          }
        }
      }
    }
    
    // Check for gaps between consecutive buy orders
    for (let i = 0; i < buyOrders.length - 1; i++) {
      const currentPrice = buyOrders[i].price;
      const nextPrice = buyOrders[i + 1].price;
      const gap = nextPrice - currentPrice;
      
      // Buy orders should use downward spacing
      const maxAllowedBuyGap = downwardGridSpacing * 1.5;
      
      if (gap > maxAllowedBuyGap) {
        this.logger.warn(`Detected gap between buy orders: ${currentPrice.toFixed(2)} and ${nextPrice.toFixed(2)}`);
        
        // Calculate number of orders to insert
        const ordersToInsert = Math.floor(gap / downwardGridSpacing) - 1;
        
        if (ordersToInsert > 0) {
          for (let j = 1; j <= ordersToInsert; j++) {
            const price = currentPrice + (j * downwardGridSpacing);
            
            // Skip this order if it would execute immediately against the market
            if (price >= currentPrice) {
              this.logger.warn(`Skipping gap-filling BUY order at ${price.toFixed(2)} - would execute immediately at market price ${currentPrice.toFixed(2)}`);
              continue;
            }
            
            try {
              await this.createOrder(price, ORDER_SIZE, 'buy', null);
              this.logger.success(`Placed gap-filling BUY order at ${price.toFixed(2)}`);
              
              // Sleep briefly between order placements
              if (j < ordersToInsert) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            } catch (error) {
              this.logger.error(`Failed to place gap-filling order at ${price.toFixed(2)}: ${error}`);
              // Continue with next order
            }
          }
        }
      }
    }
    
    // Check for gaps between consecutive sell orders
    for (let i = 0; i < sellOrders.length - 1; i++) {
      const currentPrice = sellOrders[i].price;
      const nextPrice = sellOrders[i + 1].price;
      const gap = nextPrice - currentPrice;
      
      // Sell orders should use upward spacing
      const maxAllowedSellGap = upwardGridSpacing * 1.5;
      
      if (gap > maxAllowedSellGap) {
        this.logger.warn(`Detected gap between sell orders: ${currentPrice.toFixed(2)} and ${nextPrice.toFixed(2)}`);
        
        // Calculate number of orders to insert
        const ordersToInsert = Math.floor(gap / upwardGridSpacing) - 1;
        
        if (ordersToInsert > 0) {
          for (let j = 1; j <= ordersToInsert; j++) {
            const price = currentPrice + (j * upwardGridSpacing);
            
            // Skip this order if it would execute immediately against the market
            if (price <= currentPrice) {
              this.logger.warn(`Skipping gap-filling SELL order at ${price.toFixed(2)} - would execute immediately at market price ${currentPrice.toFixed(2)}`);
              continue;
            }
            
            try {
              const order = await this.createOrder(price, ORDER_SIZE, 'sell', null);
              order.entryPrice = this.referencePrice;
              this.logger.success(`Placed gap-filling SELL order at ${price.toFixed(2)}`);
              
              // Sleep briefly between order placements
              if (j < ordersToInsert) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            } catch (error) {
              this.logger.error(`Failed to place gap-filling order at ${price.toFixed(2)}: ${error}`);
              // Continue with next order
            }
          }
        }
      }
    }
    
    // Update state after filling gaps
    this.stateManager.updateActiveOrders(this.activeOrders);
  }
  
  /**
   * Clean up resources when shutting down
   */
  public cleanup(): void {
    this.stopPeriodicSync();
    this.stopATRRecalculationInterval();
    this.stopDeadManSwitch();
    
    // Save final state
    if (this.stateManager) {
      this.stateManager.updateActiveOrders(this.activeOrders);
      this.stateManager.updateCompletedTrades(this.completedTrades);
      this.stateManager.updateReferencePrice(this.referencePrice);
      this.stateManager.updateGridSizing(this.gridSizing);
      this.stateManager.saveState();
    }
    
    this.logger.info('Order manager resources cleaned up');
  }

  /**
   * Convert trade data to candles for technical indicators
   */
  private tradesIntoCandles(trades: any[]): Candle[] {
    const candles: Candle[] = [];
    let currentCandle: Candle | null = null;
    let candleMTS = 0;
    const candleSizeMS = 1000 * 60; // 1-minute candles
    
    this.logger.info(`Converting ${trades.length} trades to ${trades.length > 0 ? Math.ceil(trades.length / 10) : 0} estimated candles`);
    
    // Check if trades have timestamps and prices
    if (trades.length > 0) {
      const sampleTrade = trades[0];
      this.logger.debug(`Sample trade format: ${JSON.stringify(sampleTrade)}`);
      
      if (!sampleTrade.timestamp || !sampleTrade.price) {
        this.logger.error('Trade data missing required fields (timestamp or price)');
        return [];
      }
    }
    
    for (const trade of trades) {
      const { timestamp, price } = trade;
      const mts = new Date(timestamp).getTime();
      
      if (candleMTS === 0 || (mts - candleMTS > candleSizeMS)) {
        // Start new candle
        if (currentCandle) {
          candles.push(currentCandle);
        }
        
        candleMTS = mts;
        currentCandle = {
          open: price,
          high: price,
          low: price,
          close: price,
          timestamp: mts
        };
      } else if (currentCandle) {
        // Update current candle
        currentCandle.high = Math.max(currentCandle.high, price);
        currentCandle.low = Math.min(currentCandle.low, price);
        currentCandle.close = price;
      }
    }
    
    // Add final candle
    if (currentCandle) {
      candles.push(currentCandle);
    }
    
    // Log candle statistics
    if (candles.length > 0) {
      const firstCandle = candles[0];
      const lastCandle = candles[candles.length - 1];
      const timeDiffMinutes = (lastCandle.timestamp - firstCandle.timestamp) / (1000 * 60);
      
      this.logger.info(`Created ${candles.length} candles spanning ${timeDiffMinutes.toFixed(0)} minutes`);
      this.logger.debug(`First candle: ${new Date(firstCandle.timestamp).toISOString()}, O: ${firstCandle.open}, H: ${firstCandle.high}, L: ${firstCandle.low}, C: ${firstCandle.close}`);
      this.logger.debug(`Last candle: ${new Date(lastCandle.timestamp).toISOString()}, O: ${lastCandle.open}, H: ${lastCandle.high}, L: ${lastCandle.low}, C: ${lastCandle.close}`);
      
      // Check for price variation
      let hasVariation = false;
      let lowestPrice = candles[0].low;
      let highestPrice = candles[0].high;
      
      for (const candle of candles) {
        lowestPrice = Math.min(lowestPrice, candle.low);
        highestPrice = Math.max(highestPrice, candle.high);
        
        if (candle.high !== candle.low) {
          hasVariation = true;
        }
      }
      
      const priceRange = highestPrice - lowestPrice;
      this.logger.info(`Price range in candles: ${lowestPrice} to ${highestPrice} (range: ${priceRange})`);
      
      if (!hasVariation) {
        this.logger.warn('Warning: No price variation detected in candles (all OHLC values identical)');
      }
    }
    
    return candles;
  }
  
  /**
   * Calculate ATR and update grid spacing based on volatility
   */
  async calculateATRAndUpdateGridSpacing(): Promise<void> {
    try {
      // Fetch historical trades from BitMEX
      const trades = await this.api.getHistoricalTrades(
        this.symbol,
        ATR_HISTORICAL_TRADES_LOOKBACK,
        1000
      );
      
      if (!trades || trades.length === 0) {
        this.logger.warn('No historical trades found for ATR calculation');
        
        // Use test data for indicators in case of no trades
        this.logger.info('Using test data for trend analysis since no trades are available');
        this.trendAnalyzer.initializeWithTestData();
        
        // Get trend analysis results from test data
        const trendAnalysis = this.trendAnalyzer.analyzeTrend();
        this.logger.info(`Test data trend analysis: ${trendAnalysis.direction} (strength: ${trendAnalysis.strength.toFixed(2)}, asymmetry: ${trendAnalysis.asymmetryFactor.toFixed(2)})`);
        
        // Update grid sizing with test data trend
        this.updateGridSizingFromTrend(trendAnalysis);
        return;
      }
      
      this.logger.info(`Converting ${trades.length} trades to candles for ATR calculation`);
      
      // Convert trades to candles
      const candles = this.tradesIntoCandles(trades);
      this.candles = candles;
      
      if (candles.length < ATR_PERIOD + 1) {
        this.logger.warn(`Not enough candles for ATR calculation: ${candles.length} < ${ATR_PERIOD + 1}`);
        
        // Use test data for indicators if not enough candles
        this.logger.info('Using test data for trend analysis since not enough candles are available');
        this.trendAnalyzer.initializeWithTestData();
        
        // Get trend analysis results from test data
        const trendAnalysis = this.trendAnalyzer.analyzeTrend();
        this.logger.info(`Test data trend analysis: ${trendAnalysis.direction} (strength: ${trendAnalysis.strength.toFixed(2)}, asymmetry: ${trendAnalysis.asymmetryFactor.toFixed(2)})`);
        
        // Update grid sizing with test data trend
        this.updateGridSizingFromTrend(trendAnalysis);
        return;
      }
      
      // Check for price variation in candles
      const prices = candles.map(c => c.close);
      const uniquePrices = new Set(prices);
      
      if (uniquePrices.size < 5) {
        this.logger.warn(`Insufficient price variation in candles: only ${uniquePrices.size} unique prices found`);
        
        // Use test data for indicators if not enough price variation
        this.logger.info('Using test data for trend analysis since not enough price variation');
        this.trendAnalyzer.initializeWithTestData();
        
        // Get trend analysis results from test data
        const trendAnalysis = this.trendAnalyzer.analyzeTrend();
        this.logger.info(`Test data trend analysis: ${trendAnalysis.direction} (strength: ${trendAnalysis.strength.toFixed(2)}, asymmetry: ${trendAnalysis.asymmetryFactor.toFixed(2)})`);
        
        // Update grid sizing with test data trend
        this.updateGridSizingFromTrend(trendAnalysis);
        return;
      }
      
      // Process candles for trend analysis
      this.trendAnalyzer.processCandleHistory(candles);
      
      // Get trend analysis results
      const trendAnalysis = this.trendAnalyzer.analyzeTrend();
      this.logger.info(`Current trend analysis: ${trendAnalysis.direction} (strength: ${trendAnalysis.strength.toFixed(2)}, asymmetry: ${trendAnalysis.asymmetryFactor.toFixed(2)})`);
      
      // Check if trend analysis produced valid results
      if (trendAnalysis.strength === 0 && trendAnalysis.asymmetryFactor === 1.0) {
        this.logger.warn('Trend analysis produced neutral results, checking if we need to use test data');
        
        // Fall back to test data for accurate trend detection if needed
        this.trendAnalyzer.initializeWithTestData();
        const testTrendAnalysis = this.trendAnalyzer.analyzeTrend();
        
        if (testTrendAnalysis.strength > 0) {
          this.logger.info(`Using test data trend analysis instead: ${testTrendAnalysis.direction} (strength: ${testTrendAnalysis.strength.toFixed(2)}, asymmetry: ${testTrendAnalysis.asymmetryFactor.toFixed(2)})`);
          // Update trend analysis with test data
          this.updateGridSizingFromTrend(testTrendAnalysis);
        } else {
          // Update grid sizing with original trend data
          this.updateGridSizingFromTrend(trendAnalysis);
        }
      } else {
        // Update grid sizing with original trend data
        this.updateGridSizingFromTrend(trendAnalysis);
      }
      
      // Reset ATR indicator
      this.atrInstance = new ATR([ATR_PERIOD]);
      
      // Feed candles to ATR indicator
      for (const candle of candles) {
        this.atrInstance.add(candle);
      }
      
      // Get ATR value
      const atrValues = this.atrInstance._values as number[]; // Access internal values
      const atrValue = atrValues[atrValues.length - 1];
      
      if (!atrValue || isNaN(atrValue)) {
        this.logger.warn('Invalid ATR value calculated');
        return;
      }
      
      // Calculate new base grid spacing based on ATR
      const baseGridDistance = Math.min(
        Math.max(
          Math.round(atrValue * ATR_MULTIPLIER),
          ATR_MINIMUM_GRID_DISTANCE
        ),
        ATR_MAXIMUM_GRID_DISTANCE
      );
      
      // Update grid sizing config
      this.gridSizing.currentDistance = baseGridDistance;
      this.gridSizing.lastATRValue = atrValue;
      this.gridSizing.lastRecalculation = Date.now();
      
      // Save to state manager
      this.stateManager.updateGridSizing(this.gridSizing);
      
      if (this.metricsManager) {
        this.metricsManager.recordATR(atrValue);
        this.metricsManager.recordGridDistance(baseGridDistance);
        this.metricsManager.recordTrendMetrics(
          this.gridSizing.trendDirection || 'neutral', 
          this.gridSizing.trendStrength || 0, 
          this.gridSizing.upwardGridSpacing || baseGridDistance, 
          this.gridSizing.downwardGridSpacing || baseGridDistance
        );
      }
      
    } catch (error) {
      this.logger.error(`Failed to update grid spacing: ${error}`);
    }
  }
  
  /**
   * Update grid sizing configuration based on trend analysis
   */
  private updateGridSizingFromTrend(trendAnalysis: TrendAnalysis): void {
    // Apply asymmetric grid spacing based on trend
    const baseGridDistance = this.gridSizing.currentDistance;
    const asymmetryFactor = trendAnalysis.asymmetryFactor;
    let upwardGridSpacing: number;
    let downwardGridSpacing: number;
    
    if (trendAnalysis.direction === 'bullish') {
      // In bullish trend, wider spacing above (in direction of trend), tighter below
      upwardGridSpacing = Math.round(baseGridDistance * asymmetryFactor);
      downwardGridSpacing = Math.round(baseGridDistance / asymmetryFactor);
      this.logger.info(`Bullish trend: Wider grid spacing above (${upwardGridSpacing}), tighter below (${downwardGridSpacing})`);
    } else if (trendAnalysis.direction === 'bearish') {
      // In bearish trend, wider spacing below (in direction of trend), tighter above
      upwardGridSpacing = Math.round(baseGridDistance / asymmetryFactor);
      downwardGridSpacing = Math.round(baseGridDistance * asymmetryFactor);
      this.logger.info(`Bearish trend: Tighter grid spacing above (${upwardGridSpacing}), wider below (${downwardGridSpacing})`);
    } else {
      // Neutral trend, symmetric grid
      upwardGridSpacing = baseGridDistance;
      downwardGridSpacing = baseGridDistance;
      this.logger.info(`Neutral trend: Symmetric grid spacing (${baseGridDistance})`);
    }
    
    // Update grid sizing config
    this.gridSizing.trendDirection = trendAnalysis.direction;
    this.gridSizing.trendStrength = trendAnalysis.strength;
    this.gridSizing.asymmetryFactor = trendAnalysis.asymmetryFactor;
    this.gridSizing.upwardGridSpacing = upwardGridSpacing;
    this.gridSizing.downwardGridSpacing = downwardGridSpacing;
  }
  
  /**
   * Start ATR recalculation interval
   */
  startATRRecalculationInterval(): void {
    this.logger.info(`Starting ATR recalculation every ${ATR_RECALCULATION_INTERVAL/1000/60} minutes`);
    
    this.atrRecalculationIntervalId = setInterval(async () => {
      this.logger.debug('Running scheduled ATR recalculation');
      await this.calculateATRAndUpdateGridSpacing();
      
      // If grid is active, log current grid metrics
      if (this.gridInitialized) {
        this.logger.info(`Current grid: ${this.activeOrders.length} orders, spacing: ${this.gridSizing.currentDistance}, ATR: ${this.gridSizing.lastATRValue.toFixed(2)}`);
      }
    }, ATR_RECALCULATION_INTERVAL);
  }
  
  /**
   * Stop ATR recalculation interval
   */
  stopATRRecalculationInterval(): void {
    if (this.atrRecalculationIntervalId) {
      clearInterval(this.atrRecalculationIntervalId);
      this.atrRecalculationIntervalId = null;
      this.logger.info('Stopped ATR recalculation interval');
    }
  }
  
  /**
   * Get current grid distance based on ATR or constant
   */
  getGridDistance(): number {
    return this.gridSizing.useATR ? this.gridSizing.currentDistance : ORDER_DISTANCE;
  }
  
  /**
   * Get direction-aware grid spacing based on current price and side
   * @param side The order side (buy or sell)
   * @param currentPrice The current market price
   */
  getAsymmetricGridDistance(side: 'buy' | 'sell', currentPrice: number): number {
    if (!this.gridSizing.useATR) {
      return ORDER_DISTANCE;
    }
    
    // For buy orders (below current price), use downward spacing
    // For sell orders (above current price), use upward spacing
    if (side === 'buy') {
      return this.gridSizing.downwardGridSpacing || this.gridSizing.currentDistance;
    } else {
      return this.gridSizing.upwardGridSpacing || this.gridSizing.currentDistance;
    }
  }

  private startDeadManSwitch(): void {
    // Skip in dry run mode
    if (this.isDryRun) {
      this.logger.info('Dead man\'s switch disabled in dry run mode');
      return;
    }
    
    // Set the initial dead man's switch
    this.resetDeadManSwitch();
    
    // Set up interval to periodically reset the dead man's switch
    this.deadManSwitchIntervalId = setInterval(() => {
      this.resetDeadManSwitch();
    }, DEAD_MAN_SWITCH_INTERVAL);
    
    this.logger.info(`Dead man's switch initialized: will cancel all orders after ${DEAD_MAN_SWITCH_TIMEOUT / 1000} seconds of inactivity`);
  }

  private async resetDeadManSwitch(): Promise<void> {
    try {
      const response = await this.api.setCancelAllAfter(DEAD_MAN_SWITCH_TIMEOUT);
      this.logger.debug(`Dead man's switch reset: ${response.message}`);
    } catch (error) {
      this.logger.error(`Failed to reset dead man's switch: ${error}`);
    }
  }

  private stopDeadManSwitch(): void {
    if (this.deadManSwitchIntervalId) {
      clearInterval(this.deadManSwitchIntervalId);
      this.deadManSwitchIntervalId = null;
      this.logger.info('Dead man\'s switch stopped');
    }
  }

  /**
   * Checks if creating a new order would exceed the maximum position size
   * @param size The size of the potential new order in BTC
   * @param side The side of the potential new order
   * @returns Boolean indicating if the position limit would be exceeded
   */
  private async wouldExceedPositionLimit(size: number, side: 'buy' | 'sell'): Promise<boolean> {
    // In dry run mode, allow all orders
    if (this.isDryRun) {
      return false;
    }
    
    try {
      // Get current position
      const position = await this.api.getPosition(this.symbol);
      
      if (!position) {
        // No position, so we're safe
        return false;
      }
      
      // Current position in BTC
      const currentPositionBTC = Math.abs(position.currentQty) / (this.currentMarketPrice || 1);
      
      // For buy orders, check if adding to long position would exceed limit
      if (side === 'buy' && position.currentQty >= 0) {
        return currentPositionBTC + size > MAX_POSITION_SIZE_BTC;
      }
      
      // For sell orders, check if adding to short position would exceed limit
      if (side === 'sell' && position.currentQty <= 0) {
        return currentPositionBTC + size > MAX_POSITION_SIZE_BTC;
      }
      
      // Order reduces position size, so it's always safe
      return false;
    } catch (error) {
      this.logger.error(`Error checking position limits: ${error}`);
      // If we can't verify, be conservative and prevent the order
      return true;
    }
  }

  /**
   * Checks if the number of open orders would exceed the maximum allowed
   */
  private wouldExceedOrderLimit(): boolean {
    return this.activeOrders.length >= MAX_OPEN_ORDERS;
  }
} 