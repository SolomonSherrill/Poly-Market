import { Block } from "./blockchain.js";
import { Blockchain } from "./blockchain.js";
import { TransactionQueue } from "./blockchain.js";

// State
const state = {
  token: localStorage.getItem("poly_token") || "",
  user: null,
  activeAuthTab: "login",
  pendingResetToken: "",
  // P2P additions
  myId: null,
  peers: new Map(),   // peerId -> RTCDataChannel
  seen: new Set(),    // dedup gossip by message hash
  chain: new Blockchain(),
};

// P2P MESH

const SIGNAL_URL = "wss://poly-market-production-8e9d.up.railway.app/connect";

let signalingWs = null;

function connectSignaling() {
  signalingWs = new WebSocket(SIGNAL_URL);

  signalingWs.onmessage = async (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === "PEERS") {
      state.myId = msg.your_id;
      for (const peerId of msg.connect_to) {
        await initiateConnection(peerId);
      }
    }
    else if (msg.type === "INCOMING_PEER") {
      // Server told us a new peer is about to send us an OFFER
      // nothing to do here we just wait for the OFFER
    }
    else if (msg.type === "CONNECT_TO_NEW_PEER") {
      // Server told us to connect to someone (emergency bridge or new peer)
      await initiateConnection(msg.peer_id);
    }
    else if (msg.type === "OFFER") {
      await answerConnection(msg.from, msg.sdp);
    }
    else if (msg.type === "ANSWER") {
      await state.peers.get(msg.from)?.pc.setRemoteDescription(msg.sdp);
    }
    else if (msg.type === "ICE") {
      await state.peers.get(msg.from)?.pc.addIceCandidate(msg.candidate);
    }
  };

  signalingWs.onclose = () => {
    // Reconnect after 3 seconds if connection drops
    setTimeout(connectSignaling, 3000);
  };
}

function signal(msg) {
  if (signalingWs?.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify(msg));
  }
}

function newPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      signal({ type: "ICE", to: peerId, from: state.myId, candidate: e.candidate });
    }
  };

  // Store pc under peerId so ANSWER/ICE handlers can find it
  state.peers.set(peerId, { pc, dc: null });
  return pc;
}

function setupDataChannel(dc, peerId) {
  state.peers.get(peerId).dc = dc;

  dc.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const hash = e.data;                  // raw string is fine as dedup key

    if (state.seen.has(hash)) return;
    state.seen.add(hash);

    handleGossip(msg);                    // process locally
    gossip(msg, peerId);                  // forward to other peers
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
  pc.ondatachannel = (e) => setupDataChannel(e.channel, peerId);

  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal({ type: "ANSWER", to: peerId, from: state.myId, sdp: answer });
}

function gossip(msg, excludePeerId = null) {
  const raw = JSON.stringify(msg);
  for (const [peerId, { dc }] of state.peers) {
    if (peerId !== excludePeerId && dc?.readyState === "open") {
      dc.send(raw);
    }
  }
}

function broadcast(msg) {
  // Originate a new message from this node
  const raw = JSON.stringify(msg);
  state.seen.add(raw);
  gossip(msg);
}

function handleGossip(msg) {
  // Handle blockchain messages arriving from peers
  if (msg.type === "NEW_BLOCK") {
    console.log("New block received:", msg.data);
    // TODO: validate and add to local chain
  }
  else if (msg.type === "NEW_TX") {
    console.log("New transaction received:", msg.data);
    // TODO: validate and add to local mempool
  }
}

// WIRE P2P INTO YOUR EXISTING AUTH FLOW

// In your existing bootAuthenticatedApp add connectSignaling()
async function bootAuthenticatedApp() {
  setView("dashboard");
  await Promise.all([loadUser(), loadMarkets()]);
  connectSignaling();                     // start P2P once logged in
}

// In your existing logout clean up P2P
function logout() {
  setToken("");
  state.user = null;

  // Clean up P2P
  signalingWs?.close();
  for (const { pc } of state.peers.values()) pc.close();
  state.peers.clear();
  state.seen.clear();
  state.myId = null;

  window.history.replaceState({}, "", "/");
  setView("auth");
  setMessage("Logged out.");
}

