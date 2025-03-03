import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import * as fs from 'fs';
import * as path from 'path';
import { Order, CompletedTrade, GridSizingConfig } from './types';
import { BreakoutState, BreakoutTradeResult } from './types/breakout';
import { StatsLogger } from './logger';

// Define the database schema
interface AppState {
  activeOrders: Order[];
  completedTrades: CompletedTrade[];
  referencePrice: number;
  cumulativePnL: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  cumulativeFees: number;
  cumulativeVolume: number;
  lastUpdated: string;
  sessionStartTime: string;
  gridSizing?: GridSizingConfig;
  gridInitialized?: boolean;
  breakoutState?: BreakoutState;
  completedBreakoutTrades?: BreakoutTradeResult[];
}

export class StateManager {
  private db: Low<AppState>;
  private logger: StatsLogger;
  private savePath: string;
  
  constructor(savePath: string, logger: StatsLogger) {
    this.savePath = savePath;
    this.logger = logger;
    
    // Ensure directory exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Initialize the database with default values
    const adapter = new JSONFile<AppState>(savePath);
    this.db = new Low<AppState>(adapter, {
      activeOrders: [],
      completedTrades: [],
      referencePrice: 0,
      cumulativePnL: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      cumulativeFees: 0,
      cumulativeVolume: 0,
      lastUpdated: new Date().toISOString(),
      sessionStartTime: new Date().toISOString()
    });
    
    // Set default data if file doesn't exist
    if (!fs.existsSync(savePath)) {
      this.saveState();
    }
  }
  
  /**
   * Initialize the state manager and load state from disk
   */
  async initialize(): Promise<void> {
    try {
      await this.db.read();
      
      // If data is null (e.g., file exists but is empty), initialize it
      if (this.db.data === null) {
        this.db.data = {
          activeOrders: [],
          completedTrades: [],
          referencePrice: 0,
          cumulativePnL: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          cumulativeFees: 0,
          cumulativeVolume: 0,
          lastUpdated: new Date().toISOString(),
          sessionStartTime: new Date().toISOString()
        };
      } else {
        // Update the session start time but keep all other data
        this.db.data.sessionStartTime = new Date().toISOString();
      }
      
      this.logger.success(`State loaded from ${this.savePath}`);
      this.logger.info(`Loaded ${this.db.data.activeOrders.length} active orders, ${this.db.data.completedTrades.length} completed trades`);
      this.logger.star(`Cumulative P&L: $${this.db.data.cumulativePnL.toFixed(2)}, Fees: $${this.db.data.cumulativeFees.toFixed(4)}`);
      
      // Save initial state
      await this.saveState();
      this.logger.info('Save-on-write state management enabled');
      
    } catch (error) {
      this.logger.error(`Failed to initialize state: ${error}`);
      throw error;
    }
  }
  
  /**
   * Save the current state to disk
   */
  async saveState(state?: Partial<AppState>): Promise<void> {
    try {
      if (!this.db.data) {
        this.logger.error('Database data is null, cannot save state')
        return
      }
      
      if (state) {
        // Update with provided state properties
        this.db.data = { ...this.db.data, ...state }
      }
      
      // Always update timestamp
      this.db.data.lastUpdated = new Date().toISOString()
      await this.db.write()
      this.logger.debug(`State saved to ${this.savePath}`)
    } catch (error) {
      this.logger.error(`Error saving state: ${error}`)
    }
  }
  
  /**
   * Update the active orders
   */
  async updateActiveOrders(orders: Order[]): Promise<void> {
    if (!this.db.data) return;
    
    this.db.data.activeOrders = orders;
    this.logger.debug(`Updated active orders: ${orders.length} orders`);
    await this.saveState();
  }
  
  /**
   * Update completed trades
   */
  async updateCompletedTrades(trades: CompletedTrade[]): Promise<void> {
    if (!this.db.data) return;
    
    this.db.data.completedTrades = trades;
    this.logger.debug(`Updated completed trades: ${trades.length} trades`);
    await this.saveState();
  }
  
  /**
   * Update reference price
   */
  async updateReferencePrice(price: number): Promise<void> {
    if (!this.db.data) return;
    
    this.db.data.referencePrice = price;
    await this.saveState();
  }
  
  /**
   * Update grid sizing configuration
   */
  async updateGridSizing(gridSizing: GridSizingConfig): Promise<void> {
    if (!this.db.data) return;
    
    this.db.data.gridSizing = gridSizing;
    this.logger.debug(`Updated grid sizing configuration: distance=${gridSizing.currentDistance}, lastATR=${gridSizing.lastATRValue}`);
    await this.saveState();
  }
  
  /**
   * Update trading statistics
   */
  async updateStats(
    cumulativePnL: number,
    totalTrades: number,
    winningTrades: number,
    losingTrades: number,
    cumulativeFees: number,
    cumulativeVolume: number
  ): Promise<void> {
    if (!this.db.data) return;
    
    this.db.data.cumulativePnL = cumulativePnL;
    this.db.data.totalTrades = totalTrades;
    this.db.data.winningTrades = winningTrades;
    this.db.data.losingTrades = losingTrades;
    this.db.data.cumulativeFees = cumulativeFees;
    this.db.data.cumulativeVolume = cumulativeVolume;
    await this.saveState();
  }
  
  /**
   * Get the current state
   */
  getState(): AppState | null {
    return this.db.data;
  }
  
  /**
   * Get active orders
   */
  getActiveOrders(): Order[] {
    return this.db.data?.activeOrders || [];
  }
  
  /**
   * Get completed trades
   */
  getCompletedTrades(): CompletedTrade[] {
    return this.db.data?.completedTrades || [];
  }
  
  /**
   * Get reference price
   */
  getReferencePrice(): number {
    return this.db.data?.referencePrice || 0;
  }
  
  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    await this.saveState();
    this.logger.info('State manager closed, final state saved');
  }
} 