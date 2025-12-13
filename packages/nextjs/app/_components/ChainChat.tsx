"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useFhevm } from "@fhevm-sdk";
import { useAccount, useBlockNumber } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { useChatRoomFactory } from "~~/hooks/chainchat/useChatRoomFactory";
import { useChatRoom } from "~~/hooks/chainchat/useChatRoom";

// Factory addresses per chain - update after deployment
// For local development, run: pnpm chain && pnpm deploy:localhost
// For Sepolia, run: pnpm deploy:sepolia
const FACTORY_ADDRESSES: Record<number, string | undefined> = {
  31337: process.env.NEXT_PUBLIC_FACTORY_ADDRESS_LOCALHOST || process.env.NEXT_PUBLIC_FACTORY_ADDRESS,
  11155111: process.env.NEXT_PUBLIC_FACTORY_ADDRESS_SEPOLIA,
};

// Supported chains
const SUPPORTED_CHAIN_IDS = [31337, 11155111] as const;

const getFactoryAddress = (chainId: number | undefined): string | undefined => {
  if (!chainId) return undefined;
  return FACTORY_ADDRESSES[chainId];
};

const isChainSupported = (chainId: number | undefined): boolean => {
  if (!chainId) return false;
  return SUPPORTED_CHAIN_IDS.includes(chainId as typeof SUPPORTED_CHAIN_IDS[number]);
};

