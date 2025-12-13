// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "./ChatRoom.sol";

/**
 * @title ChatRoomFactory
 * @notice Factory contract for deploying ChatRoom instances
 */
contract ChatRoomFactory {
    // ============ State ============
    
    address[] public rooms;
    mapping(address => bool) public isRoom;
    
    // ============ Events ============
    
    event RoomCreated(
        address indexed roomAddress,
        string name,
        address indexed owner,
        uint256 timestamp
    );
    
    // ============ Functions ============
    
    /**
     * @notice Create a new chat room
     * @param _name Name of the room
     * @param _initialAllowList Initial addresses to allow (can be empty for open rooms)
     * @return roomAddress Address of the newly created room
     */
    function createRoom(
        string calldata _name,
        address[] calldata _initialAllowList
    ) external returns (address roomAddress) {
        ChatRoom room = new ChatRoom(_name, msg.sender, _initialAllowList);
        roomAddress = address(room);
        
        rooms.push(roomAddress);
        isRoom[roomAddress] = true;
        
        emit RoomCreated(roomAddress, _name, msg.sender, block.timestamp);
    }
    
    /**
     * @notice Get all room addresses
     * @return Array of room addresses
     */
    function getAllRooms() external view returns (address[] memory) {
        return rooms;
    }
    
    /**
     * @notice Get total number of rooms
     * @return Number of rooms created
     */
    function getRoomCount() external view returns (uint256) {
        return rooms.length;
    }
}

