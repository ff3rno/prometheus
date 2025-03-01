import { ORDER_SIZE, ORDER_COUNT, ORDER_DISTANCE, FEE_RATE, getNextOrderId } from './constants';
import { Order, CompletedTrade, BitMEXTrade, BitMEXOrder } from './types';
import { StatsLogger } from './logger';
import { BitMEXAPI } from './bitmex_api';
import { StateManager } from './state_manager';

export class LiveOrderManager {
  private activeOrders: Order[] = [];
  private completedTrades: CompletedTrade[] = [];
  private gridInitialized: boolean = false;
  private referencePrice: number = 0;
  private logger: StatsLogger;
  private api: BitMEXAPI;
  private stateManager: StateManager;
  private symbol: string = 'XBTUSD';
  private isDryRun: boolean = false;

  constructor(
    api: BitMEXAPI,
    stateManager: StateManager,
    logger: StatsLogger,
    symbol: string = 'XBTUSD',
    isDryRun: boolean = false
  ) {
    this.api = api;
    this.stateManager = stateManager;
    this.logger = logger;
    this.symbol = symbol;
    this.isDryRun = isDryRun;
  }

  /**
   * Initialize the live order manager with saved state if available
   */
  async initialize(): Promise<void> {
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
  }

  /**
   * Synchronize local order state with BitMEX
   */
  private async syncWithExchangeOrders(): Promise<void> {
    try {
      this.logger.info('Syncing local state with BitMEX orders...');
      
      // Get current open orders from the exchange
      const openOrders = await this.api.getOpenOrders(this.symbol);
      
      if (openOrders.length > 0) {
        this.logger.success(`Found ${openOrders.length} open orders on BitMEX`);
        
        // If we have no local orders but there are orders on the exchange,
        // we need to rebuild our local state
        if (this.activeOrders.length === 0 && openOrders.length > 0) {
          this.logger.warn('Local order state is empty but exchange has orders - rebuilding local state');
          
          // Convert BitMEX orders to our internal format
          const convertedOrders: Order[] = openOrders.map(bitmexOrder => {
            return {
              id: parseInt(bitmexOrder.orderID.slice(-6), 10) || getNextOrderId(),
              price: bitmexOrder.price,
              size: Math.abs(bitmexOrder.orderQty),
              side: bitmexOrder.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
              fee: bitmexOrder.price * Math.abs(bitmexOrder.orderQty) * (FEE_RATE / 100),
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
        // We have local orders but no exchange orders - clear local state
        this.logger.warn('No orders found on exchange but local state has orders - clearing local state');
        this.activeOrders = [];
        this.gridInitialized = false;
        this.stateManager.updateActiveOrders(this.activeOrders);
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
    const order: Order = {
      id: getNextOrderId(),
      price,
      size,
      side,
      fee,
      oppositeOrderPrice,
      filled: false
    };
    
    // In dry run mode, just add the order locally
    if (this.isDryRun) {
      this.activeOrders.push(order);
      this.logger.setActiveOrders(this.activeOrders.length);
      this.logger.info(`[DRY RUN] Created ${side.toUpperCase()} order #${order.id}: ${size} @ $${price.toFixed(2)}, FEE: $${fee.toFixed(4)}`);
      return order;
    }
    
    // Place order on BitMEX
    try {
      const bitmexSide = side === 'buy' ? 'Buy' : 'Sell';
      const response = await this.api.placeLimitOrder(bitmexSide, price, size, this.symbol);
      
      // Store BitMEX order ID with our local order
      order.bitmexOrderId = response.orderID;
      
      this.activeOrders.push(order);
      this.logger.setActiveOrders(this.activeOrders.length);
      
      this.logger.success(`Created ${side.toUpperCase()} order #${order.id}: ${size} BTC @ $${price.toFixed(2)}, BitMEX ID: ${order.bitmexOrderId}`);
      
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
    
    // Log the fill
    this.logger.success(`Order #${order.id} FILLED: ${order.side.toUpperCase()} ${order.size} BTC @ $${executionPrice.toFixed(2)}`);
    
    // Create a new order on the opposite side if specified
    if (order.oppositeOrderPrice !== null) {
      if (order.side === 'buy') {
        // We filled a buy order, so create a sell order
        const newOrder = await this.createOrder(order.oppositeOrderPrice, order.size, 'sell', order.price);
        newOrder.entryPrice = executionPrice; // Mark entry price for later profit calculation
        
      } else if (order.side === 'sell') {
        // We filled a sell order, so create a buy order
        const newOrder = await this.createOrder(order.oppositeOrderPrice, order.size, 'buy', order.price);
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
    // If running in live mode, cancel any existing orders first
    if (!this.isDryRun) {
      try {
        await this.api.cancelAllOrders(this.symbol);
        this.logger.success(`Cancelled all existing orders on ${this.symbol}`);
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
      const sellPrice = midPrice + (i * ORDER_DISTANCE); // Where we'll place a sell if this buy gets filled
      await this.createOrder(buyPrice, ORDER_SIZE, 'buy', sellPrice);
    }
    
    // Create sell orders above the mid price
    for (let i = 1; i <= ORDER_COUNT; i++) {
      const sellPrice = midPrice + (i * ORDER_DISTANCE);
      const buyPrice = midPrice - (i * ORDER_DISTANCE); // Where we'll place a buy if this sell gets filled
      const order = await this.createOrder(sellPrice, ORDER_SIZE, 'sell', buyPrice);
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
    // Find the local order that matches this BitMEX order ID
    const matchingOrder = this.activeOrders.find(order => order.bitmexOrderId === orderID);
    
    if (matchingOrder) {
      this.logger.star(`Received fill notification for order ${orderID} (local ID: ${matchingOrder.id})`);
      await this.fillOrder(matchingOrder, executionPrice);
    } else {
      this.logger.warn(`Received fill notification for unknown order ${orderID}`);
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
} 