const elements = {
  authView: document.getElementById("auth-view"),
  dashboardView: document.getElementById("dashboard-view"),
  resetView: document.getElementById("reset-view"),
  messageBanner: document.getElementById("message-banner"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  forgotForm: document.getElementById("forgot-form"),
  resendForm: document.getElementById("resend-form"),
  resetPasswordForm: document.getElementById("reset-password-form"),
  createMarketForm: document.getElementById("create-market-form"),
  loginTab: document.getElementById("login-tab"),
  registerTab: document.getElementById("register-tab"),
  logoutButton: document.getElementById("logout-button"),
  refreshButton: document.getElementById("refresh-markets"),
  welcomeTitle: document.getElementById("welcome-title"),
  userName: document.getElementById("user-name"),
  userBalance: document.getElementById("user-balance"),
  userEmail: document.getElementById("user-email"),
  marketsList: document.getElementById("markets-list"),
  marketTemplate: document.getElementById("market-card-template"),
};

function setMessage(text, tone = "success") {
  if (!text) {
    elements.messageBanner.className = "message-banner hidden";
    elements.messageBanner.textContent = "";
    return;
  }

  elements.messageBanner.textContent = text;
  elements.messageBanner.className = `message-banner ${tone}`;
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

function switchTab(tab) {
  state.activeAuthTab = tab;
  const showLogin = tab === "login";
  elements.loginTab.classList.toggle("active", showLogin);
  elements.registerTab.classList.toggle("active", !showLogin);
  elements.loginForm.classList.toggle("hidden", !showLogin);
  elements.registerForm.classList.toggle("hidden", showLogin);
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

function renderMarketCard(prediction) {
  const fragment = elements.marketTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".market-card");
  const marketTag = fragment.querySelector(".market-tag");
  const marketEnd = fragment.querySelector(".market-end");
  const marketTitle = fragment.querySelector(".market-title");
  const yesVolume = fragment.querySelector(".yes-volume");
  const noVolume = fragment.querySelector(".no-volume");
  const betForm = fragment.querySelector(".bet-form");

  marketTag.textContent = prediction.bet_type === "high_low" ? "High / Low" : "Yes / No";
  marketEnd.textContent = `Closes ${formatDate(prediction.end_time)}`;
  marketTitle.textContent = prediction.bet_string;
  yesVolume.textContent = `Yes: ${formatMoney(prediction.total_yes)}`;
  noVolume.textContent = `No: ${formatMoney(prediction.total_no)}`;

  betForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const amount = Number(new FormData(betForm).get("amount"));
    const isYes = submitter?.dataset.side === "yes";

    try {
      await api("/predictions/back-prediction", {
        method: "POST",
        body: JSON.stringify({
          prediction_id: prediction._id,
          amount,
          is_yes: isYes,
        }),
      });
      betForm.reset();
      setMessage(`Order placed on "${prediction.bet_string}".`);
      await Promise.all([loadUser(), loadMarkets()]);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  elements.marketsList.appendChild(card);
}

async function loadUser() {
  const user = await api("/users/me");
  state.user = user;
  elements.userName.textContent = user.name;
  elements.userBalance.textContent = formatMoney(user.balance);
  elements.userEmail.textContent = user.email;
  elements.welcomeTitle.textContent = `Welcome back, ${user.name}`;
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

function setView(view) {
  const showAuth = view === "auth";
  const showReset = view === "reset";
  const showDashboard = view === "dashboard";

  elements.authView.classList.toggle("hidden", !showAuth);
  elements.resetView.classList.toggle("hidden", !showReset);
  elements.dashboardView.classList.toggle("hidden", !showDashboard);
  elements.logoutButton.classList.toggle("hidden", !showDashboard);
  elements.refreshButton.classList.toggle("hidden", !showDashboard);

  if (showAuth) {
    elements.welcomeTitle.textContent = "Sign in to your account";
  }
  if (showReset) {
    elements.welcomeTitle.textContent = "Finish resetting your password";
  }
}

async function bootAuthenticatedApp() {
  setView("dashboard");
  await Promise.all([loadUser(), loadMarkets()]);
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(elements.loginForm);

  try {
    const payload = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    setToken(payload.token);
    elements.loginForm.reset();
    setMessage("Login successful.");
    await bootAuthenticatedApp();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(elements.registerForm);

  try {
    const payload = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    elements.registerForm.reset();
    switchTab("login");
    setMessage(payload.message || "Account created. Check your email to verify.");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function handleForgot(event) {
  event.preventDefault();
  const formData = new FormData(elements.forgotForm);
  const email = formData.get("email");

  try {
    const payload = await api("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setMessage(payload.message || "Reset email sent.");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function handleResend(event) {
  event.preventDefault();
  const formData = new FormData(elements.resendForm);
  const email = formData.get("email");

  try {
    const payload = await api("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setMessage(payload.message || "Verification email sent.");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const formData = new FormData(elements.resetPasswordForm);

  try {
    const payload = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        token: state.pendingResetToken,
        new_password: formData.get("new_password"),
      }),
    });
    elements.resetPasswordForm.reset();
    state.pendingResetToken = "";
    window.history.replaceState({}, "", "/");
    setView("auth");
    switchTab("login");
    setMessage(payload.message || "Password reset complete.");
  } catch (error) {
    setMessage(error.message, "error");
  }
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

async function handleQueryMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const token = params.get("token");

  if (mode === "verify" && token) {
    try {
      const payload = await api(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
        headers: { Accept: "application/json" },
      });
      window.history.replaceState({}, "", "/");
      setView("auth");
      switchTab("login");
      setMessage(payload.message || "Email verified successfully.");
      return true;
    } catch (error) {
      window.history.replaceState({}, "", "/");
      setView("auth");
      setMessage(error.message, "error");
      return true;
    }
  }

  if (mode === "reset" && token) {
    state.pendingResetToken = token;
    setView("reset");
    return true;
  }

  return false;
}

function logout() {
  setToken("");
  state.user = null;
  window.history.replaceState({}, "", "/");
  setView("auth");
  setMessage("Logged out.");
}

function attachEvents() {
  elements.loginTab.addEventListener("click", () => switchTab("login"));
  elements.registerTab.addEventListener("click", () => switchTab("register"));
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.registerForm.addEventListener("submit", handleRegister);
  elements.forgotForm.addEventListener("submit", handleForgot);
  elements.resendForm.addEventListener("submit", handleResend);
  elements.resetPasswordForm.addEventListener("submit", handleResetPassword);
  elements.createMarketForm.addEventListener("submit", handleCreateMarket);
  elements.logoutButton.addEventListener("click", logout);
  elements.refreshButton.addEventListener("click", async () => {
    try {
      await Promise.all([loadUser(), loadMarkets()]);
      setMessage("Markets refreshed.");
    } catch (error) {
      setMessage(error.message, "error");
    }
  });
}

async function init() {
  attachEvents();
  switchTab("login");

  const handledQueryMode = await handleQueryMode();
  if (handledQueryMode) {
    return;
  }

  if (!state.token) {
    setView("auth");
    return;
  }

  try {
    await bootAuthenticatedApp();
  } catch (_error) {
    logout();
    setMessage("Your session expired. Please log in again.", "error");
  }
}

init();
