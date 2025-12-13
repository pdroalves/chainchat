"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWagmiEthers } from "../wagmi/useWagmiEthers";
import { CHATROOM_ABI } from "./useChatRoomFactory";
import { FhevmDecryptionSignature, FhevmInstance, useFHEEncryption, useInMemoryStorage } from "@fhevm-sdk";
import { ethers } from "ethers";

interface Message {
  id: number;
  sender: string;
  senderAlias: string;
  chunkCount: number;
  timestamp: number;
  blockNumber: number;
  content: string;
  handles?: string[]; // encrypted chunk handles for decryption
  isDecrypted?: boolean;
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
  const [isOpenJoin, setIsOpenJoin] = useState<boolean | null>(null);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [decryptCursor, setDecryptCursor] = useState<number>(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isGrantingHistory, setIsGrantingHistory] = useState(false);
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingMessages, setPendingMessages] = useState<{ id: string; content: string }[]>([]);

  const userAddress = accounts?.[0];

  const decryptedByteCacheRef = useRef<Map<string, number>>(new Map());
  const decryptInFlightRef = useRef<Set<string>>(new Set());
  const didJustJoinRef = useRef<boolean>(false);
  const decryptSigRef = useRef<FhevmDecryptionSignature | null>(null);

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

  const isMember = Boolean(userInfo?.joinedAt && userInfo.joinedAt > 0);

  // Fetch room settings needed by UX (join mode, allowlist, decrypt cursor)
  const fetchRoomSettings = useCallback(async () => {
    const contract = getContract("read");
    if (!contract) return;

    try {
      const [openJoin, al] = await Promise.all([
        contract.isOpenJoin(),
        contract.getAllowList(),
      ]);
      setIsOpenJoin(Boolean(openJoin));
      setAllowList((al as string[]) || []);
    } catch (err) {
      console.error("Failed to fetch room settings:", err);
    }

    if (userAddress) {
      try {
        const c = await contract.decryptAccessCursor(userAddress);
        setDecryptCursor(Number(c));
      } catch (err) {
        // Cursor is best-effort; keep default.
        console.debug("Failed to fetch decrypt cursor:", err);
      }
    }
  }, [getContract, userAddress]);

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

  // Fetch messages with encrypted handles for decryption
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

      // Fetch ciphertext handles in batch (members only)
      let flatHandles: string[] = [];
      let chunkCountsFromHandles: number[] = [];
      if (isMember) {
        try {
          const res = await contract.getMessageHandlesRange(0, count);
          const handles = (res?.[0] as string[]) || [];
          const ccounts = (res?.[1] as any[]) || [];
          flatHandles = handles;
          chunkCountsFromHandles = ccounts.map((x: any) => Number(x));
        } catch (err) {
          // Member might not yet have decrypt permissions; still can read handles. If this fails, we'll fall back to empty.
          console.debug("Failed to batch fetch message handles:", err);
        }
      }

      let handleOffset = 0;
      for (let i = 0; i < range[0].length; i++) {
        const chunkCount = Number(range[1][i]);
        let handlesForMsg: string[] | undefined = undefined;

        if (isMember && chunkCountsFromHandles.length === range[0].length) {
          const expected = chunkCountsFromHandles[i];
          const sliceCount = Math.min(expected, chunkCount);
          handlesForMsg = flatHandles.slice(handleOffset, handleOffset + sliceCount);
          handleOffset += expected;
        }

        // If we already have plaintext in cache, render immediately
        let content = isMember ? "🔐 Encrypted" : "🔒 Join to view";
        let isDecrypted = false;
        if (handlesForMsg && handlesForMsg.length > 0) {
          const maybeDecoded = decodeHandlesToString(handlesForMsg, decryptedByteCacheRef.current);
          if (maybeDecoded !== null) {
            content = maybeDecoded;
            isDecrypted = true;
          } else {
            content = "🔓 Decrypting...";
          }
        }

        msgs.push({
          id: i,
          sender: range[0][i],
          chunkCount,
          timestamp: Number(range[2][i]) * 1000,
          blockNumber: Number(range[3][i]),
          senderAlias: range[4][i],
          content,
          handles: handlesForMsg,
          isDecrypted,
        });
      }

      setMessages(msgs);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, [getContract, roomInfo, isMember]);

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
      const wasMember = isMember;
      const tx = await contract.joinRoom();
      await tx.wait();
      setMessage("Joined room!");
      await fetchUserInfo();
      await fetchMembers();
      await fetchRoomSettings();
      didJustJoinRef.current = !wasMember;
      return true;
    } catch (err) {
      setMessage(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsJoining(false);
    }
  }, [getContract, fetchUserInfo, fetchMembers, fetchRoomSettings, isMember]);

  // Send message (with FHE encryption)
  const roomContractAddress = useMemo(() => {
    if (!roomAddress || typeof roomAddress !== "string") return undefined;
    return roomAddress.startsWith("0x") ? (roomAddress as `0x${string}`) : undefined;
  }, [roomAddress]);

  const { encryptWith } = useFHEEncryption({
    instance,
    ethersSigner: ethersSigner as any,
    contractAddress: roomContractAddress,
  });

  const sendMessage = useCallback(
    async (content: string, alias: string = "") => {
      const contract = getContract("write");
      if (!contract) {
        setMessage("Wallet not connected or contract not available");
        return false;
      }
      
      if (!instance) {
        setMessage("FHE not ready. Check if the FHEVM node/relayer is accessible.");
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
          setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
          return false;
        }

        // Encrypt using FHE
        let encrypted;
        try {
          encrypted = await encryptWith((builder) => {
            for (let i = 0; i < bytes.length; i++) {
              (builder as any).add8(bytes[i]);
            }
          });
        } catch (encErr) {
          const errMsg = encErr instanceof Error ? encErr.message : String(encErr);
          if (errMsg.includes("ERR_NAME_NOT_RESOLVED") || errMsg.includes("fetch")) {
            setMessage("Cannot reach FHE relayer service. Check your network connection.");
          } else if (errMsg.includes("ERR_CONNECTION_REFUSED")) {
            setMessage("Cannot connect to blockchain node. Is the local node running?");
          } else {
            setMessage(`Encryption error: ${errMsg}`);
          }
          setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
          return false;
        }

        if (!encrypted) {
          setMessage("Encryption failed - no result returned");
          setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
          return false;
        }

        setMessage("Sending transaction...");
        // Convert Uint8Array handles to hex bytes32 strings
        const hexHandles = encrypted.handles.map((h: Uint8Array) => 
          "0x" + Buffer.from(h).toString("hex").padStart(64, "0")
        );
        // Convert inputProof to hex bytes string
        const hexProof = "0x" + Buffer.from(encrypted.inputProof).toString("hex");
        
        const tx = await contract.sendMessage(hexHandles, hexProof, alias);
        await tx.wait();

        setMessage("Message sent!");
        setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
        await fetchRoomInfo();
        await fetchMessages();
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("user rejected")) {
          setMessage("Transaction cancelled by user");
        } else if (errMsg.includes("insufficient funds")) {
          setMessage("Insufficient funds for gas");
        } else {
          setMessage(`Transaction failed: ${errMsg}`);
        }
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

  const decryptNeededHandles = useMemo(() => {
    if (!isMember) return [];
    const cache = decryptedByteCacheRef.current;
    const inFlight = decryptInFlightRef.current;
    const out: string[] = [];
    for (const msg of messages) {
      if (!msg.handles || msg.handles.length === 0) continue;
      for (const h of msg.handles) {
        if (!cache.has(h) && !inFlight.has(h)) {
          out.push(h);
        }
      }
    }
    return out;
  }, [messages, isMember]);

  const decryptBatch = useCallback(
    async (handles: string[]) => {
      if (!instance || !ethersSigner || !roomAddress) return;
      if (handles.length === 0) return;

      setIsDecrypting(true);
      setDecryptError(null);

      // Mark in-flight to avoid duplication
      handles.forEach(h => decryptInFlightRef.current.add(h));

      try {
        if (!decryptSigRef.current) {
          decryptSigRef.current = await FhevmDecryptionSignature.loadOrSign(
            instance,
            [roomAddress as `0x${string}`],
            ethersSigner as any,
            fhevmDecryptionSignatureStorage,
          );
        }
        const sig = decryptSigRef.current;
        if (!sig) {
          throw new Error("Failed to create decryption signature");
        }

        const requests = handles.map(h => ({ handle: h, contractAddress: roomAddress as `0x${string}` }));
        const res = await instance.userDecrypt(
          requests,
          sig.privateKey,
          sig.publicKey,
          sig.signature,
          sig.contractAddresses,
          sig.userAddress,
          sig.startTimestamp,
          sig.durationDays,
        );

        const cache = decryptedByteCacheRef.current;
        for (const [handle, value] of Object.entries(res)) {
          // Expect a byte (bigint) for euint8
          const byteVal = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : undefined;
          if (byteVal !== undefined) cache.set(handle, byteVal);
        }

        // Update message plaintext from cache
        setMessages(prev =>
          prev.map(m => {
            if (!m.handles || m.handles.length === 0) return m;
            const decoded = decodeHandlesToString(m.handles, cache);
            if (decoded === null) return m;
            return { ...m, content: decoded, isDecrypted: true };
          }),
        );
      } catch (e) {
        const err = e as any;
        const msg = err?.message ? String(err.message) : "Decryption failed";
        setDecryptError(msg);
      } finally {
        handles.forEach(h => decryptInFlightRef.current.delete(h));
        setIsDecrypting(false);
      }
    },
    [instance, ethersSigner, roomAddress, fhevmDecryptionSignatureStorage],
  );

  // Decrypt in batches and do not re-decrypt cached handles (session-only cache)
  useEffect(() => {
    if (!isMember) return;
    if (!instance || !ethersSigner) return;
    if (!roomAddress) return;
    if (decryptNeededHandles.length === 0) return;

    const batchSize = 120;
    let cancelled = false;

    const run = async () => {
      for (let i = 0; i < decryptNeededHandles.length; i += batchSize) {
        if (cancelled) return;
        const batch = decryptNeededHandles.slice(i, i + batchSize);
        // eslint-disable-next-line no-await-in-loop
        await decryptBatch(batch);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [decryptNeededHandles, decryptBatch, instance, ethersSigner, roomAddress, isMember]);

  const unlockHistory = useCallback(async () => {
    const contract = getContract("write");
    if (!contract || !roomInfo) return false;
    if (!isMember) return false;

    setIsGrantingHistory(true);
    setMessage("Unlocking history (may require multiple confirmations)...");
    try {
      let cursor = decryptCursor;
      while (cursor < roomInfo.messageCount) {
        const remaining = roomInfo.messageCount - cursor;
        const step = Math.min(25, remaining);
        // eslint-disable-next-line no-await-in-loop
        const tx = await contract.grantDecryptAccess(cursor, step);
        // eslint-disable-next-line no-await-in-loop
        const receipt = await tx.wait();
        // Some providers may not return the function output; read cursor after each tx
        // eslint-disable-next-line no-await-in-loop
        const newCursor = await getContract("read")?.decryptAccessCursor(userAddress);
        cursor = Number(newCursor ?? cursor + step);
        setDecryptCursor(cursor);
        if (receipt?.status !== 1) break;
      }
      setMessage("History unlock complete");
      return true;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessage(`History unlock cancelled/failed: ${errMsg}`);
      return false;
    } finally {
      setIsGrantingHistory(false);
    }
  }, [getContract, roomInfo, isMember, decryptCursor, userAddress]);

  // Auto-suggest history unlock right after a join in this session
  useEffect(() => {
    if (!didJustJoinRef.current) return;
    if (!roomInfo || roomInfo.messageCount === 0) return;
    if (!isMember) return;
    didJustJoinRef.current = false;
    // Do not auto-run unlock (requires tx confirmations); just prompt via message.
    setMessage("You joined. To decrypt past messages, use 'Unlock history' in the room settings.");
  }, [roomInfo, isMember]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      if (!roomAddress) return;
      setIsLoading(true);
      await fetchRoomInfo();
      await fetchUserInfo();
      await fetchMembers();
      await fetchRoomSettings();
      setIsLoading(false);
    };
    load();
  }, [roomAddress, fetchRoomInfo, fetchUserInfo, fetchMembers, fetchRoomSettings]);

  // Load messages after room info
  useEffect(() => {
    if (roomInfo) {
      fetchMessages();
    }
  }, [roomInfo, fetchMessages]);

  const canJoin = !isMember && !userInfo?.isBanned && (Boolean(isOpenJoin) || Boolean(userInfo?.isAllowed));
  const isOwner = roomInfo?.owner?.toLowerCase() === userAddress?.toLowerCase();

  const setJoinMode = useCallback(
    async (openJoin: boolean) => {
      const contract = getContract("write");
      if (!contract) return false;
      setIsUpdatingSettings(true);
      try {
        const tx = await contract.setJoinMode(openJoin);
        await tx.wait();
        await fetchRoomSettings();
        return true;
      } catch (e) {
        setMessage(`Failed to set join mode: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [getContract, fetchRoomSettings],
  );

  const addAllowList = useCallback(
    async (addresses: string[]) => {
      const contract = getContract("write");
      if (!contract) return false;
      setIsUpdatingSettings(true);
      try {
        const tx = await contract.addToAllowList(addresses);
        await tx.wait();
        await fetchRoomSettings();
        return true;
      } catch (e) {
        setMessage(`Failed to add allowlist: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [getContract, fetchRoomSettings],
  );

  const removeAllowList = useCallback(
    async (addresses: string[]) => {
      const contract = getContract("write");
      if (!contract) return false;
      setIsUpdatingSettings(true);
      try {
        const tx = await contract.removeFromAllowList(addresses);
        await tx.wait();
        await fetchRoomSettings();
        return true;
      } catch (e) {
        setMessage(`Failed to remove allowlist: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [getContract, fetchRoomSettings],
  );

  const destroyRoom = useCallback(async () => {
    const contract = getContract("write");
    if (!contract) return false;
    setIsUpdatingSettings(true);
    try {
      const tx = await contract.destroyRoom();
      await tx.wait();
      await fetchRoomInfo();
      return true;
    } catch (e) {
      setMessage(`Failed to destroy room: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setIsUpdatingSettings(false);
    }
  }, [getContract, fetchRoomInfo]);

  const setRoomName = useCallback(
    async (newName: string) => {
      const contract = getContract("write");
      if (!contract) return false;
      setIsUpdatingSettings(true);
      try {
        const tx = await contract.setName(newName);
        await tx.wait();
        await fetchRoomInfo();
        return true;
      } catch (e) {
        setMessage(`Failed to rename room: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [getContract, fetchRoomInfo],
  );

  return {
    roomInfo,
    messages,
    members,
    userInfo,
    isLoading,
    isSending,
    isJoining,
    isDecrypting,
    decryptError,
    isGrantingHistory,
    decryptCursor,
    isOpenJoin,
    allowList,
    isUpdatingSettings,
    message,
    pendingMessages,
    isMember,
    canJoin,
    isOwner,
    joinRoom,
    sendMessage,
    setAlias,
    unlockHistory,
    setJoinMode,
    addAllowList,
    removeAllowList,
    destroyRoom,
    setRoomName,
    refetch: async () => {
      decryptSigRef.current = null;
      await fetchRoomInfo();
      await fetchMessages();
      await fetchMembers();
      await fetchRoomSettings();
    },
  };
};

function decodeHandlesToString(handles: string[], cache: Map<string, number>): string | null {
  const bytes: number[] = [];
  for (const h of handles) {
    const b = cache.get(h);
    if (b === undefined) return null;
    bytes.push(b);
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

