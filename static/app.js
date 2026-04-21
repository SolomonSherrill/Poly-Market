import { Blockchain } from "./blockchain.js";

const authConfig = {
  domain: document.body.dataset.auth0Domain,
  clientId: document.body.dataset.auth0ClientId,
  audience: document.body.dataset.auth0Audience,
  redirectUri: window.location.origin,
};

const state = {
  token: localStorage.getItem("poly_token") || "",
  user: null,
  auth0: null,
  myId: null,
  peers: new Map(),
  seen: new Set(),
  chain: new Blockchain(),
};

const elements = {
  authView: document.getElementById("auth-view"),
  dashboardView: document.getElementById("dashboard-view"),
  messageBanner: document.getElementById("message-banner"),
  loginButton: document.getElementById("login-button"),
  signupButton: document.getElementById("signup-button"),
  logoutButton: document.getElementById("logout-button"),
  refreshButton: document.getElementById("refresh-markets"),
  createMarketForm: document.getElementById("create-market-form"),
  welcomeTitle: document.getElementById("welcome-title"),
  userName: document.getElementById("user-name"),
  userBalance: document.getElementById("user-balance"),
  userEmail: document.getElementById("user-email"),
  marketsList: document.getElementById("markets-list"),
  marketTemplate: document.getElementById("market-card-template"),
};

let signalingWs = null;

