"use client";

import { useCallback, useState } from "react";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import { useFHEEncryption } from "@fhevm-sdk";
import { FhevmInstance } from "@fhevm-sdk";
import { ethers } from "ethers";
import { useReadContract, useWriteContract } from "wagmi";

// ChatRoomFactory ABI (minimal)
const FACTORY_ABI = [
  {
    inputs: [
      { name: "_name", type: "string" },
      { name: "_initialAllowList", type: "address[]" },
    ],
    name: "createRoom",
    outputs: [{ name: "roomAddress", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllRooms",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "getRoomsByOwner",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRoomCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "roomAddress", type: "address" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
    name: "RoomCreated",
    type: "event",
  },
] as const;

// ChatRoom ABI
export const CHATROOM_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isDestroyed",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "messageCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRoomInfo",
    outputs: [
      { name: "roomName", type: "string" },
      { name: "roomOwner", type: "address" },
      { name: "memberCount", type: "uint256" },
      { name: "msgCount", type: "uint256" },
      { name: "created", type: "uint256" },
      { name: "destroyed", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMembers",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserInfo",
    outputs: [
      { name: "isAllowed", type: "bool" },
      { name: "isBanned", type: "bool" },
      { name: "joinedAt", type: "uint256" },
      { name: "currentAlias", type: "string" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "messageId", type: "uint256" }],
    name: "getMessageMetadata",
    outputs: [
      { name: "sender", type: "address" },
      { name: "chunkCount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
      { name: "senderAlias", type: "string" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "startId", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    name: "getMessageRange",
    outputs: [
      { name: "senders", type: "address[]" },
      { name: "chunkCounts", type: "uint256[]" },
      { name: "timestamps", type: "uint256[]" },
      { name: "blockNumbers", type: "uint256[]" },
      { name: "aliases", type: "string[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "messageId", type: "uint256" },
      { name: "chunkIndex", type: "uint256" },
    ],
    name: "getMessageChunk",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "joinRoom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "encryptedInputs", type: "bytes32[]" },
      { name: "inputProof", type: "bytes" },
      { name: "senderAlias", type: "string" },
    ],
    name: "sendMessage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "newAlias", type: "string" }],
    name: "setAlias",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "addresses", type: "address[]" }],
    name: "addToAllowList",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "banUser",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "destroyRoom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

interface RoomInfo {
  address: string;
  name: string;
  owner: string;
  memberCount: number;
  messageCount: number;
  createdAt: number;
  isDestroyed: boolean;
}

export const useChatRoomFactory = (factoryAddress: string | undefined) => {
  const { ethersSigner, ethersReadonlyProvider, accounts } = useWagmiEthers({});
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");

  // Read all rooms
  const { data: allRooms, refetch: refetchRooms } = useReadContract({
    address: factoryAddress as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getAllRooms",
    query: { enabled: !!factoryAddress },
  });

  // Read rooms by owner
  const { data: myRooms, refetch: refetchMyRooms } = useReadContract({
    address: factoryAddress as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getRoomsByOwner",
    args: accounts?.[0] ? [accounts[0] as `0x${string}`] : undefined,
    query: { enabled: !!factoryAddress && !!accounts?.[0] },
  });

  // Create room
  const createRoom = useCallback(
    async (name: string, initialAllowList: string[] = []) => {
      if (!ethersSigner || !factoryAddress) {
        setMessage("No signer available");
        return null;
      }

      setIsCreating(true);
      setMessage("Creating room...");

      try {
        const contract = new ethers.Contract(factoryAddress, FACTORY_ABI, ethersSigner);
        const tx = await contract.createRoom(name, initialAllowList);
        setMessage("Waiting for confirmation...");
        const receipt = await tx.wait();

        // Find RoomCreated event
        const event = receipt.logs.find((log: any) => {
          try {
            const parsed = contract.interface.parseLog(log);
            return parsed?.name === "RoomCreated";
          } catch {
            return false;
          }
        });

        if (event) {
          const parsed = contract.interface.parseLog(event);
          const roomAddress = parsed?.args?.roomAddress;
          setMessage(`Room created: ${roomAddress}`);
          refetchRooms();
          refetchMyRooms();
          return roomAddress;
        }

        setMessage("Room created but address not found in logs");
        return null;
      } catch (err) {
        setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [ethersSigner, factoryAddress, refetchRooms, refetchMyRooms]
  );

  // Get room info
  const getRoomInfo = useCallback(
    async (roomAddress: string): Promise<RoomInfo | null> => {
      if (!ethersReadonlyProvider) return null;

      try {
        const contract = new ethers.Contract(roomAddress, CHATROOM_ABI, ethersReadonlyProvider);
        const info = await contract.getRoomInfo();
        return {
          address: roomAddress,
          name: info[0],
          owner: info[1],
          memberCount: Number(info[2]),
          messageCount: Number(info[3]),
          createdAt: Number(info[4]) * 1000,
          isDestroyed: info[5],
        };
      } catch (err) {
        console.error("Failed to get room info:", err);
        return null;
      }
    },
    [ethersReadonlyProvider]
  );

  return {
    allRooms: (allRooms as string[]) || [],
    myRooms: (myRooms as string[]) || [],
    createRoom,
    getRoomInfo,
    isCreating,
    message,
    refetchRooms,
  };
};

