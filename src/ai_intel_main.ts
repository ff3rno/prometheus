import axios from 'axios';
import { RSI, ATR, BollingerBands } from 'bfx-hf-indicators';

const SYMBOL_OVERRIDE: string | null = null;
// const SYMBOL_OVERRIDE: string | null = 'SOLUSD';

// Define interfaces for the BitMEX Instrument response
interface BitMEXInstrument {
  symbol: string;
  rootSymbol: string;
  state: string;
  typ: string;
  listing: string;
  front: string;
  expiry: string;
  settle: string;
  relistInterval: string;
  inverseLeg: string;
  sellLeg: string;
  buyLeg: string;
  optionStrikePcnt: number;
  optionStrikeRound: number;
  optionStrikePrice: number;
  optionMultiplier: number;
  positionCurrency: string;
  underlying: string;
  quoteCurrency: string;
  underlyingSymbol: string;
  reference: string;
  referenceSymbol: string;
  calcInterval: string;
  publishInterval: string;
  publishTime: string;
  maxOrderQty: number;
  maxPrice: number;
  lotSize: number;
  tickSize: number;
  multiplier: number;
  settlCurrency: string;
  underlyingToPositionMultiplier: number;
  underlyingToSettleMultiplier: number;
  quoteToSettleMultiplier: number;
  isQuanto: boolean;
  isInverse: boolean;
  initMargin: number;
  maintMargin: number;
  riskLimit: number;
  riskStep: number;
  limit: number;
  capped: boolean;
  taxed: boolean;
  deleverage: boolean;
  makerFee: number;
  takerFee: number;
  settlementFee: number;
  insuranceFee: number;
  fundingBaseSymbol: string;
  fundingQuoteSymbol: string;
  fundingPremiumSymbol: string;
  fundingTimestamp: string;
  fundingInterval: string;
  fundingRate: number;
  indicativeFundingRate: number;
  rebalanceTimestamp: string;
  rebalanceInterval: string;
  openingTimestamp: string;
  closingTimestamp: string;
  sessionInterval: string;
  prevClosePrice: number;
  limitDownPrice: number;
  limitUpPrice: number;
  bankruptLimitDownPrice: number;
  bankruptLimitUpPrice: number;
  prevTotalVolume: number;
  totalVolume: number;
  volume: number;
  volume24h: number;
  prevTotalTurnover: number;
  totalTurnover: number;
  turnover: number;
  turnover24h: number;
  homeNotional24h: number;
  foreignNotional24h: number;
  prevPrice24h: number;
  vwap: number;
  highPrice: number;
  lowPrice: number;
  lastPrice: number;
  lastPriceProtected: number;
  lastTickDirection: string;
  lastChangePcnt: number;
  bidPrice: number;
  midPrice: number;
  askPrice: number;
  impactBidPrice: number;
  impactMidPrice: number;
  impactAskPrice: number;
  hasLiquidity: boolean;
  openInterest: number;
  openValue: number;
  fairMethod: string;
  fairBasisRate: number;
  fairBasis: number;
  fairPrice: number;
  markMethod: string;
  markPrice: number;
  indicativeTaxRate: number;
  indicativeSettlePrice: number;
  optionUnderlyingPrice: number;
  settledPrice: number;
  timestamp: string;
}

// Define interface for BitMEX Trade response
interface BitMEXTrade {
  timestamp: string;
  symbol: string;
  side: string;
  size: number;
  price: number;
  tickDirection: string;
  trdMatchID: string;
  grossValue: number;
  homeNotional: number;
  foreignNotional: number;
}

/**
 * Fetches a specific instrument from BitMEX API
 */