function getWebSocketUrl(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/connect`);
  url.searchParams.set("token", token);
  return url.toString();
}

function setMessage(text, tone = "success") {
  if (!text) {
    elements.messageBanner.className = "message-banner hidden";
    elements.messageBanner.textContent = "";
    return;
  }

  elements.messageBanner.textContent = text;
  elements.messageBanner.className = `message-banner ${tone}`;
}

function setToken(token) {
  state.token = token || "";
  if (state.token) {
    localStorage.setItem("poly_token", state.token);
  } else {
    localStorage.removeItem("poly_token");
  }
}

function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount || 0));
}

function formatDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown close";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.message || "Something went wrong.";
    throw new Error(message);
  }

  return payload;
}

function setView(view) {
  const showAuth = view === "auth";
  const showDashboard = view === "dashboard";

  elements.authView.classList.toggle("hidden", !showAuth);
  elements.dashboardView.classList.toggle("hidden", !showDashboard);
  elements.logoutButton.classList.toggle("hidden", !showDashboard);
  elements.refreshButton.classList.toggle("hidden", !showDashboard);

  if (showAuth) {
    elements.welcomeTitle.textContent = "Sign in to your account";
  }
}

function signal(message) {
  if (signalingWs?.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify(message));
  }
}

function newPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      signal({ type: "ICE", to: peerId, from: state.myId, candidate: event.candidate });
    }
  };

  state.peers.set(peerId, { pc, dc: null });
  return pc;
}

function handleGossip(message) {
  if (message.type === "NEW_BLOCK") {
    console.log("New block received:", message.data);
  } else if (message.type === "NEW_TX") {
    console.log("New transaction received:", message.data);
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

function setupDataChannel(dc, peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) {
    return;
  }

  peer.dc = dc;
  dc.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const hash = event.data;

    if (state.seen.has(hash)) {
      return;
    }

    state.seen.add(hash);
    handleGossip(message);
    gossip(message, peerId);
  };
}

async function initiateConnection(peerId) {
  const pc = newPeerConnection(peerId);
  const dc = pc.createDataChannel("blockchain");
  setupDataChannel(dc, peerId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: "OFFER", to: peerId, from: state.myId, sdp: offer });
}

async function answerConnection(peerId, sdp) {
  const pc = newPeerConnection(peerId);
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

  signalingWs.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "PEERS") {
      state.myId = message.your_id;
      for (const peerId of message.connect_to || []) {
        await initiateConnection(peerId);
      }
      return;
    }

    if (message.type === "CONNECT_TO_NEW_PEER") {
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

  signalingWs.onclose = () => {
    cleanupRealtime();
    window.setTimeout(() => {
      if (state.token) {
        connectSignaling();
      }
    }, 3000);
  };
}

async function loadUser() {
  const user = await api("/users/me");
  state.user = user;
  elements.userName.textContent = user.name || "Auth0 User";
  elements.userBalance.textContent = formatMoney(user.balance);
  elements.userEmail.textContent = user.email || "-";
  elements.welcomeTitle.textContent = `Welcome back, ${user.name || "trader"}`;
}

function renderMarketCard(prediction) {
  const fragment = elements.marketTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".market-card");
  const marketTag = fragment.querySelector(".market-tag");
  const marketEnd = fragment.querySelector(".market-end");
  const marketTitle = fragment.querySelector(".market-title");
  const yesVolume = fragment.querySelector(".yes-volume");
  const noVolume = fragment.querySelector(".no-volume");
  const betForm = fragment.querySelector(".bet-form");
  const yesButton = fragment.querySelector('[data-side="yes"]');
  const noButton = fragment.querySelector('[data-side="no"]');
  const isHighLow = prediction.bet_type === "high_low";

  marketTag.textContent = isHighLow ? "High / Low" : "Yes / No";
  marketEnd.textContent = `Closes ${formatDate(prediction.end_time)}`;
  marketTitle.textContent = prediction.bet_string;
  yesVolume.textContent = `${isHighLow ? "High" : "Yes"}: ${formatMoney(prediction.total_yes)}`;
  noVolume.textContent = `${isHighLow ? "Low" : "No"}: ${formatMoney(prediction.total_no)}`;
  yesButton.textContent = isHighLow ? "Buy High" : "Buy Yes";
  noButton.textContent = isHighLow ? "Buy Low" : "Buy No";

  betForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const amount = Number(new FormData(betForm).get("amount"));
    const isYes = submitter?.dataset.side === "yes";

    try {
      const response = await api("/predictions/back-prediction", {
        method: "POST",
        body: JSON.stringify({
          prediction_id: prediction._id,
          amount,
          is_yes: isYes,
        }),
      });

      if (response?.success === false) {
        throw new Error(response.message || "Order failed.");
      }

      betForm.reset();
      setMessage(`Order placed on "${prediction.bet_string}".`);
      await Promise.all([loadUser(), loadMarkets()]);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  elements.marketsList.appendChild(card);
}

async function loadMarkets() {
  const predictions = await api("/predictions/get-all-predictions");
  elements.marketsList.innerHTML = "";

  if (!predictions.length) {
    elements.marketsList.innerHTML = '<article class="panel">No active markets yet. Post the first one above.</article>';
    return;
  }

  predictions.forEach(renderMarketCard);
}

async function bootAuthenticatedApp() {
  setView("dashboard");
  await Promise.all([loadUser(), loadMarkets()]);
  connectSignaling();
}

async function refreshAccessToken() {
  if (!state.auth0) {
    return "";
  }

  const token = await state.auth0.getTokenSilently({
    authorizationParams: {
      audience: authConfig.audience,
      scope: "openid profile email",
    },
  });

  setToken(token);
  return token;
}

async function login() {
  await state.auth0.loginWithRedirect({
    authorizationParams: {
      audience: authConfig.audience,
      scope: "openid profile email",
    },
  });
}

async function signup() {
  await state.auth0.loginWithRedirect({
    authorizationParams: {
      audience: authConfig.audience,
      scope: "openid profile email",
      screen_hint: "signup",
    },
  });
}

async function logout() {
  cleanupRealtime();
  setToken("");
  state.user = null;
  await state.auth0.logout({
    logoutParams: {
      returnTo: window.location.origin,
    },
  });
}

async function handleCreateMarket(event) {
  event.preventDefault();
  const formData = new FormData(elements.createMarketForm);

  try {
    const payload = {
      bet_string: formData.get("bet_string"),
      is_yes_no: Boolean(formData.get("is_yes_no")),
      is_high_low: Boolean(formData.get("is_high_low")),
      end_time: new Date(formData.get("end_time")).toISOString(),
    };

    await api("/predictions/post-prediction", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    elements.createMarketForm.reset();
    setMessage("Prediction posted.");
    await loadMarkets();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function initializeAuth() {
  if (!window.auth0?.createAuth0Client) {
    throw new Error("Auth0 SDK failed to load.");
  }

  state.auth0 = await window.auth0.createAuth0Client({
    domain: authConfig.domain,
    clientId: authConfig.clientId,
    authorizationParams: {
      audience: authConfig.audience,
      redirect_uri: authConfig.redirectUri,
      scope: "openid profile email",
    },
    cacheLocation: "localstorage",
    useRefreshTokens: true,
  });

  const search = new URLSearchParams(window.location.search);
  const hasAuthRedirectParams = search.has("code") && search.has("state");

  if (hasAuthRedirectParams) {
    await state.auth0.handleRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const isAuthenticated = await state.auth0.isAuthenticated();
  if (!isAuthenticated) {
    setView("auth");
    return;
  }

  await refreshAccessToken();
  await bootAuthenticatedApp();
}

function attachEvents() {
  elements.loginButton.addEventListener("click", () => {
    login().catch((error) => setMessage(error.message, "error"));
  });
  elements.signupButton.addEventListener("click", () => {
    signup().catch((error) => setMessage(error.message, "error"));
  });
  elements.logoutButton.addEventListener("click", () => {
    logout().catch((error) => setMessage(error.message, "error"));
  });
  elements.refreshButton.addEventListener("click", async () => {
    try {
      await loadMarkets();
      setMessage("Markets refreshed.");
    } catch (error) {
      setMessage(error.message, "error");
    }
  });
  elements.createMarketForm.addEventListener("submit", handleCreateMarket);
}

async function initializeApp() {
  attachEvents();
  setView("auth");

  try {
    await initializeAuth();
  } catch (error) {
    setToken("");
    cleanupRealtime();
    setView("auth");
    setMessage(error.message, "error");
  }
}

initializeApp();
