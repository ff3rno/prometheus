import { Signale } from 'signale'
import WS from 'ws'

const BITMEX_WS_API_URL = 'wss://ws.bitmex.com/realtime'
// Configure the minimum price distance between entry and exit
const PRICE_DISTANCE = 100 // in USD
// Configure the stop-loss as a percentage of the PRICE_DISTANCE
const STOP_LOSS_PERCENTAGE = 0.2 // 20% of PRICE_DISTANCE
// Configure the trading fee rate (in percentage)
const FEE_RATE = 0.0500 // 0.0500% of trade value
// Configure the default trade size
const DEFAULT_TRADE_SIZE = 0.01 // in BTC

// Trading state
interface Position {
  isOpen: boolean
  entryPrice: number
  stopPrice: number
  targetPrice: number
  side: 'long' | 'short' | null
  size: number
  entryFee: number // Fee paid at entry
}

// Create a custom logger with stats
class StatsLogger {
  private signale: Signale;
  private cumulativePnL: number = 0;
  private totalTrades: number = 0;
  private winningTrades: number = 0;
  private losingTrades: number = 0;
  private currentPositionStatus: 'LONG' | 'SHORT' | 'NONE' = 'NONE';
  private cumulativeFees: number = 0; // Track total fees paid
  private cumulativeVolume: number = 0; // Track total trading volume in BTC

  constructor(scope: string) {
    this.signale = new Signale({ scope: `prometheus:${scope}` });
  }

  private getStatsPrefix(): string {
    return `[$${this.cumulativePnL.toFixed(2)}|${this.totalTrades}|${this.currentPositionStatus}|FEES:$${this.cumulativeFees.toFixed(4)}|VOL:${this.cumulativeVolume.toFixed(4)}]`;
  }

  recordTrade(profit: number, fees: number = 0, volume: number = 0): void {
    this.cumulativePnL += profit;
    this.cumulativeFees += fees;
    this.cumulativeVolume += volume;
    this.totalTrades++;
    
    if (profit > 0) {
      this.winningTrades++;
    } else if (profit < 0) {
      this.losingTrades++;
    }
    // If profit is exactly 0, it's neither a win nor a loss
  }

  setPositionStatus(status: 'LONG' | 'SHORT' | 'NONE'): void {
    this.currentPositionStatus = status;
  }

  info(message: string): void {
    this.signale.info(`${this.getStatsPrefix()} ${message}`);
  }

  success(message: string): void {
    this.signale.success(`${this.getStatsPrefix()} ${message}`);
  }

  error(message: string): void {
    this.signale.error(`${this.getStatsPrefix()} ${message}`);
  }

  debug(message: string): void {
    this.signale.debug(`${this.getStatsPrefix()} ${message}`);
  }

  star(message: string): void {
    this.signale.star(`${this.getStatsPrefix()} ${message}`);
  }
  
  warn(message: string): void {
    this.signale.warn(`${this.getStatsPrefix()} ${message}`);
  }
}

const l = new StatsLogger('main');