async function fetchBitMEXInstrument(symbol: string): Promise<BitMEXInstrument | null> {
  try {
    const response = await axios.get('https://www.bitmex.com/api/v1/instrument', {
      params: {
        symbol: symbol,
      }
    });
    
    if (response.data && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error(`Error fetching BitMEX instrument ${symbol}:`, error);
    throw error;
  }
}

/**
 * Fetches trades for a specific instrument from the last hour
 */
async function fetchBitMEXTrades(symbol: string): Promise<BitMEXTrade[]> {
  try {
    // Calculate timestamp for 1 hour ago
    const oneHourAgo = new Date();
    oneHourAgo.setMinutes(oneHourAgo.getMinutes() - 120);
    const startTime = oneHourAgo.toISOString();
    
    let allTrades: BitMEXTrade[] = [];
    let startIndex = 0;
    const maxResultsPerPage = 500; // BitMEX API max per request
    let hasMore = true;
    
    // console.log(`Paginating through all trades since ${startTime}...`);
    
    // Loop until we've fetched all trades
    while (hasMore) {
      const response = await axios.get('https://www.bitmex.com/api/v1/trade', {
        params: {
          symbol: symbol,
          startTime: startTime,
          count: maxResultsPerPage,
          start: startIndex,
          reverse: true, // Newest first
        }
      });
      
      const trades = response.data;
      // console.log(`Fetched ${trades.length} trades (page starting at ${startIndex})`);
      
      if (trades.length === 0) {
        hasMore = false;
      } else {
        allTrades = allTrades.concat(trades);
        startIndex += trades.length;
        
        // If we got fewer results than the max, we've reached the end
        if (trades.length < maxResultsPerPage) {
          hasMore = false;
        }
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    
    return allTrades;
  } catch (error) {
    console.error(`Error fetching BitMEX trades for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Fetches all open instruments from BitMEX API
 * @returns Promise with array of open BitMEX instruments
 */
async function fetchOpenBitMEXInstruments(): Promise<BitMEXInstrument[]> {
  try {
    const response = await axios.get('https://www.bitmex.com/api/v1/instrument/active', {
      params: {
        state: 'Open',
        // Optional: can add 'count' parameter to limit results
      }
    });
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error) {
    console.error('Error fetching open BitMEX instruments:', error);
    throw error;
  }
}

/**
 * Main function to fetch and log BitMEX instrument and trades
 */
async function main(symbol: string) {
  try {
    // console.log(`Fetching BitMEX instrument details for ${symbol}...`);
    const instrument = await fetchBitMEXInstrument(symbol);
    
    if (!instrument) {
      console.error(`Instrument ${symbol} not found`);
      return;
    }
    
    // console.log('Instrument details:');
    // console.log(JSON.stringify(instrument, null, 2));
    
    // console.log(`\nFetching trades for ${symbol} from the last hour...`);
    const trades = (await fetchBitMEXTrades(symbol))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    // console.log(`Found ${trades.length} trades in the last hour:`);
    // console.log(JSON.stringify(trades, null, 2));

    const atr = new ATR([14]);
    const rsi = new RSI([14]);
    const bb = new BollingerBands([20, 2]);
    let candleMTS = 0;
    const candleSizeMS = 1000 * 60;
    
    interface Candle {
      open: number;
      high: number;
      low: number;
      close: number;
      timestamp: number;
    }
    
    const candles: Candle[] = [];
    let currentCandle: Candle | null = null;

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
        
        bb.add(price);
        rsi.add(price);
        atr.add(currentCandle);
      } else {
        // Update current candle
        if (currentCandle) {
          currentCandle.high = Math.max(currentCandle.high, price);
          currentCandle.low = Math.min(currentCandle.low, price);
          currentCandle.close = price;

         // atr.update(currentCandle);
        }
        
        bb.update(price);
        rsi.update(price);
      }
    }

    // Push final candle
    if (currentCandle) {
      candles.push(currentCandle);
    }

    console.log('');
    console.log(`${symbol} ${trades[0].timestamp} -> ${trades[trades.length - 1].timestamp}`);
    console.log(`ATR: ${atr._values.slice(14).join(',')}`);
    console.log(`RSI: ${rsi._values.slice(14).join(',')}`);
    console.log(`BB: ${bb._values.slice(20).map((v: any) => Object.keys(v).map(k => `${k[0]}:${v[k]}`).join('|')).join(',')}`);
  } catch (error) {
    console.error('Failed to fetch BitMEX data:', error);
  }
}

/**
 * Gets and prints a list of all open instruments from BitMEX
 */
async function getAndPrintOpenInstruments() {
  try {
    console.log('Fetching all open BitMEX instruments...');
    const openInstruments = await fetchOpenBitMEXInstruments();
    
    console.log(`Found ${openInstruments.length} open instruments:`);
    
    // Print out a summary of the instruments
    openInstruments.forEach(instrument => {
      console.log(`${instrument.symbol} - ${instrument.rootSymbol} - Last Price: ${instrument.lastPrice}`);
    });
    
    // Return just the symbols if needed for further processing
    return openInstruments.map(instrument => instrument.symbol);
  } catch (error) {
    console.error('Failed to fetch open BitMEX instruments:', error);
    return [];
  }
}

const run = async () => {
  // Uncomment the line below to get all open instruments
  const syms = await getAndPrintOpenInstruments();

  // Execute the main function
  for (const sym of syms) {
    if (SYMBOL_OVERRIDE && sym !== SYMBOL_OVERRIDE) {
      continue;
    }

    await main(sym);
  }
}

run();
