// Using SDK 0.2.0 from CDN, but patching relayerUrl in fhevm.ts to use .org domain
// (the .cloud domain is no longer resolving, and newer versions aren't on CDN yet)
export const SDK_CDN_URL =
  "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.umd.cjs";
