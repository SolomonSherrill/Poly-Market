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
  market: new Map(),
  marketCards: new Map(),
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const elements = {
  authView: document.getElementById("auth-view"),
  dashboardView: document.getElementById("dashboard-view"),
  messageBanner: document.getElementById("message-banner"),
  authTitle: document.getElementById("auth-title"),
  authStatus: document.getElementById("auth-status"),
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

function setAuthStatus(text) {
  if (elements.authStatus) {
    elements.authStatus.textContent = text;
  }
}

function setAuthButtonsDisabled(disabled) {
  elements.loginButton.disabled = disabled;
  elements.signupButton.disabled = disabled;
}

function buildAuthorizeUrl(mode = "login") {
  const url = new URL(`https://${authConfig.domain}/authorize`);
  url.searchParams.set("client_id", authConfig.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", authConfig.redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("audience", authConfig.audience);
  if (mode === "signup") {
    url.searchParams.set("screen_hint", "signup");
  }
  return url.toString();
}

function redirectToUniversalLogin(mode = "login") {
  window.location.assign(buildAuthorizeUrl(mode));
}

async function waitForAuth0Sdk(timeoutMs = 8000) {
  const start = Date.now();

  while (!window.auth0?.createAuth0Client) {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  return true;
}

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

function isHighLowPrediction(prediction) {
  return prediction?.bet_type === "high_low" || prediction?.bet_type === "highLow";
}

function normalizePrediction(prediction) {
  return {
    ...prediction,
    id: prediction.id || prediction._id || prediction.prediction_id,
    _id: prediction._id || prediction.id || prediction.prediction_id,
    bet_type: isHighLowPrediction(prediction) ? "high_low" : "yes_no",
    total_yes: Number(prediction.total_yes || 0),
    total_no: Number(prediction.total_no || 0),
  };
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

function handleGossip(type,data) {
  state.chain.enqueueEvent(type,data);
  console.log(type + " event received:", data);
  if (type === "BET_PLACED") {
    const existing = state.market.get(data.prediction_id);
    if (!existing) return;

    state.market.set(data.prediction_id, {
      ...existing,
      total_yes: existing.total_yes + (data.is_yes ? data.amount : 0),
      total_no: existing.total_no + (!data.is_yes ? data.amount : 0),
    });

    const prediction = state.market.get(data.prediction_id);
    updateMarketCard(prediction);
  } else if (type === "PREDICTION_CREATED") {
    const prediction = normalizePrediction(data);
    state.market.set(prediction.id, prediction);
    if (!state.marketCards.has(prediction.id)) {
      renderMarketCard(prediction);
    }
  } else if (type === "NEW_BLOCK") {
    console.log("New block received:", data);
  } else if (type === "USER_CREATED") {
    console.log("New user created:", data);
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

async function broadcastBlockchainEvent(dataType,eventData) {
  await handleGossip(dataType,eventData);
  gossip({
    type: dataType,
    data: eventData,
  });
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
    broadcastBlockchainEvent(message.type, message.data);
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

async function loadUser() {
  const user = await api("/users/me");
  state.user = user;
  elements.userName.textContent = user.name || "Auth0 User";
  elements.userBalance.textContent = formatMoney(user.balance);
  elements.userEmail.textContent = user.email || "-";
  elements.welcomeTitle.textContent = `Welcome back, ${user.name || "trader"}`;

  if (user.was_just_created) {
    await broadcastBlockchainEvent("USER_CREATED", {
      user_id: state.user.id,
      name: user.name || "Auth0 User",
      email: user.email || null,
      starting_balance: user.balance,
      timestamp: Date.now(),
    });
  }
}

function renderMarketCard(prediction) {
  const normalizedPrediction = normalizePrediction(prediction);
  const predictionId = normalizedPrediction.id;
  const fragment = elements.marketTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".market-card");
  const marketTag = fragment.querySelector(".market-tag");
  const marketEnd = fragment.querySelector(".market-end");
  const marketTitle = fragment.querySelector(".market-title");
  const betForm = fragment.querySelector(".bet-form");
  const yesButton = fragment.querySelector('[data-side="yes"]');
  const noButton = fragment.querySelector('[data-side="no"]');
  
  const isHighLow = normalizedPrediction.bet_type === "high_low";
  marketTag.textContent = isHighLow ? "High / Low" : "Yes / No";
  marketEnd.textContent = `Closes ${formatDate(normalizedPrediction.end_time)}`;
  marketTitle.textContent = normalizedPrediction.bet_string;
  yesButton.textContent = isHighLow ? "Buy High" : "Buy Yes";
  noButton.textContent = isHighLow ? "Buy Low" : "Buy No";
  updateMarketCard(normalizedPrediction, card);

  betForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const amount = Number(new FormData(betForm).get("amount"));
    const isYes = submitter?.dataset.side === "yes";

    try {
      const response = await api("/predictions/back-prediction", {
        method: "POST",
        body: JSON.stringify({
          prediction_id: predictionId,
          amount,
          is_yes: isYes,
          timestamp: Date.now(),
        }),
      });

      if (response?.success === false) {
        throw new Error(response.message || "Order failed.");
      }

      await broadcastBlockchainEvent("BET_PLACED", {
        prediction_id: predictionId,
        amount,
        is_yes: isYes,
        user_id: state.user.id,
        timestamp: Date.now(),
      });
      betForm.reset();
      setMessage(`Order placed on "${normalizedPrediction.bet_string}".`);
      await loadUser();
    } catch (error) {
      setMessage(error.message, "error");
      await loadMarkets();
    }
  });

  elements.marketsList.appendChild(card);
  state.marketCards.set(predictionId, card);
  return card;
}

function updateMarketCard(prediction, existingCard = null) {
  const normalizedPrediction = normalizePrediction(prediction);
  const predictionId = normalizedPrediction.id;
  const card = existingCard || state.marketCards.get(predictionId);
  if (!card) {
    return;
  }

  const isHighLow = normalizedPrediction.bet_type === "high_low";
  const yesVolume = card.querySelector(".yes-volume");
  const noVolume = card.querySelector(".no-volume");

  yesVolume.textContent = `${isHighLow ? "High" : "Yes"}: ${formatMoney(normalizedPrediction.total_yes)}`;
  noVolume.textContent = `${isHighLow ? "Low" : "No"}: ${formatMoney(normalizedPrediction.total_no)}`;
}

async function loadMarkets() {
  elements.marketsList.innerHTML = "";
  state.market.clear();
  state.marketCards.clear();
  const predictions = await api("/predictions/get-all-predictions");

  if (!predictions.length) {
    elements.marketsList.innerHTML = '<article class="panel">No active markets yet. Post the first one above.</article>';
    return;
  }

  for (const prediction of predictions) {
    const normalizedPrediction = normalizePrediction(prediction);
    state.market.set(normalizedPrediction.id, normalizedPrediction);
    renderMarketCard(normalizedPrediction);
  }
}

function setupPredictionTypeToggles() {
  const yesNoToggle = elements.createMarketForm?.querySelector('input[name="is_yes_no"]');
  const highLowToggle = elements.createMarketForm?.querySelector('input[name="is_high_low"]');

  if (!yesNoToggle || !highLowToggle) {
    return;
  }

  const syncToggles = (selectedToggle, otherToggle) => {
    if (selectedToggle.checked) {
      otherToggle.checked = false;
      return;
    }

    if (!otherToggle.checked) {
      selectedToggle.checked = true;
    }
  };

  yesNoToggle.addEventListener("change", () => syncToggles(yesNoToggle, highLowToggle));
  highLowToggle.addEventListener("change", () => syncToggles(highLowToggle, yesNoToggle));
}

function createShortNonce(byteLength = 4) {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildPredictionId(userId, betString) {
  const nonce = createShortNonce();
  return sha256Hex(`${userId}|${String(betString || "").trim()}|${nonce}`);
}

async function bootAuthenticatedApp() {
  setView("dashboard");
  await Promise.all([loadUser(), loadMarkets()]);
  await loadIceServers();
  connectSignaling();
}

async function refreshAccessToken() {
  if (!state.auth0) {
    return "";
  }

  let token = "";
  try {
    token = await state.auth0.getTokenSilently({
      authorizationParams: {
        audience: authConfig.audience,
        scope: "openid profile email",
      },
    });
  } catch (error) {
    // Fall back to an interactive token fetch when silent auth cannot refresh.
    if (error?.message?.includes("Missing Refresh Token")) {
      token = await state.auth0.getTokenWithPopup({
        authorizationParams: {
          audience: authConfig.audience,
          scope: "openid profile email",
        },
      });
    } else {
      throw error;
    }
  }

  setToken(token);
  return token;
}

async function login() {
  if (!state.auth0) {
    redirectToUniversalLogin("login");
    return;
  }

  await state.auth0.loginWithRedirect({
    authorizationParams: {
      audience: authConfig.audience,
      scope: "openid profile email",
    },
  });
}

async function signup() {
  if (!state.auth0) {
    redirectToUniversalLogin("signup");
    return;
  }

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

  if (!state.auth0) {
    window.location.assign(window.location.origin);
    return;
  }

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
    const isYesNo = formData.get("is_yes_no") === "on";
    const isHighLow = formData.get("is_high_low") === "on";
    const betString = String(formData.get("bet_string") || "").trim();
    const endTime = new Date(formData.get("end_time")).toISOString();
    const predictionId = await buildPredictionId(state.user.id, betString);
    const payload = {
      prediction_id: predictionId,
      bet_string: betString,
      is_high_low: isHighLow,
      is_yes_no: isYesNo,
      end_time: endTime,
    };

    const prediction = normalizePrediction(await api("/predictions/post-prediction", {
      method: "POST",
      body: JSON.stringify(payload),
    }));
    await broadcastBlockchainEvent("PREDICTION_CREATED", {
      ...prediction,
      prediction_id: prediction.id,
      timestamp: Date.now(),
    });
    elements.createMarketForm.reset();
    setMessage("Prediction posted.");
  } catch (error) {
    setMessage(error.message, "error");
    await loadMarkets();
  }
}

async function initializeAuth() {
  setAuthButtonsDisabled(true);
  setAuthStatus("Connecting to Auth0...");

  const sdkLoaded = await waitForAuth0Sdk();
  if (!sdkLoaded) {
    setAuthButtonsDisabled(false);
    setAuthStatus("Auth0 SDK did not load. The buttons will use a direct redirect fallback.");
    return;
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
    useRefreshTokens: false,
  });

  const search = new URLSearchParams(window.location.search);
  const hasAuthRedirectParams = search.has("code") && search.has("state");

  if (hasAuthRedirectParams) {
    setAuthStatus("Finishing sign-in...");
    await state.auth0.handleRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const isAuthenticated = await state.auth0.isAuthenticated();
  if (!isAuthenticated) {
    setAuthButtonsDisabled(false);
    setAuthStatus("Choose sign in if you already have an account, or create one through Auth0.");
    setView("auth");
    return;
  }

  await refreshAccessToken();
  await bootAuthenticatedApp();
  setAuthButtonsDisabled(false);
  setAuthStatus("Signed in.");
}

function attachEvents() {
  setupPredictionTypeToggles();
  elements.loginButton.addEventListener("click", () => {
    setAuthStatus("Redirecting to Auth0 sign in...");
    login().catch((error) => {
      setAuthButtonsDisabled(false);
      setAuthStatus("Sign in could not start.");
      setMessage(error.message, "error");
    });
  });
  elements.signupButton.addEventListener("click", () => {
    setAuthStatus("Redirecting to Auth0 sign up...");
    signup().catch((error) => {
      setAuthButtonsDisabled(false);
      setAuthStatus("Sign up could not start.");
      setMessage(error.message, "error");
    });
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
  setAuthStatus("Preparing login...");

  try {
    await initializeAuth();
  } catch (error) {
    setToken("");
    cleanupRealtime();
    setAuthButtonsDisabled(false);
    setView("auth");
    setAuthStatus("Login is available, but setup needs attention.");
    setMessage(error.message, "error");
  }
}

initializeApp();