export const ChainChat = () => {
  const { isConnected, chain, address } = useAccount();
  const chainId = chain?.id;
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);

  // URL-based room navigation
  const navigateToRoom = useCallback((roomAddress: string) => {
    setSelectedRoom(roomAddress);
    setView("room");
    router.push(`?room=${roomAddress}`, { scroll: false });
  }, [router]);

  const navigateToHome = useCallback(() => {
    setSelectedRoom(null);
    setView("home");
    router.push("/", { scroll: false });
  }, [router]);

  // Read room from URL on mount
  useEffect(() => {
    const roomFromUrl = searchParams.get("room");
    if (roomFromUrl && roomFromUrl.startsWith("0x") && roomFromUrl.length === 42) {
      setSelectedRoom(roomFromUrl);
      setView("room");
    }
  }, [searchParams]);

  // Block tracking
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const [lastBlockTime, setLastBlockTime] = useState<number>(Date.now());
  const [timeSinceBlock, setTimeSinceBlock] = useState<number>(0);
  const [avgBlockTimeSec, setAvgBlockTimeSec] = useState<number>(12);
  const prevBlockRef = useRef<bigint | undefined>(undefined);

  // Update block time when new block arrives
  useEffect(() => {
    if (blockNumber && blockNumber !== prevBlockRef.current) {
      const now = Date.now();
      const deltaSec = Math.max(1, Math.round((now - lastBlockTime) / 1000));
      // EMA for block time estimate
      setAvgBlockTimeSec((prev) => {
        const next = prev * 0.8 + deltaSec * 0.2;
        return Math.max(1, Math.min(60, Math.round(next)));
      });
      prevBlockRef.current = blockNumber;
      setLastBlockTime(now);
      setTimeSinceBlock(0);
    }
  }, [blockNumber]);

  // Timer to update time since last block
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeSinceBlock(Math.floor((Date.now() - lastBlockTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastBlockTime]);

  // Factory address for current chain
  const factoryAddress = getFactoryAddress(chainId);
  const isSupported = isChainSupported(chainId);

  // Factory hook
  const factory = useChatRoomFactory(factoryAddress);

  // Room hook
  const room = useChatRoom({
    roomAddress: selectedRoom || undefined,
    instance: fhevmInstance,
  });

  // Auto-refresh room state on new blocks
  useEffect(() => {
    if (view !== "room") return;
    if (!selectedRoom) return;
    if (!blockNumber) return;
    room.refetch();
  }, [blockNumber, view, selectedRoom]);

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
      navigateToRoom(roomAddr);
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

  const handleCopyRoomAddress = async () => {
    if (!selectedRoom) return;
    try {
      await navigator.clipboard.writeText(selectedRoom);
    } catch (e) {
      // Fallback: ignore; user can still select/copy manually.
      console.debug("Clipboard copy failed:", e);
    }
  };

  // Styles (modern dark glass)
  const shellClass =
    "min-h-screen text-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950";
  const shellBg =
    "relative overflow-hidden before:absolute before:inset-0 before:bg-[radial-gradient(900px_circle_at_15%_20%,rgba(34,211,238,0.12),transparent_55%),radial-gradient(700px_circle_at_85%_25%,rgba(168,85,247,0.10),transparent_55%),radial-gradient(800px_circle_at_50%_100%,rgba(56,189,248,0.08),transparent_60%)] before:content-['']";
  const containerClass = "relative mx-auto w-full max-w-5xl px-4 sm:px-6";
  const cardClass =
    "rounded-2xl border border-white/10 bg-white/5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl";

  const buttonBase =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";
  const primaryBtn = buttonBase + " bg-cyan-300 text-slate-950 hover:bg-cyan-200";
  const secondaryBtn = buttonBase + " bg-white/10 text-white hover:bg-white/15 border border-white/10";
  const ghostBtn = buttonBase + " bg-transparent text-white/80 hover:bg-white/10";

  const inputClass =
    "w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-cyan-300/60 focus:ring-4 focus:ring-cyan-300/10";

  if (!isConnected) {
    return (
      <div className={shellClass + " " + shellBg}>
        <div className="relative flex min-h-screen items-center justify-center px-4 py-16">
          <div className="w-full max-w-md">
            {/* Logo / Icon */}
            <div className="flex justify-center mb-8">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-purple-500 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              </div>
            </div>

            {/* Heading */}
            <div className="text-center mb-8">
              <p className="text-xs font-bold tracking-[0.25em] text-cyan-300 mb-3">CHAINCHAT</p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
                Private chat
                <br />
                <span className="bg-gradient-to-r from-cyan-300 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
                  on-chain
                </span>
              </h1>
              <p className="mt-5 text-base text-white/50 leading-relaxed max-w-sm mx-auto">
                End-to-end encrypted rooms powered by Fully Homomorphic Encryption. Your messages never leave the chain unencrypted.
              </p>
            </div>

            {/* Connect Card */}
            <div className={cardClass + " p-6"}>
              <div className="flex flex-col gap-4">
                <RainbowKitCustomConnectButton />
                <div className="flex items-center justify-center gap-3 text-xs text-white/40">
                  <span className={`w-2 h-2 rounded-full ${fhevmStatus === "ready" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span>{fhevmStatus === "ready" ? "FHE ready" : `FHE: ${fhevmStatus}`}</span>
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="mt-8 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-4">
                <div className="text-lg mb-1">🔒</div>
                <p className="text-[11px] text-white/40 leading-tight">FHE<br/>Encrypted</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-4">
                <div className="text-lg mb-1">⛓️</div>
                <p className="text-[11px] text-white/40 leading-tight">On-chain<br/>Storage</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-4">
                <div className="text-lg mb-1">👥</div>
                <p className="text-[11px] text-white/40 leading-tight">Access<br/>Control</p>
              </div>
            </div>

            <p className="mt-8 text-center text-xs text-white/25">
              Local dev: Localhost 8545 (chain 31337)
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Check for network support
  const isWrongNetwork = chainId !== undefined && !isSupported;
  
  // Show setup required message if factory not configured, FHE not ready, or wrong network
  const showSetupWarning = !factoryAddress || fhevmStatus !== "ready" || isWrongNetwork;

  // Chain name helper
  const getChainName = (id: number | undefined) => {
    if (id === 31337) return "Localhost";
    if (id === 11155111) return "Sepolia";
    return `Chain ${id}`;
  };

  // Home view - list of rooms
  if (view === "home") {
    return (
      <div className={shellClass + " " + shellBg}>
        <div className="relative min-h-screen px-4 py-8 sm:py-12">
          <div className="mx-auto max-w-4xl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-purple-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">CHAINCHAT</p>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Your <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">Rooms</span>
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full px-3 py-1.5 border border-white/10 bg-white/5">
                  <span className={`h-2 w-2 rounded-full ${fhevmStatus === "ready" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                  <span className="text-xs text-white/50">
                    {fhevmStatus === "ready" ? "FHE" : fhevmStatus}
                  </span>
                  <span className="text-xs text-white/30">•</span>
                  <span className="text-xs text-white/50">{getChainName(chainId)}</span>
                </div>
                <RainbowKitCustomConnectButton />
              </div>
            </div>

            {/* Setup Warning */}
            {showSetupWarning && (
              <div className={"mb-6 p-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 backdrop-blur-xl"}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-300">⚠</span>
                  </div>
                  <div>
                    <h3 className="text-amber-200 font-semibold">Setup required</h3>
                    <ul className="text-amber-100/70 text-sm mt-2 space-y-1">
                      {isWrongNetwork && (
                        <li>• Connected to unsupported network ({getChainName(chainId)}). Switch to Localhost or Sepolia.</li>
                      )}
                      {!factoryAddress && !isWrongNetwork && (
                        <li>• Factory not deployed on {getChainName(chainId)}. Run deploy script or set env variable.</li>
                      )}
                      {fhevmStatus !== "ready" && !isWrongNetwork && (
                        <li>• FHE not ready ({fhevmStatus}). {chainId === 31337 ? "Run pnpm chain" : "Check network connection"}.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Create Room Card */}
            <div className={cardClass + " p-6 mb-6"}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Create a new room</h2>
                  <p className="text-sm text-white/40 mt-1">Deploy a private chat contract and invite others</p>
                </div>
                <button
                  onClick={() => setView("create")}
                  disabled={!factoryAddress || isWrongNetwork || fhevmStatus !== "ready"}
                  className={primaryBtn + " gap-2"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Room
                </button>
              </div>
            </div>

            {/* Room List */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/60">
                {roomInfoList.length === 0 ? "No rooms discovered" : `${roomInfoList.length} room${roomInfoList.length !== 1 ? "s" : ""}`}
              </h2>
            </div>

            {roomInfoList.length === 0 ? (
              <div className={cardClass + " p-8 text-center"}>
                <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                  </svg>
                </div>
                <p className="text-white/50 text-sm">No rooms yet</p>
                <p className="text-white/30 text-xs mt-1">Create the first one to get started</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {roomInfoList.map((r) => (
                  <button
                    key={r.address}
                    onClick={() => navigateToRoom(r.address)}
                    className={
                      cardClass +
                      " p-5 text-left hover:bg-white/[0.08] hover:border-cyan-400/20 transition-all duration-200 group"
                    }
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-400/20 border border-white/10 flex items-center justify-center flex-shrink-0 group-hover:from-cyan-400/30 group-hover:to-purple-400/30 transition">
                        <span className="text-lg">#</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-white truncate group-hover:text-cyan-200 transition">{r.name}</h3>
                        <p className="text-xs text-white/30 font-mono truncate mt-0.5">
                          {r.address.slice(0, 8)}...{r.address.slice(-6)}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
                            {r.memberCount}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
                            {r.messageCount}
                          </span>
                        </div>
                      </div>
                      <svg className="w-5 h-5 text-white/20 group-hover:text-cyan-300 transition flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Factory Status */}
            {factory.message && (
              <p className="mt-6 text-center text-xs text-white/40">{factory.message}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Create room view
  if (view === "create") {
    return (
      <div className={shellClass + " " + shellBg}>
        <div className="relative flex min-h-screen items-center justify-center px-4 py-16">
          <div className="w-full max-w-md">
            {/* Back button */}
            <button onClick={navigateToHome} className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition mb-6">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back to rooms
            </button>

            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-purple-500 flex items-center justify-center shadow-xl shadow-cyan-500/25">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
            </div>

            {/* Heading */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight">
                Create a <span className="bg-gradient-to-r from-cyan-300 to-purple-400 bg-clip-text text-transparent">room</span>
              </h1>
              <p className="mt-3 text-sm text-white/50">
                Deploy a new encrypted chat contract on-chain
              </p>
            </div>

            {/* Form Card */}
            <div className={cardClass + " p-6"}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-2">Room name</label>
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newRoomName.trim() && !factory.isCreating) {
                        handleCreateRoom();
                      }
                    }}
                    placeholder="e.g. founders, devs, family..."
                    className={inputClass}
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleCreateRoom}
                  disabled={!newRoomName.trim() || factory.isCreating}
                  className={primaryBtn + " w-full justify-center py-3"}
                >
                  {factory.isCreating ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Deploying contract...
                    </>
                  ) : (
                    "Create room"
                  )}
                </button>
              </div>

              {factory.message && (
                <p className="mt-4 text-xs text-white/50 text-center">{factory.message}</p>
              )}
            </div>

            {/* Info */}
            <p className="mt-6 text-center text-xs text-white/30">
              Confirm the transaction in your wallet to deploy
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Room view
  return (
    <div className={shellClass + " " + shellBg + " flex flex-col min-h-screen"}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/80 backdrop-blur-2xl">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Back + Room info */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={navigateToHome}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-400/20 border border-white/10 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-medium text-white/60">#</span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold text-white truncate">
                    {room.roomInfo?.name || "Loading..."}
                  </h1>
                  {room.isOwner && (
                    <span className="text-[10px] bg-gradient-to-r from-cyan-400/20 to-purple-400/20 text-cyan-200 px-2 py-0.5 rounded-full border border-cyan-300/20 flex-shrink-0">
                      Owner
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span className="font-mono truncate">{selectedRoom?.slice(0, 8)}...{selectedRoom?.slice(-6)}</span>
                  <button 
                    onClick={handleCopyRoomAddress}
                    className="hover:text-cyan-300 transition"
                    title="Copy address"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Stats + Block timer + Settings */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Stats - hidden on mobile */}
              <div className="hidden md:flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white/50">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span>{room.members.length}</span>
                <span className="text-white/20 mx-1">•</span>
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                <span>{room.roomInfo?.messageCount || 0}</span>
              </div>

              {/* Block timer */}
              <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5 text-xs">
                <span className={`w-2 h-2 rounded-full ${
                  timeSinceBlock < 5 ? "bg-emerald-400 animate-pulse" : 
                  timeSinceBlock < 15 ? "bg-amber-400" : "bg-red-400"
                }`} />
                <span className="font-mono text-white/60">#{blockNumber?.toString() || "—"}</span>
                <span className="text-white/30">•</span>
                <span className="text-white/40">{timeSinceBlock}s</span>
              </div>

              {/* Settings button */}
              {room.isOwner && (
                <button
                  onClick={() => setOwnerModalOpen(true)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition"
                  title="Room settings"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Join Banner */}
      {room.canJoin && (
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 backdrop-blur-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-400/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {room.isOpenJoin ? "This room is open" : "You're invited"}
                  </p>
                  <p className="text-xs text-white/50">Join to send and decrypt messages</p>
                </div>
              </div>
              <button
                onClick={room.joinRoom}
                disabled={room.isJoining}
                className={primaryBtn}
              >
                {room.isJoining ? "Joining..." : "Join Room"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock History Banner */}
      {room.isMember && room.roomInfo && room.decryptCursor < room.roomInfo.messageCount && (
        <div className="mx-auto max-w-4xl px-4 pt-3">
          <div className="rounded-xl border border-purple-400/20 bg-purple-500/10 backdrop-blur-xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-purple-100/80">
                <svg className="w-4 h-4 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <span>{room.decryptCursor}/{room.roomInfo.messageCount} messages unlocked</span>
              </div>
              <button
                onClick={room.unlockHistory}
                disabled={room.isGrantingHistory || room.isUpdatingSettings}
                className="text-xs font-medium text-purple-200 hover:text-white transition disabled:opacity-50"
              >
                {room.isGrantingHistory ? "Unlocking..." : "Unlock more →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {room.isOwner && ownerModalOpen && (
        <OwnerControlsModal
          onClose={() => setOwnerModalOpen(false)}
          roomName={room.roomInfo?.name || ""}
          isOpenJoin={room.isOpenJoin}
          allowList={room.allowList}
          isUpdating={room.isUpdatingSettings}
          onSetRoomName={room.setRoomName}
          onSetJoinMode={room.setJoinMode}
          onAddAllowList={room.addAllowList}
          onRemoveAllowList={room.removeAllowList}
          onDestroyRoom={room.destroyRoom}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 scrollbar-thin">
        <div className={containerClass + " space-y-4"}>
          {room.isLoading ? (
            <p className="text-white/40 text-center text-sm">Loading...</p>
          ) : room.messages.length === 0 ? (
            <div className={"p-6 text-center " + cardClass}>
              <p className="text-sm text-white/60">No messages yet</p>
              <p className="text-xs text-white/40 mt-2">Send the first message to start the thread.</p>
            </div>
          ) : (
            room.messages.map((msg) => {
              const isOwn = msg.sender.toLowerCase() === address?.toLowerCase();
              return (
                <div
                  key={msg.id}
                  className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-3 border backdrop-blur-xl ${
                      isOwn
                        ? "bg-gradient-to-br from-cyan-300/15 to-purple-400/10 border-cyan-300/20"
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    {!isOwn && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-cyan-200">
                          {msg.senderAlias || "Anonymous"}
                        </span>
                        <span className="text-xs text-white/40 font-mono">
                          {msg.sender.slice(0, 6)}...
                        </span>
                      </div>
                    )}
                    <p className="text-white/90 leading-relaxed text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <div className="flex items-center justify-end gap-2 mt-2 text-[11px] text-white/35">
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
              <div className="max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-3 bg-cyan-300/10 border border-cyan-300/20 opacity-80">
                <p className="text-white/90 text-sm whitespace-pre-wrap break-words">{p.content}</p>
                <div className="flex items-center justify-end gap-2 mt-2 text-[11px] text-cyan-200/80">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 animate-pulse" />
                    Pending…
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      {room.isMember && (
        <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/40 backdrop-blur-xl px-4 sm:px-6 py-4">
          <div className={containerClass}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Alias (optional)"
                className={"w-full sm:w-56 " + inputClass + " py-2"}
                maxLength={32}
              />
              <span className="text-xs text-white/40 self-center">
                Wallet: <span className="font-mono text-white/60">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              </span>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder={room.isSending ? "Encrypting..." : "Type a message…"}
                disabled={room.isSending}
                className={inputClass + " flex-1"}
              />
              <button
                onClick={handleSendMessage}
                disabled={!messageInput.trim() || room.isSending}
                className={primaryBtn + " px-5"}
              >
                {room.isSending ? "Sending…" : "Send"}
              </button>
            </div>
            <p className="text-xs text-white/35 mt-2">
              Messages are encrypted with FHE before being stored on-chain.
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

function OwnerControlsModal(props: {
  onClose: () => void;
  roomName: string;
  isOpenJoin: boolean | null;
  allowList: string[];
  isUpdating: boolean;
  onSetRoomName: (name: string) => Promise<boolean>;
  onSetJoinMode: (openJoin: boolean) => Promise<boolean>;
  onAddAllowList: (addresses: string[]) => Promise<boolean>;
  onRemoveAllowList: (addresses: string[]) => Promise<boolean>;
  onDestroyRoom: () => Promise<boolean>;
}) {
  const { onClose, roomName, isOpenJoin, allowList, isUpdating, onSetRoomName, onSetJoinMode, onAddAllowList, onRemoveAllowList, onDestroyRoom } = props;
  const [nameInput, setNameInput] = useState(roomName);
  const [addrInput, setAddrInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [destroyStatus, setDestroyStatus] = useState<"idle" | "pending" | "error">("idle");
  const [destroyError, setDestroyError] = useState<string | null>(null);

  const parseAddresses = (raw: string) =>
    raw
      .split(/[\s,]+/g)
      .map(s => s.trim())
      .filter(Boolean);

  const handleDestroy = async () => {
    setDestroyStatus("pending");
    setDestroyError(null);
    try {
      const ok = await onDestroyRoom();
      if (ok) {
        onClose();
      } else {
        setDestroyStatus("error");
        setDestroyError("Transaction failed or was rejected.");
      }
    } catch (e) {
      setDestroyStatus("error");
      setDestroyError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close owner controls"
      />

      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-white/[0.02]">
          <div>
            <h3 className="text-lg font-semibold text-white">Room settings</h3>
            <p className="text-xs text-white/40 mt-0.5">Manage access and room lifecycle</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto scrollbar-thin">
          {/* Room name */}
          <section>
            <p className="text-sm font-medium text-white">Room name</p>
            <div className="mt-2 flex gap-2">
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="Room name"
                className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20"
                maxLength={64}
              />
              <button
                onClick={async () => {
                  if (!nameInput.trim() || nameInput === roomName) return;
                  const ok = await onSetRoomName(nameInput.trim());
                  if (!ok) setNameInput(roomName);
                }}
                disabled={isUpdating || !nameInput.trim() || nameInput === roomName}
                className="px-4 py-2.5 text-sm font-medium rounded-xl bg-cyan-400 text-slate-900 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Save
              </button>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Join mode */}
          <section>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Join mode</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {isOpenJoin === null ? "Loading…" : isOpenJoin ? "Anyone can join" : "Invite-only"}
                </p>
              </div>
              <button
                onClick={() => onSetJoinMode(!(isOpenJoin ?? true))}
                disabled={isUpdating || isOpenJoin === null}
                className={`
                  relative w-12 h-7 rounded-full transition
                  ${isOpenJoin ? "bg-cyan-400" : "bg-white/20"}
                  disabled:opacity-50
                `}
              >
                <span
                  className={`
                    absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all
                    ${isOpenJoin ? "left-6" : "left-1"}
                  `}
                />
              </button>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Allowlist */}
          <section>
            <p className="text-sm font-medium text-white">Allowlist</p>
            <p className="text-xs text-white/40 mt-0.5 mb-3">
              Used when invite-only is enabled
            </p>

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={addrInput}
                  onChange={e => setAddrInput(e.target.value)}
                  placeholder="0xabc..., 0xdef..."
                  className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20"
                />
                <button
                  onClick={async () => {
                    const addrs = parseAddresses(addrInput);
                    if (addrs.length === 0) return;
                    const ok = await onAddAllowList(addrs);
                    if (ok) setAddrInput("");
                  }}
                  disabled={isUpdating || !addrInput.trim()}
                  className="px-4 py-2.5 text-sm font-medium rounded-xl bg-cyan-400 text-slate-900 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Add
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={removeInput}
                  onChange={e => setRemoveInput(e.target.value)}
                  placeholder="Remove: 0xabc..."
                  className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20"
                />
                <button
                  onClick={async () => {
                    const addrs = parseAddresses(removeInput);
                    if (addrs.length === 0) return;
                    const ok = await onRemoveAllowList(addrs);
                    if (ok) setRemoveInput("");
                  }}
                  disabled={isUpdating || !removeInput.trim()}
                  className="px-4 py-2.5 text-sm font-medium rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/20 scrollbar-thin">
              {allowList.length === 0 ? (
                <p className="text-xs text-white/35 p-3 text-center">No addresses</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {allowList.map(a => (
                    <li key={a} className="flex items-center justify-between px-3 py-2 hover:bg-white/5">
                      <code className="text-xs font-mono text-white/60 truncate max-w-[70%]">{a}</code>
                      <button
                        disabled={isUpdating}
                        onClick={() => onRemoveAllowList([a])}
                        className="text-xs text-red-300/70 hover:text-red-200 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Danger zone */}
          <section>
            <p className="text-sm font-medium text-red-300">Danger zone</p>
            <p className="text-xs text-white/40 mt-0.5 mb-3">
              This action is permanent and cannot be undone.
            </p>

            {destroyError && (
              <div className="mb-3 p-3 rounded-xl bg-red-500/15 border border-red-400/20 text-xs text-red-200">
                {destroyError}
              </div>
            )}

            {!confirmDestroy ? (
              <button
                onClick={() => setConfirmDestroy(true)}
                disabled={isUpdating}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-xl bg-red-500/15 text-red-200 border border-red-400/20 hover:bg-red-500/25 disabled:opacity-50 transition"
              >
                Destroy room
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-red-200/80 text-center">Are you sure? This will permanently destroy the room.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setConfirmDestroy(false);
                      setDestroyError(null);
                      setDestroyStatus("idle");
                    }}
                    disabled={destroyStatus === "pending"}
                    className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-white/10 text-white hover:bg-white/15 border border-white/10 disabled:opacity-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDestroy}
                    disabled={destroyStatus === "pending" || isUpdating}
                    className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-red-500 text-white hover:bg-red-400 disabled:opacity-50 transition"
                  >
                    {destroyStatus === "pending" ? "Destroying…" : "Confirm destroy"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

