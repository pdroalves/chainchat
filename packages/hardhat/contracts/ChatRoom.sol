// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

/**
 * @title ChatRoom
 * @notice FHE-encrypted chat room for ChainChat
 * @dev Messages are stored encrypted on-chain using fhEVM
 */
contract ChatRoom {
    // ============ Structs ============

    struct Message {
        address sender;
        string senderAlias;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 chunkCount;
    }

    struct UserInfo {
        bool isAllowed;
        bool isBanned;
        uint256 joinedAt;
        string currentAlias;
    }

    // ============ State Variables ============

    string public name;
    address public owner;
    bool public isDestroyed;
    bool public isOpenJoin = true;
    uint256 public createdAt;
    uint256 public messageCount;

    Message[] internal messages;
    // messageId => chunkIndex => encrypted 32-byte chunk
    mapping(uint256 => mapping(uint256 => euint256)) internal messageChunks;

    mapping(address => UserInfo) public users;
    mapping(address => uint256) public decryptAccessCursor;
    address[] public memberList;
    address[] public allowList;

    // ============ Events ============

    event MessageSent(
        uint256 indexed messageId,
        address indexed sender,
        string senderAlias,
        uint256 chunkCount,
        uint256 blockNumber,
        uint256 timestamp
    );

    event UserJoined(address indexed user, uint256 timestamp);
    event UserLeft(address indexed user, uint256 timestamp);
    event UserBanned(address indexed user, address indexed bannedBy, uint256 timestamp);
    event UserUnbanned(address indexed user, address indexed unbannedBy, uint256 timestamp);
    event AllowListUpdated(address indexed user, bool allowed, uint256 timestamp);
    event RoomDestroyed(address indexed destroyer, uint256 timestamp);
    event AliasUpdated(address indexed user, string newAlias, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event JoinModeUpdated(bool openJoin, uint256 timestamp);
    event DecryptAccessGranted(address indexed user, uint256 startMessageId, uint256 endMessageId, uint256 timestamp);
    event RoomRenamed(string oldName, string newName, uint256 timestamp);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "ChatRoom: caller is not owner");
        _;
    }

    modifier onlyMember() {
        require(users[msg.sender].joinedAt > 0 && !users[msg.sender].isBanned, "ChatRoom: not a member");
        _;
    }

    modifier notDestroyed() {
        require(!isDestroyed, "ChatRoom: room is destroyed");
        _;
    }

    // ============ Constructor ============

    constructor(string memory _name, address _owner, address[] memory _initialAllowList) {
        name = _name;
        owner = _owner;
        createdAt = block.timestamp;

        users[_owner] = UserInfo({
            isAllowed: true,
            isBanned: false,
            joinedAt: block.timestamp,
            currentAlias: ""
        });
        memberList.push(_owner);
        allowList.push(_owner);

        for (uint256 i = 0; i < _initialAllowList.length; i++) {
            address user = _initialAllowList[i];
            if (user != _owner && !users[user].isAllowed) {
                users[user].isAllowed = true;
                allowList.push(user);
            }
        }
    }

    // ============ Public Functions ============

    function joinRoom() external notDestroyed {
        require(!users[msg.sender].isBanned, "ChatRoom: user is banned");
        require(users[msg.sender].joinedAt == 0, "ChatRoom: already a member");
        
        if (!isOpenJoin) {
            require(users[msg.sender].isAllowed, "ChatRoom: not on allowlist");
        }

        users[msg.sender].joinedAt = block.timestamp;
        if (!users[msg.sender].isAllowed) {
            users[msg.sender].isAllowed = true;
            allowList.push(msg.sender);
        }
        memberList.push(msg.sender);
        
        // Grant access to future messages
        decryptAccessCursor[msg.sender] = messageCount;

        emit UserJoined(msg.sender, block.timestamp);
    }

    function sendMessage(
        externalEuint256[] calldata encryptedHandles,
        bytes calldata inputProof,
        string calldata senderAlias
    ) external onlyMember notDestroyed {
        // Each chunk is 32 bytes (euint256), max 32 chunks = 1KB max message
        require(encryptedHandles.length > 0 && encryptedHandles.length <= 32, "ChatRoom: invalid chunk count");

        uint256 msgId = messageCount;
        uint256 chunkCount = encryptedHandles.length;

        // Store encrypted chunks
        for (uint256 i = 0; i < chunkCount; i++) {
            euint256 chunk = FHE.fromExternal(encryptedHandles[i], inputProof);
            messageChunks[msgId][i] = chunk;
            // Grant decrypt access to all current members
            for (uint256 j = 0; j < memberList.length; j++) {
                address member = memberList[j];
                if (!users[member].isBanned) {
                    FHE.allow(chunk, member);
                }
            }
        }

        string memory _alias;
        if (bytes(senderAlias).length > 0) {
            _alias = senderAlias;
        } else {
            _alias = users[msg.sender].currentAlias;
        }
        messages.push(Message({
            sender: msg.sender,
            senderAlias: _alias,
            timestamp: block.timestamp,
            blockNumber: block.number,
            chunkCount: chunkCount
        }));

        messageCount++;

        emit MessageSent(msgId, msg.sender, senderAlias, chunkCount, block.number, block.timestamp);
    }

    function setAlias(string calldata newAlias) external onlyMember {
        require(bytes(newAlias).length <= 32, "ChatRoom: alias too long");
        users[msg.sender].currentAlias = newAlias;
        emit AliasUpdated(msg.sender, newAlias, block.timestamp);
    }

    // ============ Owner Functions ============

    function setName(string calldata newName) external onlyOwner notDestroyed {
        require(bytes(newName).length > 0 && bytes(newName).length <= 64, "ChatRoom: invalid name length");
        string memory oldName = name;
        name = newName;
        emit RoomRenamed(oldName, newName, block.timestamp);
    }

    function setJoinMode(bool openJoin) external onlyOwner notDestroyed {
        isOpenJoin = openJoin;
        emit JoinModeUpdated(openJoin, block.timestamp);
    }

    function addToAllowList(address[] calldata addresses) external onlyOwner notDestroyed {
        for (uint256 i = 0; i < addresses.length; i++) {
            address user = addresses[i];
            if (!users[user].isAllowed) {
                users[user].isAllowed = true;
                allowList.push(user);
                emit AllowListUpdated(user, true, block.timestamp);
            }
        }
    }

    function removeFromAllowList(address[] calldata addresses) external onlyOwner {
        for (uint256 i = 0; i < addresses.length; i++) {
            address user = addresses[i];
            if (user != owner && users[user].isAllowed) {
                users[user].isAllowed = false;
                emit AllowListUpdated(user, false, block.timestamp);
            }
        }
    }

    function banUser(address user) external onlyOwner {
        require(user != owner, "ChatRoom: cannot ban owner");
        require(!users[user].isBanned, "ChatRoom: already banned");

        users[user].isBanned = true;
        emit UserBanned(user, msg.sender, block.timestamp);
    }

    function unbanUser(address user) external onlyOwner {
        require(users[user].isBanned, "ChatRoom: not banned");

        users[user].isBanned = false;
        emit UserUnbanned(user, msg.sender, block.timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ChatRoom: invalid address");
        require(newOwner != owner, "ChatRoom: already owner");

        if (!users[newOwner].isAllowed) {
            users[newOwner].isAllowed = true;
            allowList.push(newOwner);
        }

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function destroyRoom() external onlyOwner {
        isDestroyed = true;
        emit RoomDestroyed(msg.sender, block.timestamp);
    }

    /**
     * @notice Grant decrypt access for historical messages in chunks (retroactive access).
     * @dev Requires a transaction because it updates FHE permissions. Call repeatedly until cursor reaches messageCount.
     * @param startMessageId Must equal the caller's current cursor.
     * @param messageCountToProcess Number of messages to process in this call (bounded).
     * @return newCursor The updated cursor (endMessageId).
     */
    function grantDecryptAccess(uint256 startMessageId, uint256 messageCountToProcess) external onlyMember returns (uint256 newCursor) {
        require(decryptAccessCursor[msg.sender] == startMessageId, "ChatRoom: must start from cursor");
        
        uint256 endMessageId = startMessageId + messageCountToProcess;
        if (endMessageId > messageCount) {
            endMessageId = messageCount;
        }
        
        for (uint256 i = startMessageId; i < endMessageId; i++) {
            uint256 chunkCount = messages[i].chunkCount;
            for (uint256 j = 0; j < chunkCount; j++) {
                FHE.allow(messageChunks[i][j], msg.sender);
            }
        }
        
        decryptAccessCursor[msg.sender] = endMessageId;
        emit DecryptAccessGranted(msg.sender, startMessageId, endMessageId, block.timestamp);
        
        return endMessageId;
    }

    // ============ View Functions ============

    function getRoomInfo() external view returns (
        string memory _name,
        address _owner,
        uint256 _memberCount,
        uint256 _messageCount,
        uint256 _createdAt,
        bool _isDestroyed
    ) {
        return (name, owner, memberList.length, messageCount, createdAt, isDestroyed);
    }

    function getUserInfo(address user) external view returns (
        bool _isAllowed,
        bool _isBanned,
        uint256 _joinedAt,
        string memory _currentAlias
    ) {
        UserInfo storage info = users[user];
        return (info.isAllowed, info.isBanned, info.joinedAt, info.currentAlias);
    }

    function getMembers() external view returns (address[] memory) {
        return memberList;
    }

    function getAllowList() external view returns (address[] memory) {
        return allowList;
    }

    function getMessage(uint256 messageId) external view returns (
        address sender,
        string memory senderAlias,
        uint256 timestamp,
        uint256 blockNumber,
        uint256 chunkCount
    ) {
        require(messageId < messageCount, "ChatRoom: invalid message id");
        Message storage msg_ = messages[messageId];
        return (msg_.sender, msg_.senderAlias, msg_.timestamp, msg_.blockNumber, msg_.chunkCount);
    }

    function getMessageRange(uint256 startId, uint256 count) external view returns (
        address[] memory senders,
        string[] memory aliases,
        uint256[] memory timestamps,
        uint256[] memory blockNumbers,
        uint256[] memory chunkCounts
    ) {
        uint256 endId = startId + count;
        if (endId > messageCount) endId = messageCount;
        uint256 len = endId - startId;

        senders = new address[](len);
        aliases = new string[](len);
        timestamps = new uint256[](len);
        blockNumbers = new uint256[](len);
        chunkCounts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            Message storage msg_ = messages[startId + i];
            senders[i] = msg_.sender;
            aliases[i] = msg_.senderAlias;
            timestamps[i] = msg_.timestamp;
            blockNumbers[i] = msg_.blockNumber;
            chunkCounts[i] = msg_.chunkCount;
        }
    }

    function getMessageChunk(uint256 messageId, uint256 chunkIndex) external view returns (euint256) {
        require(messageId < messageCount, "ChatRoom: invalid message id");
        require(chunkIndex < messages[messageId].chunkCount, "ChatRoom: invalid chunk index");
        return messageChunks[messageId][chunkIndex];
    }

    function getMessageHandlesRange(uint256 startId, uint256 count) external view returns (
        euint256[] memory handles,
        uint256[] memory chunkCounts
    ) {
        uint256 endId = startId + count;
        if (endId > messageCount) endId = messageCount;
        uint256 len = endId - startId;

        // Count total chunks
        uint256 totalChunks = 0;
        chunkCounts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            chunkCounts[i] = messages[startId + i].chunkCount;
            totalChunks += chunkCounts[i];
        }

        handles = new euint256[](totalChunks);
        uint256 idx = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 msgId = startId + i;
            uint256 cc = messages[msgId].chunkCount;
            for (uint256 j = 0; j < cc; j++) {
                handles[idx++] = messageChunks[msgId][j];
            }
        }
    }
}

