# Prometheus - BitMEX Grid Trading Bot

A sophisticated grid trading bot for BitMEX that automatically places buy and sell orders at predetermined price intervals, creating a "grid" of orders. When price moves up or down and hits orders, the bot automatically places new opposite orders, generating profits from price oscillations.

## Features

- **Live Trading**: Place real orders on BitMEX exchange
- **Dry Run Mode**: Test strategies without placing real orders
- **State Persistence**: Trading state is saved to disk using LowDB
- **Automatic Recovery**: Restores state after restart or crashes
- **Real-time Order Management**: Tracks orders and manages fills
- **Profit Tracking**: Monitors P&L, fees, and trading volume
- **Configurable Grid Parameters**: Customize order size, count, and distance

## Prerequisites

- Node.js (v16+)
- npm or yarn
- BitMEX API credentials (for live trading)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/prometheus.git
   cd prometheus
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root with your BitMEX API credentials:
   ```
   BITMEX_API_KEY=your_api_key
   BITMEX_API_SECRET=your_api_secret
   TRADING_SYMBOL=XBTUSD
   DRY_RUN=false
   DATA_DIR=./data
   ```

4. Build the project:
   ```bash
   npm run build
   ```

## Configuration

Edit the following parameters in `src/constants.ts` to customize your grid:

- `ORDER_COUNT`: Number of orders on each side of the grid
- `ORDER_DISTANCE`: Price distance between each grid level
- `ORDER_SIZE`: Size of each order in BTC
- `FEE_RATE`: Trading fee rate in percentage

## Usage

### Dry Run Mode (No real orders)

To run the bot in dry run mode (simulation only):

```bash
npm run dry-run
```

### Live Trading Mode

To run the bot in live trading mode (will place real orders):

```bash
npm start
```

### Viewing Current BitMEX Orders

To view your current open orders on BitMEX:

```bash
npm run print-orders
```

## State Management

The bot persists its state to a JSON file in the data directory (configurable via `DATA_DIR` in `.env`). This includes:

- Active orders
- Completed trades
- Cumulative P&L
- Trading statistics
- Reference price

This allows the bot to recover its state after restarts or crashes.

## Safety Features

- `DRY_RUN` mode for testing without placing real orders
- `ParticipateDoNotInitiate` execution instruction to prevent taking liquidity
- Graceful shutdown handling via SIGINT/SIGTERM signals
- Error handling and reconnection for WebSocket disconnections

## Risk Warning

This software is for educational purposes only. Use at your own risk. Trading cryptocurrencies involves significant risk and can result in the loss of your capital. You should only trade with funds you are willing to lose.

## License

MIT
