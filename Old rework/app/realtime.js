import { api } from "./api.js";
import { getWebSocketUrl, normalizePrediction, setAuthStatus, setMessage, state } from "./shared.js";

let signalingWs = null;

function signal(message) {
  if (signalingWs?.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify(message));
  }
}

async function newPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: state.iceServers,
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      signal({ type: "ICE", to: peerId, from: state.myId, candidate: event.candidate });
    }
  };

  state.peers.set(peerId, { pc, dc: null });
  return pc;
}

function createSeenKey(message) {
  return JSON.stringify(message);
}

export function createRealtimeController({ onRemoteBet, onRemotePrediction }) {
  async function loadIceServers() {
    try {
      const response = await api("/webrtc/turn/ice-config");
      const turnServers = Array.isArray(response?.iceServers) ? response.iceServers : [];
      state.iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        ...turnServers,
      ];
    } catch (error) {
      state.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      console.warn("TURN configuration unavailable, falling back to public STUN.", error);
    }
  }

  function gossip(message, excludePeerId = null) {
    const raw = JSON.stringify(message);
    for (const [peerId, { dc }] of state.peers) {
      if (peerId !== excludePeerId && dc?.readyState === "open") {
        dc.send(raw);
      }
    }
  }

  function dm(peerId, message) {
    const peer = state.peers.get(peerId);
    if (peer?.dc?.readyState === "open") {
      peer.dc.send(JSON.stringify(message));
    }
  }

  function handleGossip(type, data) {
    state.chain.enqueueEvent(type, data);
    if (type === "BET_PLACED") {
      onRemoteBet(data);
      return;
    }
    if (type === "PREDICTION_CREATED") {
      onRemotePrediction(normalizePrediction(data));
    }
  }

  function handleDMs(message, peerId) {
    if (message.type === "REQUEST" && message.data === "CHAIN_SYNC") {
      const chainData = state.chain.export();
      dm(peerId, { type: "RESPONSE", data: { type: "CHAIN_SYNC", data: chainData } });
      return;
    }

    if (message.type === "RESPONSE" && message.data?.type === "CHAIN_SYNC") {
      const chainData = message.data.data;
      state.chain.import(chainData);
    }
  }

  async function broadcastBlockchainEvent(type, data) {
    const message = { type, data };
    state.seen.add(createSeenKey(message));
    handleGossip(type, data);
    gossip(message);
  }

  function setupDataChannel(dc, peerId) {
    const peer = state.peers.get(peerId);
    if (!peer) {
      return;
    }

    peer.dc = dc;
    dc.onopen = () => {
      if (state.peers.size <= 3) {
        dm(peerId, {
          type: "REQUEST",
          data: "CHAIN_SYNC",
        });
      }
    };

    dc.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "REQUEST" || message.type === "RESPONSE") {
        handleDMs(message, peerId);
        return;
      }

      const seenKey = createSeenKey(message);
      if (state.seen.has(seenKey)) {
        return;
      }

      state.seen.add(seenKey);
      handleGossip(message.type, message.data);
      gossip(message, peerId);
    };
  }

  async function initiateConnection(peerId) {
    const pc = await newPeerConnection(peerId);
    const dc = pc.createDataChannel("blockchain");
    setupDataChannel(dc, peerId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ type: "OFFER", to: peerId, from: state.myId, sdp: offer });
  }

  async function answerConnection(peerId, sdp) {
    const pc = await newPeerConnection(peerId);
    pc.ondatachannel = (event) => setupDataChannel(event.channel, peerId);

    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal({ type: "ANSWER", to: peerId, from: state.myId, sdp: answer });
  }

  function cleanupRealtime() {
    if (signalingWs) {
      signalingWs.onclose = null;
      signalingWs.close();
      signalingWs = null;
    }

    for (const { pc } of state.peers.values()) {
      pc.close();
    }

    state.peers.clear();
    state.seen.clear();
    state.myId = null;
  }

  function connectSignaling() {
    if (!state.token) {
      return;
    }

    cleanupRealtime();
    signalingWs = new WebSocket(getWebSocketUrl(state.token));

    signalingWs.onopen = () => {
      setAuthStatus("Signed in.");
    };

    signalingWs.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "AUTH_ERROR") {
        setMessage("Realtime connection was rejected. Please sign out and sign back in.", "error");
        return;
      }

      if (message.type === "PEERS") {
        state.myId = message.your_id;
        for (const peerId of message.connect_to || []) {
          await initiateConnection(peerId);
        }
        return;
      }

      if (message.type === "CONNECT_TO_NEW_PEER" || message.type === "INCOMING_PEER") {
        await initiateConnection(message.peer_id);
        return;
      }

      if (message.type === "OFFER") {
        await answerConnection(message.from, message.sdp);
        return;
      }

      if (message.type === "ANSWER") {
        await state.peers.get(message.from)?.pc.setRemoteDescription(message.sdp);
        return;
      }

      if (message.type === "ICE") {
        await state.peers.get(message.from)?.pc.addIceCandidate(message.candidate);
        return;
      }

      if (message.type === "PEER_DISCONNECTED") {
        const peer = state.peers.get(message.peer_id);
        peer?.pc.close();
        state.peers.delete(message.peer_id);
      }
    };

    signalingWs.onerror = () => {
      setAuthStatus("Realtime connection failed.");
    };

    signalingWs.onclose = (event) => {
      cleanupRealtime();
      if (event.code === 1008) {
        setAuthStatus("Realtime connection rejected.");
        return;
      }

      window.setTimeout(() => {
        if (state.token) {
          connectSignaling();
        }
      }, 3000);
    };
  }

  return {
    broadcastBlockchainEvent,
    cleanupRealtime,
    connectSignaling,
    loadIceServers,
  };
}
