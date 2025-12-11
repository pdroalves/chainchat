# ChainChat 🔐💬

Encrypted blockchain chat rooms powered by Zama's fhEVM (Fully Homomorphic Encryption Virtual Machine).

## Features

- **🔐 End-to-End Encrypted Messages**: Messages are encrypted using FHE before being stored on-chain
- **💬 Chat Rooms**: Create and join encrypted chat rooms as smart contracts
- **👛 Wallet-Based Identity**: Sign in with your Ethereum wallet, optional aliases
- **📋 Allow Lists**: Room owners control who can join
- **🚫 Ban/Unban**: Room owners can ban malicious users
- **⛓️ Fully On-Chain**: All data stored on Ethereum (Sepolia testnet)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js UI    │────▶│  fhEVM SDK      │────▶│  ChatRoom.sol   │
│   (RainbowKit)  │     │  (Encryption)   │     │  (FHE Storage)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  FHE Coprocessor│
                                                │  (Decryption)   │
                                                └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js v18+
- pnpm (`npm install -g pnpm`)
- MetaMask browser extension
- Sepolia testnet ETH

### Installation

```bash
# Clone and install
git clone <repo>
cd ChainChat
git submodule update --init --recursive
pnpm install
```

### Environment Setup

Create `.env.local` in `packages/nextjs/`:

```env
NEXT_PUBLIC_FACTORY_ADDRESS=0xa4b6cf76B95340cf91E7D7B1fEf3c925087aE965
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_key
```

### Running Locally

```bash
# Start the frontend
pnpm start

# Open http://localhost:3000
```

### Deploy Your Own Contracts

```bash
# Set up Hardhat vars
cd packages/hardhat
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY

# Deploy to Sepolia
pnpm deploy:sepolia
```

## Contracts

| Contract | Address (Sepolia) |
|----------|-------------------|
| ChatRoomFactory | `0xa4b6cf76B95340cf91E7D7B1fEf3c925087aE965` |

### ChatRoomFactory

Factory contract that deploys new chat rooms.

```solidity
function createRoom(string name, address[] initialAllowList) returns (address)
function getAllRooms() returns (address[])
function getRoomsByOwner(address owner) returns (address[])
```

### ChatRoom

Individual encrypted chat room contract.

```solidity
// Encrypted messaging
function sendMessage(externalEuint8[] encryptedInputs, bytes inputProof, string alias)
function getMessageChunk(uint messageId, uint chunkIndex) returns (euint8)

// Room management
function joinRoom()
function addToAllowList(address[] addresses)
function banUser(address user)
function destroyRoom()
```

## How FHE Encryption Works

1. **Encrypt**: User types message → fhEVM SDK encrypts each byte → `euint8[]` array
2. **Store**: Encrypted chunks stored on-chain with `FHE.allow()` permissions
3. **Decrypt**: Authorized users request decryption via FHE Gateway
4. **Display**: Decrypted message displayed only to permitted users

## Tech Stack

- **Frontend**: Next.js 15, RainbowKit, Tailwind CSS
- **Contracts**: Solidity 0.8.27, Hardhat, fhEVM
- **FHE**: Zama fhEVM, @fhevm/solidity
- **Package Manager**: pnpm monorepo

## Project Structure

```
ChainChat/
├── packages/
│   ├── hardhat/           # Smart contracts
│   │   ├── contracts/
│   │   │   ├── ChatRoom.sol
│   │   │   └── ChatRoomFactory.sol
│   │   └── deploy/
│   ├── fhevm-sdk/         # Zama FHE SDK
│   └── nextjs/            # Frontend
│       ├── app/
│       ├── hooks/chainchat/
│       └── components/
└── README.md
```

## License

GPL-3.0 - See [LICENSE](LICENSE)

## Credits

Built with [Zama's fhEVM](https://github.com/zama-ai/fhevm) for confidential smart contracts.