const run = async () => {
    const ws = new WS(BITMEX_WS_API_URL)
    let position: Position = {
      isOpen: false,
      entryPrice: 0,
      stopPrice: 0,
      targetPrice: 0,
      side: null,
      size: 0,
      entryFee: 0
    }

    // Function to simulate a trade entry (buy)
    const enterPosition = (price: number, size: number = DEFAULT_TRADE_SIZE) => {
      // Calculate entry fee
      const tradeValue = price * size
      const entryFee = tradeValue * (FEE_RATE / 100)
      
      position = {
        isOpen: true,
        entryPrice: price,
        stopPrice: price - PRICE_DISTANCE * STOP_LOSS_PERCENTAGE,
        targetPrice: price + PRICE_DISTANCE,
        side: 'long',
        size,
        entryFee
      }
      // Update the logger's position status
      l.setPositionStatus('LONG');
      
      const expectedProfit = PRICE_DISTANCE * size
      const potentialLoss = PRICE_DISTANCE * STOP_LOSS_PERCENTAGE * size
      // Calculate expected exit fee for profit scenario
      const exitFeeAtTarget = position.targetPrice * size * (FEE_RATE / 100)
      // Calculate expected exit fee for stop-loss scenario
      const exitFeeAtStop = position.stopPrice * size * (FEE_RATE / 100)
      // Calculate net expected profit/loss after fees
      const netExpectedProfit = expectedProfit - entryFee - exitFeeAtTarget
      const netPotentialLoss = potentialLoss + entryFee + exitFeeAtStop
      
      l.success(`ENTRY: BUY ${size} BTC @ $${price}, TARGET: $${position.targetPrice}, STOP: $${position.stopPrice.toFixed(2)}, FEE: $${entryFee.toFixed(4)}, NET ESTP: $${netExpectedProfit.toFixed(4)}, NET ESTL: $${netPotentialLoss.toFixed(4)}`)
    }

    // Function to simulate a trade exit (sell)
    const exitPosition = (price: number, reason: 'target' | 'stop-loss') => {
      // Calculate exit fee
      const tradeValue = price * position.size
      const exitFee = tradeValue * (FEE_RATE / 100)
      
      // Calculate gross profit/loss (before fees)
      const grossProfit = (price - position.entryPrice) * position.size
      // Calculate net profit/loss (after fees)
      const netProfit = grossProfit - position.entryFee - exitFee;
      
      // Record the completed trade with net profit, fees, and volume
      l.recordTrade(netProfit, position.entryFee + exitFee, position.size);
      
      // Log the appropriate message based on exit reason
      if (reason === 'target') {
        l.success(`EXIT (TARGET): SELL ${position.size} BTC @ $${price}, GROSS PROFIT: $${grossProfit.toFixed(4)}, FEES: $${(position.entryFee + exitFee).toFixed(4)}, NET PROFIT: $${netProfit.toFixed(4)}`)
      } else {
        l.warn(`EXIT (STOP): SELL ${position.size} BTC @ $${price}, GROSS LOSS: $${grossProfit.toFixed(4)}, FEES: $${(position.entryFee + exitFee).toFixed(4)}, NET LOSS: $${netProfit.toFixed(4)}`)
      }
      
      position = {
        isOpen: false,
        entryPrice: 0,
        stopPrice: 0,
        targetPrice: 0,
        side: null,
        size: 0,
        entryFee: 0
      }
      // Update the logger's position status
      l.setPositionStatus('NONE');
    }

    ws.on('open', () => {
        l.info('ws open')

        ws.send(JSON.stringify({
            op: 'subscribe',
            args: ['trade:XBTUSD']
        }))
    })

    ws.on('error', (err: string) => {
        l.info(`ws error: ${err}`)
    })

    ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString())
        
        // Handle trade data
        if (message.table === 'trade' && message.data && message.data.length > 0) {
            const trades = message.data
            
            // Process each trade in the message
            trades.forEach((trade: any) => {
                // Basic trade info
                let logMessage = `TRADE: ${trade.side} ${trade.size} @ $${trade.price}`
                
                // If position is open, add distance to target and current P&L
                if (position.isOpen) {
                    const distanceToTarget = position.targetPrice - trade.price
                    const distanceToStop = trade.price - position.stopPrice
                    const currentPnL = trade.price - position.entryPrice
                    logMessage += `, PNL: $${currentPnL.toFixed(2)}, DEXIT: $${distanceToTarget.toFixed(2)}, DSTOP: $${distanceToStop.toFixed(2)}`
                }
                
                l.info(logMessage)
                
                // Trading logic
                if (!position.isOpen) {
                    // No position, enter immediately
                    enterPosition(trade.price)
                } else {
                    // Check if we've reached our exit target or stop-loss
                    if (trade.price >= position.targetPrice) {
                        // Exit the position at target
                        exitPosition(trade.price, 'target')
                        
                        // Immediately enter a new position
                        enterPosition(trade.price)
                    } else if (trade.price <= position.stopPrice) {
                        // Exit the position at stop-loss
                        exitPosition(trade.price, 'stop-loss')
                        
                        // Immediately enter a new position
                        enterPosition(trade.price)
                    }
                }
            })
        } else {
            l.debug(data.toString())
        }
    })
}

run().catch((err: any): void => {
    l.error(err?.message ?? err)
})