import { ORDER_SIZE, ORDER_COUNT, ORDER_DISTANCE, FEE_RATE, getNextOrderId } from './constants';
import { Order, CompletedTrade, BitMEXTrade } from './types';
import { StatsLogger } from './logger';

export class OrderManager {
  private activeOrders: Order[] = [];
  private completedTrades: CompletedTrade[] = [];
  private gridInitialized: boolean = false;
  private referencePrice: number = 0;
  private logger: StatsLogger;

  constructor(logger: StatsLogger) {
    this.logger = logger;
  }

  // Create an order
  createOrder(price: number, size: number, side: 'buy' | 'sell', oppositeOrderPrice: number | null = null): Order {
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
    
    this.activeOrders.push(order);
    this.logger.setActiveOrders(this.activeOrders.length);
    
    this.logger.info(`Created ${side.toUpperCase()} order #${order.id}: ${size} BTC @ $${price.toFixed(2)}, FEE: $${fee.toFixed(4)}`);
    
    return order;
  }

  // Simulate fills for orders that would instantly execute at the current market price
  simulateInstantFills(currentPrice: number): void {
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
      this.logger.star(`Simulating instant fills for ${ordersToFill.length} orders at market price $${currentPrice.toFixed(2)}`);
      
      ordersToFill.forEach(order => {
        this.fillOrder(order, currentPrice);
      });
    }
  }

  // Initialize the ping/pong grid
  initializeGrid(midPrice: number): void {
    // Clear any existing orders
    this.activeOrders = [];
    
    this.referencePrice = midPrice;
    this.logger.star(`Initializing grid with reference price: $${midPrice.toFixed(2)}`);
    
    // Create buy orders below the mid price
    for (let i = 1; i <= ORDER_COUNT; i++) {
      const buyPrice = midPrice - (i * ORDER_DISTANCE);
      const sellPrice = midPrice + (i * ORDER_DISTANCE); // Where we'll place a sell if this buy gets filled
      this.createOrder(buyPrice, ORDER_SIZE, 'buy', sellPrice);
    }
    
    // Create sell orders above the mid price
    for (let i = 1; i <= ORDER_COUNT; i++) {
      const sellPrice = midPrice + (i * ORDER_DISTANCE);
      const buyPrice = midPrice - (i * ORDER_DISTANCE); // Where we'll place a buy if this sell gets filled
      const order = this.createOrder(sellPrice, ORDER_SIZE, 'sell', buyPrice);
      // For sell orders, set the entry price to the current mid price
      // This allows tracking profit when the sell order is filled and later a buy order completes the cycle
      order.entryPrice = midPrice;
    }
    
    // Calculate the total grid cost (capital required)
    let totalGridCost = 0;
    this.activeOrders.forEach(order => {
      const orderCost = order.price * order.size;
      totalGridCost += orderCost;
    });
    
    this.gridInitialized = true;
    this.logger.setStatus(`GRID ACTIVE (${this.activeOrders.length} orders)`);
    this.logger.success(`Grid initialized with ${this.activeOrders.length} orders (${ORDER_COUNT} buys, ${ORDER_COUNT} sells)`);
    this.logger.star(`Total grid cost: $${totalGridCost.toFixed(2)} (capital required)`);
    
    // Simulate instant fills for orders that would execute at the current price
    this.simulateInstantFills(midPrice);
  }

  // Handle order fills
  fillOrder(order: Order, executionPrice: number): void {
    // Mark the order as filled
    order.filled = true;
    
    // Log the fill
    this.logger.success(`Order #${order.id} FILLED: ${order.side.toUpperCase()} ${order.size} BTC @ $${executionPrice.toFixed(2)}`);
    
    // Create a new order on the opposite side if specified
    if (order.oppositeOrderPrice !== null) {
      if (order.side === 'buy') {
        // We filled a buy order, so create a sell order
        const newOrder = this.createOrder(order.oppositeOrderPrice, order.size, 'sell', order.price);
        newOrder.entryPrice = executionPrice; // Mark entry price for later profit calculation
        
      } else if (order.side === 'sell') {
        // We filled a sell order, so create a buy order
        const newOrder = this.createOrder(order.oppositeOrderPrice, order.size, 'buy', order.price);
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
          
          this.logger.star(`Trade complete: ENTRY @ $${entryPrice.toFixed(2)} → EXIT @ $${executionPrice.toFixed(2)} | Gross P/L: $${grossProfit.toFixed(2)} | Fees: $${totalFees.toFixed(4)} | Net P/L: $${netProfit.toFixed(2)}`);
          
          // Report the trade profit (now passing net profit after fees)
          this.logger.recordTrade(netProfit, totalFees, order.size);
        }
      }
    }
    
    // Remove the filled order from the active orders array
    this.activeOrders = this.activeOrders.filter(o => o.id !== order.id);
    this.logger.setActiveOrders(this.activeOrders.length);
    
    // For orders without a paired entry/exit, just track the fee
    if (!this.completedTrades.some(t => 
      (t.entryOrder && t.entryOrder.id === order.id) || 
      (t.exitOrder && t.exitOrder.id === order.id)
    )) {
      this.logger.recordTrade(0, order.fee, order.size);
    }
  }

  // Check for order fills based on incoming trades
  checkOrderFills(trade: BitMEXTrade): void {
    const tradePrice = trade.price;
    const tradeSide = trade.side; // 'Buy' or 'Sell' from BitMEX
    
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

  // Process market trades
  processTrade(trade: BitMEXTrade): void {
    // Calculate distance to closest grid order
    let closestDistance = Number.MAX_VALUE;
    
    if (this.activeOrders.length > 0) {
      closestDistance = Math.min(
        ...this.activeOrders.map(order => Math.abs(order.price - trade.price))
      );
    }
    
    // Basic trade info with closest order distance
    this.logger.info(`MARKET TRADE: ${trade.side} ${trade.size} @ $${trade.price} (${closestDistance.toFixed(2)} from closest grid order)`);
    
    // Check if price has moved significantly from reference price
    if (this.gridInitialized && Math.abs(trade.price - this.referencePrice) > ORDER_DISTANCE * ORDER_COUNT) {
      this.logger.warn(`Price moved significantly from reference: $${this.referencePrice.toFixed(2)} -> $${trade.price.toFixed(2)}`);
      this.logger.warn(`Re-initializing grid at new price level`);
      this.initializeGrid(trade.price);
    }
    
    // Initialize grid if not already initialized
    if (!this.gridInitialized) {
      this.initializeGrid(trade.price);
    } else {
      // Check if any of our orders would be filled by this trade
      this.checkOrderFills(trade);
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
  
  // Public method to manually simulate market conditions
  simulateMarketPrice(price: number): void {
    if (!this.gridInitialized) {
      this.initializeGrid(price);
    } else {
      this.logger.info(`Simulating market price at $${price.toFixed(2)}`);
      this.simulateInstantFills(price);
    }
  }
} 