"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import { CHATROOM_ABI } from "./useChatRoomFactory";
import { FhevmInstance, useFHEDecrypt, useFHEEncryption, useInMemoryStorage } from "@fhevm-sdk";
import { ethers } from "ethers";
import { useReadContract } from "wagmi";

interface Message {
  id: number;
  sender: string;
  senderAlias: string;
  chunkCount: number;
  timestamp: number;
  blockNumber: number;
  content?: string;
  isDecrypting?: boolean;
}

interface UserInfo {
  isAllowed: boolean;
  isBanned: boolean;
  joinedAt: number;
  currentAlias: string;
}

interface RoomInfo {
  name: string;
  owner: string;
  memberCount: number;
  messageCount: number;
  createdAt: number;
  isDestroyed: boolean;
}

export const useChatRoom = (params: {
  roomAddress: string | undefined;
  instance: FhevmInstance | undefined;
}) => {
  const { roomAddress, instance } = params;
  const { ethersSigner, ethersReadonlyProvider, accounts, chainId } = useWagmiEthers({});
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingMessages, setPendingMessages] = useState<{ id: string; content: string }[]>([]);

  const userAddress = accounts?.[0];

  // Get contract instance
  const getContract = useCallback(
    (mode: "read" | "write") => {
      if (!roomAddress) return undefined;
      const providerOrSigner = mode === "read" ? ethersReadonlyProvider : ethersSigner;
      if (!providerOrSigner) return undefined;
      return new ethers.Contract(roomAddress, CHATROOM_ABI, providerOrSigner);
    },
    [roomAddress, ethersReadonlyProvider, ethersSigner]
  );

  // Fetch room info
  const fetchRoomInfo = useCallback(async () => {
    const contract = getContract("read");
    if (!contract) return;

    try {
      const info = await contract.getRoomInfo();
      setRoomInfo({
        name: info[0],
        owner: info[1],
        memberCount: Number(info[2]),
        messageCount: Number(info[3]),
        createdAt: Number(info[4]) * 1000,
        isDestroyed: info[5],
      });
    } catch (err) {
      console.error("Failed to fetch room info:", err);
    }
  }, [getContract]);

  // Fetch user info
  const fetchUserInfo = useCallback(async () => {
    const contract = getContract("read");
    if (!contract || !userAddress) return;

    try {
      const info = await contract.getUserInfo(userAddress);
      setUserInfo({
        isAllowed: info[0],
        isBanned: info[1],
        joinedAt: Number(info[2]) * 1000,
        currentAlias: info[3],
      });
    } catch (err) {
      console.error("Failed to fetch user info:", err);
    }
  }, [getContract, userAddress]);

  // Fetch members
  const fetchMembers = useCallback(async () => {
    const contract = getContract("read");
    if (!contract) return;

    try {
      const memberList = await contract.getMembers();
      setMembers(memberList);
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
  }, [getContract]);

  // Fetch messages (metadata only - content is encrypted)
  const fetchMessages = useCallback(async () => {
    const contract = getContract("read");
    if (!contract || !roomInfo) return;

    try {
      const count = roomInfo.messageCount;
      if (count === 0) {
        setMessages([]);
        return;
      }

      const range = await contract.getMessageRange(0, count);
      const msgs: Message[] = [];

      for (let i = 0; i < range[0].length; i++) {
        msgs.push({
          id: i,
          sender: range[0][i],
          chunkCount: Number(range[1][i]),
          timestamp: Number(range[2][i]) * 1000,
          blockNumber: Number(range[3][i]),
          senderAlias: range[4][i],
          content: "[🔐 Encrypted]",
        });
      }

      setMessages(msgs);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, [getContract, roomInfo]);

  // Join room
  const joinRoom = useCallback(async () => {
    const contract = getContract("write");
    if (!contract) {
      setMessage("No signer available");
      return false;
    }

    setIsJoining(true);
    setMessage("Joining room...");

    try {
      const tx = await contract.joinRoom();
      await tx.wait();
      setMessage("Joined room!");
      await fetchUserInfo();
      await fetchMembers();
      return true;
    } catch (err) {
      setMessage(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsJoining(false);
    }
  }, [getContract, fetchUserInfo, fetchMembers]);

  // Send message (with FHE encryption)
  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: ethersSigner as any,
    contractAddress: roomAddress,
  });

  const sendMessage = useCallback(
    async (content: string, alias: string = "") => {
      const contract = getContract("write");
      if (!contract || !instance) {
        setMessage("Not ready to send");
        return false;
      }

      if (!content.trim()) {
        setMessage("Message cannot be empty");
        return false;
      }

      setIsSending(true);
      const pendingId = `pending-${Date.now()}`;
      setPendingMessages((prev) => [...prev, { id: pendingId, content }]);
      setMessage("Encrypting message...");

      try {
        // Convert message to bytes and encrypt each byte
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);

        if (bytes.length > 256) {
          setMessage("Message too long (max 256 characters)");
          return false;
        }

        // Encrypt using FHE
        const encrypted = await encryptWith((builder) => {
          for (let i = 0; i < bytes.length; i++) {
            (builder as any).add8(bytes[i]);
          }
        });

        if (!encrypted) {
          setMessage("Encryption failed");
          return false;
        }

        setMessage("Sending transaction...");
        const tx = await contract.sendMessage(encrypted.handles, encrypted.inputProof, alias);
        await tx.wait();

        setMessage("Message sent!");
        setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
        await fetchRoomInfo();
        await fetchMessages();
        return true;
      } catch (err) {
        setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [getContract, instance, encryptWith, fetchRoomInfo, fetchMessages]
  );

  // Set alias
  const setAlias = useCallback(
    async (newAlias: string) => {
      const contract = getContract("write");
      if (!contract) return false;

      try {
        const tx = await contract.setAlias(newAlias);
        await tx.wait();
        await fetchUserInfo();
        await fetchMembers();
        return true;
      } catch (err) {
        setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    [getContract, fetchUserInfo, fetchMembers]
  );

  // Decrypt a message (requires FHE Gateway)
  const decryptMessage = useCallback(
    async (messageId: number): Promise<string | null> => {
      const contract = getContract("read");
      if (!contract || !instance) return null;

      try {
        // Get message metadata
        const meta = await contract.getMessageMetadata(messageId);
        const chunkCount = Number(meta[1]);

        // Get all encrypted chunks
        const chunks: string[] = [];
        for (let i = 0; i < chunkCount; i++) {
          const chunk = await contract.getMessageChunk(messageId, i);
          chunks.push(chunk);
        }

        // Decryption would go through the FHE Gateway
        // For now, return placeholder
        setMessage("Decryption requires FHE Gateway integration");
        return null;
      } catch (err) {
        console.error("Decrypt error:", err);
        return null;
      }
    },
    [getContract, instance]
  );

  // Initial load
  useEffect(() => {
    const load = async () => {
      if (!roomAddress) return;
      setIsLoading(true);
      await fetchRoomInfo();
      await fetchUserInfo();
      await fetchMembers();
      setIsLoading(false);
    };
    load();
  }, [roomAddress, fetchRoomInfo, fetchUserInfo, fetchMembers]);

  // Load messages after room info
  useEffect(() => {
    if (roomInfo) {
      fetchMessages();
    }
  }, [roomInfo, fetchMessages]);

  const isMember = userInfo?.joinedAt && userInfo.joinedAt > 0;
  const canJoin = userInfo?.isAllowed && !userInfo?.isBanned && !isMember;
  const isOwner = roomInfo?.owner?.toLowerCase() === userAddress?.toLowerCase();

  return {
    roomInfo,
    messages,
    members,
    userInfo,
    isLoading,
    isSending,
    isJoining,
    message,
    pendingMessages,
    isMember,
    canJoin,
    isOwner,
    joinRoom,
    sendMessage,
    setAlias,
    decryptMessage,
    refetch: async () => {
      await fetchRoomInfo();
      await fetchMessages();
      await fetchMembers();
    },
  };
};

