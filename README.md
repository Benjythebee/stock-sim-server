# Stock Market Simulation Server

A real-time stock market simulation server built with Bun and TypeScript. This WebSocket-based server provides multi-room trading environments with realistic order book mechanics, AI trading bots, and live market data streaming.

see [Frontend](https://github.com/Benjythebee/stock-sim-ui)

## Features

- 🏢 **Multi-room Support**: Create and manage multiple trading rooms simultaneously
- 📈 **Real-time Order Book**: Complete limit/market order matching with depth visualization
- 🤖 **AI Trading Bots**: Multiple bot strategies (Liquidity, Momentum, Mean Reversion, Random, Informed)
- 📊 **Live Market Data**: Real-time price movements and portfolio tracking
- ⚡ **WebSocket API**: Low-latency communication for real-time trading
- 🎮 **Admin Controls**: Room management with pause/resume and configurable game settings
- 🧪 **Seeded Randomization**: Reproducible market conditions for testing

## Installation

### Prerequisites
- [Bun](https://bun.com) v1.3.0 or later

### Setup
```bash
# Clone the repository
git clone <repository-url>
cd stock-sim-server

# Install dependencies
bun install
```

## Usage

### Development
```bash
# Start with hot reload
bun run dev
```

### Production
```bash
# Build the project
bun run build

# Start the server
bun run start
```

### Direct execution
```bash
# Run directly
bun run src/index.ts
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

## API Endpoints

### HTTP Routes
- `GET /` - Health check endpoint
- `GET /zhealth` - Health status
- `WS /ws/:roomId` - WebSocket connection for specific trading room

### WebSocket Messages

#### Client → Server Messages
```typescript
// Join a trading room
{ type: MessageType.JOIN, roomId: string, id: string }

// Execute a stock trade
{ type: MessageType.STOCK_ACTION, action: 'BUY'|'SELL', orderType: 'LIMIT'|'MARKET', quantity: number, price: number }

// Admin: Toggle pause/resume (admin only)
{ type: MessageType.TOGGLE_PAUSE }

// Admin: Update game settings (admin only)
{ type: MessageType.ADMIN_SETTINGS, settings: Partial<GameSettings> }

// Connection health check
{ type: MessageType.PING }
```

#### Server → Client Messages
```typescript
// Room state updates
{ type: MessageType.ROOM_STATE, paused: boolean, settings: GameSettings, roomId: string, clock: number, clients: number }

// Real-time stock price updates
{ type: MessageType.STOCK_MOVEMENT, price: number, depth: [[number, number][], [number, number][]] }

// Portfolio balance updates
{ type: MessageType.PORTFOLIO_UPDATE, id: string, value: { cash: number, shares: number } }

// Game clock ticks
{ type: MessageType.CLOCK, value: number }

// Health check response
{ type: MessageType.PONG }
```

## Configuration

### Game Settings
```typescript
interface GameSettings {
    initialPrice: number;     // Starting stock price
    seed: number;            // Random seed for reproducibility
    gameDuration: number;    // Game length in minutes
    marketInfluence: number; // How much trading affects price (0-1)
    meanReversion: number;   // Strength of price mean reversion (0-1)
}
```

### Environment Variables
- `PORT` - Server port (default: 3000)

## Trading Bots

The simulation includes several AI trading bot strategies:

- **Liquidity Bot**: Provides market liquidity by placing orders around current price
- **Momentum Bot**: Follows price trends and momentum
- **Mean Reversion Bot**: Trades against price movements, expecting reversion
- **Random Bot**: Makes random trading decisions for market noise
- **Informed Bot**: Has knowledge of intrinsic value for realistic informed trading

## Architecture

### Core Components
- **Room Manager**: Handles multiple trading room instances
- **Simulator**: Manages market simulation, bots, and price generation
- **Order Book**: Real-time order matching and execution
- **Price Generator**: Realistic stock price movements with configurable parameters
- **WebSocket Server**: Real-time client communication

### File Structure
```
src/
├── index.ts              # Main server entry point
├── types.ts              # TypeScript type definitions
└── lib/
    ├── bot.ts            # AI trading bot implementations
    ├── client.ts         # Client connection management
    ├── orderBookWrapper.ts # Order book abstraction
    ├── priceGenerator.ts # Stock price simulation
    ├── room.ts           # Trading room logic
    ├── roomManager.ts    # Multi-room management
    ├── simulator.ts      # Core market simulation
    └── utils/            # Utility functions
```

## Testing

A test HTML client is provided in `test/simulator.html` for:
- Real-time price visualization
- Order book depth display
- Portfolio tracking
- WebSocket connection testing

Open `test/simulator.html` in a browser after starting the server to monitor market activity.

## Dependencies

- **nodejs-order-book**: High-performance order book implementation
- **Bun**: Fast JavaScript runtime and build tool
- **TypeScript**: Type-safe JavaScript development

## Development

This project uses:
- **TypeScript** for type safety
- **Bun** for fast execution and hot reloading
- **WebSocket** for real-time communication
- **Modular architecture** for maintainability

### Scripts
- `bun run dev` - Development with hot reload
- `bun run build` - Production build
- `bun run start` - Start production server

## License

MIT License
