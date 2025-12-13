# ChainChat constraints and spec

## Summary

ChainChat is an Ethereum dApp for creating and using confidential, blockchain-based chat rooms. Users do not create accounts: they connect with an Ethereum wallet (signature-based identity). Each chat room is a deployed smart contract; the room contract address is the invite.

Confidentiality is provided via Zama fhEVM: messages are stored on-chain as encrypted data, and only authorized wallets can decrypt.

## Key concepts

- **Factory contract**: a `ChatRoomFactory` contract is referenced by the UI and deploys new `ChatRoom` contracts.
- **Chat room contract**: each room is its own deployed `ChatRoom` contract that stores messages + metadata.
- **Identity**: wallet address is the primary identity and must always be visible/available.
- **Alias**: alias is stored on-chain (per-user current alias and per-message snapshot).
- **Confidential messages**: message content is stored encrypted (FHE) and decrypted client-side for authorized wallets.

## User stories

### Browse rooms
- As a user, I can see a list of rooms and their metadata (name, members, message count).
- As a user, I can click a room to open it.

### Create room
- As a user, I can create a room by entering a name and confirming a transaction.
- As a creator, I get the contract address for the room (invite/share).

### Join room (membership)
- As a user, I can join a room.
- Rooms are **open-join by default**.
- Owners can switch a room to **invite-only** mode (allowlist-gated).

### Send messages
- As a member, I can send a message.
- The UI shows the message as **pending** until it is mined.
- After it is mined, the message becomes visible to other users.

### Read messages (decrypt)
- As a member, I can read messages in plaintext.
- Messages are fetched as ciphertext handles and decrypted for display.
- Decryption must be:
  - **batched** (avoid per-byte/per-message decryption calls)
  - **cached in-memory** for the browser session (do not decrypt handles already shown)
  - **progressive** (decrypt what’s needed; avoid rework)

### Retroactive access (required)
- When a user joins a room, they should be able to decrypt **past messages**.
- Because the room contract can only grant decrypt permissions via transactions, retroactive access must be implemented with a **progressive “grant decrypt access”** flow that can be executed in chunks.

### Owner controls
- As the room owner, I can:
  - Toggle room join mode (open vs invite-only).
  - Manage allowlist (add/remove).
  - Destroy the room.

## Membership and access rules

- Default room join mode: **open join**.
- Invite-only join mode: only allowlisted wallets can join.
- Joining makes the wallet a “member” (allowed to send messages, and eligible to decrypt).
- **Retroactive decrypt access** is granted progressively after join (in chunks), so historical messages can be decrypted.

## Data model (on-chain)

### Message metadata (public)
- sender address
- chunk count
- timestamp
- block number
- sender alias (snapshot)

### Message content (confidential)
- encrypted bytes stored as ciphertext handles (e.g., `euint8` → ABI as `bytes32` handles)

### Per-user fields (public)
- joinedAt
- currentAlias
- membership flags (allowed/invite-only eligibility)

## Blockchain UX requirements

### Next block expectation
- UI must show a next-block expectation (countdown-ish) based on the observed block cadence.

### Auto-refresh on new blocks
- When a new block is mined, the UI must automatically refresh room state:
  - new messages
  - updated counts
  - transition pending → committed where applicable

### Pending messages
- Messages sent by the current user must be visually distinguished until mined.

## Non-goals (MVP)

- **Ban with cryptographic revocation** of historical decrypt access is deferred as future work (revocation is not supported by a simple FHE allow model and would require expensive re-encryption/rotation or a different design).


