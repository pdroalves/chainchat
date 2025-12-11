"use client";

import { useEffect, useMemo, useState } from "react";
import { useFhevm } from "@fhevm-sdk";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { useChatRoomFactory } from "~~/hooks/chainchat/useChatRoomFactory";
import { useChatRoom } from "~~/hooks/chainchat/useChatRoom";

// Factory address - update after deployment
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "";

export const ChainChat = () => {
  const { isConnected, chain, address } = useAccount();
  const chainId = chain?.id;

  // FHEVM instance
  const provider = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return (window as any).ethereum;
  }, []);

  const {
    instance: fhevmInstance,
    status: fhevmStatus,
  } = useFhevm({
    provider,
    chainId,
    initialMockChains: { 31337: "http://localhost:8545" },
    enabled: true,
  });

  // State
  const [view, setView] = useState<"home" | "room" | "create">("home");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [aliasInput, setAliasInput] = useState("");

  // Factory hook
  const factory = useChatRoomFactory(FACTORY_ADDRESS);

  // Room hook
  const room = useChatRoom({
    roomAddress: selectedRoom || undefined,
    instance: fhevmInstance,
  });

  // Room list with info
  const [roomInfoList, setRoomInfoList] = useState<
    Array<{
      address: string;
      name: string;
      memberCount: number;
      messageCount: number;
    }>
  >([]);

  // Fetch room info for all rooms
  useEffect(() => {
    const fetchRoomInfos = async () => {
      const infos = await Promise.all(
        factory.allRooms.map(async (addr) => {
          const info = await factory.getRoomInfo(addr);
          return info
            ? {
                address: addr,
                name: info.name,
                memberCount: info.memberCount,
                messageCount: info.messageCount,
              }
            : null;
        })
      );
      setRoomInfoList(infos.filter(Boolean) as any);
    };
    if (factory.allRooms.length > 0) {
      fetchRoomInfos();
    }
  }, [factory.allRooms, factory.getRoomInfo]);

  // Handle create room
  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) return;
    const roomAddr = await factory.createRoom(newRoomName, []);
    if (roomAddr) {
      setSelectedRoom(roomAddr);
      setView("room");
      setNewRoomName("");
    }
  };

  // Handle send message
  const handleSendMessage = async () => {
    if (!messageInput.trim()) return;
    const success = await room.sendMessage(messageInput, aliasInput);
    if (success) {
      setMessageInput("");
    }
  };

  // Styles
  const buttonClass =
    "px-4 py-2 font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const primaryBtn = buttonClass + " bg-cyan-500 text-black hover:bg-cyan-400";
  const secondaryBtn = buttonClass + " bg-gray-700 text-white hover:bg-gray-600";
  const cardClass = "bg-gray-800 rounded-xl p-6 border border-gray-700";

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className={cardClass + " text-center max-w-md"}>
          <h1 className="text-3xl font-bold text-cyan-400 mb-4">🔐 ChainChat</h1>
          <p className="text-gray-400 mb-6">
            Encrypted blockchain messaging powered by fhEVM
          </p>
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    );
  }

  // Home view - list of rooms
  if (view === "home") {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-cyan-400">🔐 ChainChat</h1>
            <div className="flex gap-4 items-center">
              <span className="text-gray-400 text-sm">
                {fhevmStatus === "ready" ? "🟢 FHE Ready" : "🔴 FHE " + fhevmStatus}
              </span>
              <RainbowKitCustomConnectButton />
            </div>
          </div>

          {/* Create Room Button */}
          <button
            onClick={() => setView("create")}
            className={primaryBtn + " w-full mb-6"}
          >
            + Create New Room
          </button>

          {/* Room List */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Chat Rooms</h2>
            {roomInfoList.length === 0 ? (
              <p className="text-gray-500">No rooms yet. Create one!</p>
            ) : (
              roomInfoList.map((r) => (
                <div
                  key={r.address}
                  onClick={() => {
                    setSelectedRoom(r.address);
                    setView("room");
                  }}
                  className={cardClass + " cursor-pointer hover:border-cyan-500 transition-colors"}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{r.name}</h3>
                      <p className="text-gray-400 text-sm font-mono">
                        {r.address.slice(0, 10)}...{r.address.slice(-8)}
                      </p>
                    </div>
                    <div className="text-right text-sm text-gray-400">
                      <p>👥 {r.memberCount} members</p>
                      <p>💬 {r.messageCount} messages</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Factory Status */}
          {factory.message && (
            <p className="mt-4 text-sm text-gray-400">{factory.message}</p>
          )}
        </div>
      </div>
    );
  }

  // Create room view
  if (view === "create") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className={cardClass + " max-w-md w-full"}>
          <button
            onClick={() => setView("home")}
            className="text-gray-400 hover:text-white mb-4"
          >
            ← Back
          </button>
          <h2 className="text-2xl font-bold text-cyan-400 mb-6">Create New Room</h2>

          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="Room name..."
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 mb-4"
          />

          <button
            onClick={handleCreateRoom}
            disabled={!newRoomName.trim() || factory.isCreating}
            className={primaryBtn + " w-full"}
          >
            {factory.isCreating ? "Creating..." : "Create Room"}
          </button>

          {factory.message && (
            <p className="mt-4 text-sm text-gray-400">{factory.message}</p>
          )}
        </div>
      </div>
    );
  }

  // Room view
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setSelectedRoom(null);
                setView("home");
              }}
              className="text-gray-400 hover:text-white"
            >
              ← Back
            </button>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {room.roomInfo?.name || "Loading..."}
                {room.isOwner && (
                  <span className="ml-2 text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">
                    Owner
                  </span>
                )}
              </h2>
              <p className="text-gray-400 text-sm font-mono">
                {selectedRoom?.slice(0, 10)}...{selectedRoom?.slice(-8)}
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-400">
            👥 {room.members.length} • 💬 {room.roomInfo?.messageCount || 0}
          </div>
        </div>
      </div>

      {/* Join Banner */}
      {room.canJoin && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/30 px-6 py-3">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <span className="text-cyan-400">You're allowed to join this room</span>
            <button
              onClick={room.joinRoom}
              disabled={room.isJoining}
              className={primaryBtn}
            >
              {room.isJoining ? "Joining..." : "Join Room"}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {room.isLoading ? (
            <p className="text-gray-500 text-center">Loading...</p>
          ) : room.messages.length === 0 ? (
            <p className="text-gray-500 text-center">No messages yet</p>
          ) : (
            room.messages.map((msg) => {
              const isOwn = msg.sender.toLowerCase() === address?.toLowerCase();
              return (
                <div
                  key={msg.id}
                  className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                      isOwn
                        ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30"
                        : "bg-gray-800 border border-gray-700"
                    }`}
                  >
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-cyan-400">
                          {msg.senderAlias || "Anonymous"}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">
                          {msg.sender.slice(0, 6)}...
                        </span>
                      </div>
                    )}
                    <p className="text-gray-200">{msg.content}</p>
                    <div className="flex items-center justify-end gap-2 mt-2 text-xs text-gray-500">
                      <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                      <span className="font-mono">#{msg.blockNumber}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Pending messages */}
          {room.pendingMessages.map((p) => (
            <div key={p.id} className="flex justify-end">
              <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 opacity-70">
                <p className="text-gray-200">{p.content}</p>
                <div className="flex items-center justify-end gap-2 mt-2 text-xs text-cyan-400">
                  <span className="animate-pulse">● Pending...</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      {room.isMember && (
        <div className="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Alias (optional)"
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm w-40"
                maxLength={32}
              />
              <span className="text-xs text-gray-500 self-center">
                Wallet: {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder={room.isSending ? "Encrypting..." : "Type your encrypted message..."}
                disabled={room.isSending}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 disabled:opacity-50"
              />
              <button
                onClick={handleSendMessage}
                disabled={!messageInput.trim() || room.isSending}
                className={primaryBtn}
              >
                {room.isSending ? "..." : "Send"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              🔐 Messages are encrypted with FHE before being stored on-chain
            </p>
          </div>
        </div>
      )}

      {/* Status */}
      {room.message && (
        <div className="bg-gray-800 border-t border-gray-700 px-6 py-2">
          <p className="max-w-4xl mx-auto text-sm text-gray-400">{room.message}</p>
        </div>
      )}
    </div>
  );
};

