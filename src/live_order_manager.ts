import { ORDER_SIZE, ORDER_COUNT, ORDER_DISTANCE, FEE_RATE, getNextOrderId, ORDER_SYNC_INTERVAL, ENFORCE_ORDER_DISTANCE } from './constants';
import { Order, CompletedTrade, BitMEXTrade, BitMEXOrder, BitMEXInstrument } from './types';
import { StatsLogger } from './logger';
import { BitMEXAPI } from './bitmex_api';
import { StateManager } from './state_manager';
import { MetricsManager } from './metrics_manager';

export class LiveOrderManager {
  private activeOrders: Order[] = [];
  private completedTrades: CompletedTrade[] = [];
  private gridInitialized: boolean = false;
  private referencePrice: number = 0;
  private logger: StatsLogger;
  private api: BitMEXAPI;
  private stateManager: StateManager;
  private metricsManager: MetricsManager | null = null;
  private symbol: string = 'XBTUSD';
  private isDryRun: boolean = false;
  private instrumentInfo: BitMEXInstrument | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;
  private processedOrderFills: Set<string> = new Set<string>();

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
  }

  /**
   * Initialize the live order manager with saved state if available
   */
  async initialize(): Promise<void> {
    // First, fetch instrument information
    try {
      this.instrumentInfo = await this.api.getInstrument(this.symbol);
      if (this.instrumentInfo) {
        this.logger.success(`Loaded instrument details for ${this.symbol}: lotSize=${this.instrumentInfo.lotSize}, tickSize=${this.instrumentInfo.tickSize}`);
      } else {
        this.logger.error(`Failed to load instrument details for ${this.symbol}`);
        // If we're not in dry run mode, this is a critical error
        if (!this.isDryRun) {
          throw new Error(`Cannot trade without instrument details for ${this.symbol}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error fetching instrument details: ${error}`);
      if (!this.isDryRun) {
        throw error;
      }
    }
    
    // Load state
    const state = this.stateManager.getState();
    if (state) {
      this.activeOrders = state.activeOrders || [];
      this.completedTrades = state.completedTrades || [];
      this.referencePrice = state.referencePrice || 0;
      
      if (this.activeOrders.length > 0) {
        this.gridInitialized = true;
        this.logger.setStatus(`GRID ACTIVE (${this.activeOrders.length} orders)`);
        this.logger.success(`Loaded existing grid with ${this.activeOrders.length} orders`);
      }
    }
    
    // If in dry run mode, skip API syncing
    if (this.isDryRun) {
      this.logger.warn('Running in DRY RUN mode - no real orders will be placed');
      return;
    }
    
    // Compare local state with actual BitMEX orders
    await this.syncWithExchangeOrders();
    
    // Start periodic sync
    if (!this.isDryRun) {
      this.startPeriodicSync();
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
   * Calculate contract quantity respecting lot size
   */
  private calculateContractQty(btcSize: number, price: number): number {
    const lotSize = this.getLotSize();
    
    // For XBTUSD instruments, 1 contract = 1 USD worth of BTC
    if (this.symbol.includes('USD') && price > 0) {
      // Calculate raw contract quantity
      const rawContractQty = btcSize * price;
      // Round to nearest lot size
      return Math.round(rawContractQty / lotSize) * lotSize;
    }
    
    // For other instruments, use BTC size directly but ensure it's a multiple of lot size
    return Math.round(btcSize / lotSize) * lotSize || lotSize; // Use at least 1 lot size
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
    const fee = price * size * (FEE_RATE / 100);
    
    // Calculate contract quantity for FFWCSX instruments, respecting lot size
    const contractQty = this.calculateContractQty(size, price);
    
    // Adjust BTC size to match the exact contract quantity
    // This ensures our internal accounting matches what's on the exchange
    let adjustedSize = size;
    if (this.symbol.includes('USD') && price > 0) {
      adjustedSize = contractQty / price;
    }
    
    const order: Order = {
      id: getNextOrderId(),
      price,
      size: adjustedSize, // Size in BTC (adjusted to match contract qty)
      contractQty, // Size in contracts
      side,
      fee,
      oppositeOrderPrice,
      filled: false
    };
    
    // In dry run mode, just add the order locally
    if (this.isDryRun) {
      this.activeOrders.push(order);
      this.logger.setActiveOrders(this.activeOrders.length);
      this.logger.info(`[DRY RUN] Created ${side.toUpperCase()} order #${order.id}: ${adjustedSize.toFixed(8)} BTC (${contractQty} contracts) @ $${price.toFixed(2)}, FEE: $${fee.toFixed(4)}`);
      return order;
    }
    
    // Place order on BitMEX
    try {
      const bitmexSide = side === 'buy' ? 'Buy' : 'Sell';
      const response = await this.api.placeLimitOrder(bitmexSide, price, adjustedSize, this.symbol);
      
      // Store BitMEX order ID with our local order
      order.bitmexOrderId = response.orderID;
      
      this.activeOrders.push(order);
      this.logger.setActiveOrders(this.activeOrders.length);
      
      this.logger.success(`Created ${side.toUpperCase()} order #${order.id}: ${adjustedSize.toFixed(8)} BTC (${contractQty} contracts) @ $${price.toFixed(2)}, BitMEX ID: ${order.bitmexOrderId}`);
      
      // Update state
      this.stateManager.updateActiveOrders(this.activeOrders);
      
      return order;
    } catch (error) {
      this.logger.error(`Failed to place ${side} order at ${price}: ${error}`);
      throw error;
    }
  }

  /**
   * Fill an order (either by simulation or by detecting real fill)
   */
  async fillOrder(order: Order, executionPrice: number): Promise<void> {
    // Mark the order as filled
    order.filled = true;
    
    // Log the fill with contract quantity if available
    const contractQtyStr = order.contractQty ? ` (${order.contractQty} contracts)` : '';
    this.logger.success(`Order #${order.id} FILLED: ${order.side.toUpperCase()} ${order.size} BTC${contractQtyStr} @ $${executionPrice.toFixed(2)}`);
    
    // Record order execution metrics
    if (this.metricsManager) {
      this.metricsManager.recordOrderExecution(
        order.id, 
        order.side, 
        executionPrice, 
        order.size, 
        order.fee
      );
      
      // Record volume metrics
      this.metricsManager.recordVolume(
        order.size,
        executionPrice * order.size,
        order.side
      );
    }
    
    // Calculate a new appropriate price based on the execution price
    // This ensures the new order is placed at the correct distance from where the fill actually happened
    const newPrice = order.side === 'buy' 
      ? executionPrice + ORDER_DISTANCE  // For buy fills, place sell ORDER_DISTANCE above execution
      : executionPrice - ORDER_DISTANCE; // For sell fills, place buy ORDER_DISTANCE below execution
    
    // Check if there's any existing unfilled order at or very close to this price
    const existingOrderAtPrice = this.activeOrders.find(o => 
      !o.filled && 
      Math.abs(o.price - newPrice) < (ORDER_DISTANCE * 0.01) // Within 1% of ORDER_DISTANCE
    );
    
    if (existingOrderAtPrice && ENFORCE_ORDER_DISTANCE) {
      this.logger.warn(`Not placing new order at ${newPrice.toFixed(2)} because there's already an unfilled order nearby (ID: ${existingOrderAtPrice.id})`);
    } else {
      if (order.side === 'buy') {
        // We filled a buy order, so create a sell order
        const newOrder = await this.createOrder(newPrice, order.size, 'sell', null);
        newOrder.entryPrice = executionPrice; // Mark entry price for later profit calculation
        
      } else if (order.side === 'sell') {
        // We filled a sell order, so create a buy order
        const newOrder = await this.createOrder(newPrice, order.size, 'buy', null);
        const entryPrice = order.entryPrice;
        
        if (entryPrice) {
          // Calculate profit from selling higher than entry
          const grossProfit = (executionPrice - entryPrice) * order.size;
          const totalFees = order.fee + newOrder.fee;
          const netProfit = grossProfit - totalFees;
          
          // Record the completed trade
          this.completedTrades.push({
            entryOrder: {
              ...order,
              price: entryPrice,
              side: 'buy' // Treat the entry as a buy for simplicity in tracking
            } as Order,
            exitOrder: {
              ...order,
              price: executionPrice
            } as Order,
            profit: netProfit,
            fees: totalFees
          });
          
          this.logger.star(`Trade complete: ENTRY @ $${entryPrice.toFixed(2)} → EXIT @ $${executionPrice.toFixed(2)} | Net P/L: $${netProfit.toFixed(2)}`);
          
          // Report the trade profit (now passing net profit after fees)
          this.logger.recordTrade(netProfit, totalFees, order.size);
          
          // Record round-trip trade metrics in InfluxDB
          if (this.metricsManager) {
            this.metricsManager.recordTrade(
              netProfit,
              totalFees,
              order.size,
              entryPrice,
              executionPrice
            );
          }
          
          // Update state
          this.stateManager.updateCompletedTrades(this.completedTrades);
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
    
    this.referencePrice = midPrice;
    this.logger.star(`Initializing grid with reference price: $${midPrice.toFixed(2)}`);
    
    // Create buy orders below the mid price
    for (let i = 1; i <= ORDER_COUNT; i++) {
      const buyPrice = midPrice - (i * ORDER_DISTANCE);
      // Set oppositeOrderPrice to null since we now calculate it dynamically on fill
      await this.createOrder(buyPrice, ORDER_SIZE, 'buy', null);
    }
    
    // Create sell orders above the mid price
    for (let i = 1; i <= ORDER_COUNT; i++) {
      const sellPrice = midPrice + (i * ORDER_DISTANCE);
      // Set oppositeOrderPrice to null since we now calculate it dynamically on fill
      const order = await this.createOrder(sellPrice, ORDER_SIZE, 'sell', null);
      // For sell orders, set the entry price to the current mid price
      // This allows tracking profit when the sell order is filled and later a buy order completes the cycle
      order.entryPrice = midPrice;
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
    // Check if we've already processed this order fill
    if (this.processedOrderFills.has(orderID)) {
      this.logger.info(`Order ${orderID} fill already processed, skipping duplicate notification`);
      return;
    }

    // Find the local order that matches this BitMEX order ID
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
   * Clean up resources when shutting down
   */
  public cleanup(): void {
    this.stopPeriodicSync();
    this.logger.info('Order manager resources cleaned up');
  }
} 