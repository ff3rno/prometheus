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
- **Automatic grid creation and management**
- **Real-time trade tracking via BitMEX WebSocket API**
- **Order execution and fill tracking**
- **State persistence for seamless restarts**
- **Dry run mode for testing without real orders**
- **Metrics tracking with InfluxDB 3**

## Prerequisites

- Node.js (v16+)
- npm or yarn
- BitMEX API credentials (for live trading)

## Configuration

Edit the following parameters in `src/constants.ts` to customize your grid:

- `ORDER_COUNT`: Number of orders on each side of the grid
- `ORDER_DISTANCE`: Price distance between each grid level
- `ORDER_SIZE`: Size of each order in BTC
- `FEE_RATE`: Trading fee rate in percentage

Create a `.env` file with the following variables:

```
# BitMEX API credentials
BITMEX_API_KEY=your_api_key
BITMEX_API_SECRET=your_api_secret
TRADING_SYMBOL=XBTUSD

# Optional: Run in dry-run mode (no real orders)
DRY_RUN=false

# Optional: Data directory for state persistence
DATA_DIR=./data

# InfluxDB Metrics (optional)
INFLUX_ENABLED=true
INFLUX_HOST=http://localhost:8086
INFLUX_TOKEN=your_influx_token
INFLUX_DATABASE=prometheus_grid
```

## InfluxDB Metrics Integration

The bot can track trading metrics in InfluxDB 3, including:

- Round-trip trade profits
- Order execution fees
- Trading volume
- Overall grid performance

### Setting up InfluxDB 3

1. Install InfluxDB 3 following the instructions at https://docs.influxdata.com/influxdb/v3/

2. Create a token with appropriate permissions:
   ```
   influx auth create \
     --name "prometheus-bot" \
     --description "Token for Prometheus grid trading bot" \
     --org your-org
   ```

3. Create a database (bucket):
   ```
   influx bucket create --name prometheus_grid --org your-org
   ```

4. Configure the bot with your InfluxDB credentials in the `.env` file:
   ```
   INFLUX_ENABLED=true
   INFLUX_HOST=http://localhost:8086
   INFLUX_TOKEN=your_influx_token
   INFLUX_DATABASE=prometheus_grid
   ```

### Available Metrics

The bot tracks the following metrics in InfluxDB:

1. **Trade Metrics** (measurement: `trade`)
   - `profit`: Net profit/loss from completed round-trip trades
   - `fees`: Total fees paid for the trade
   - `volume`: Trading volume in BTC
   - `entry_price`: Price at which the position was entered
   - `exit_price`: Price at which the position was exited

2. **Order Execution Metrics** (measurement: `order`)
   - `price`: Execution price
   - `size`: Order size in BTC
   - `fee`: Fee for this order
   - `notional_value`: USD value of the order

3. **Volume Metrics** (measurement: `volume`)
   - `size`: Volume in BTC
   - `notional_value`: USD value of the volume

4. **Grid Statistics** (measurement: `grid_stats`)
   - `total_profit`: Cumulative profit/loss
   - `total_orders`: Total number of orders
   - `buy_orders`: Number of buy orders
   - `sell_orders`: Number of sell orders
   - `total_fees`: Total fees paid

### Visualizing Metrics

You can visualize these metrics using the InfluxDB UI or by connecting tools like Grafana.

Example InfluxDB query to view all trade profits:
```sql
SELECT profit, fees, volume, entry_price, exit_price 
FROM trade 
WHERE time > now() - 7d
```

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

3. Build the project:
   ```bash
   npm run build
   ```

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
