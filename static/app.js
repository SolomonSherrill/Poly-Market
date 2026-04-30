import { hideChartHover, updateChartHover } from "./app/charts.js";
import { createMarketsController } from "./app/markets.js";
import { createRealtimeController } from "./app/realtime.js";
import { createSessionController } from "./app/session.js";
import {
  elements,
  setAuthButtonsDisabled,
  setAuthStatus,
  setMessage,
  setToken,
  setView,
  state,
} from "./app/shared.js";

function setTabState(tabName) {
  state.activeTab = tabName;

  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
  }
}

<<<<<<< HEAD
let marketsController = null;

const realtimeController = createRealtimeController({
  onRemoteBet(data) {
    marketsController?.applyRemoteBet(data);
  },
  onRemotePrediction(prediction) {
    marketsController?.applyRemotePrediction(prediction);
  },
});

const sessionController = createSessionController({
  broadcastBlockchainEvent: realtimeController.broadcastBlockchainEvent,
  cleanupRealtime: realtimeController.cleanupRealtime,
  connectSignaling: realtimeController.connectSignaling,
  loadIceServers: realtimeController.loadIceServers,
  loadMarkets: async () => marketsController?.loadMarkets(),
  setActiveTab: (tabName) => {
    setTabState(tabName);
    marketsController?.syncRouteViews();
  },
});

marketsController = createMarketsController({
  setMessage,
  refreshUser: sessionController.loadUser,
  broadcastBlockchainEvent: realtimeController.broadcastBlockchainEvent,
  setActiveTab: (tabName) => {
    setTabState(tabName);
    marketsController?.syncRouteViews();
  },
});

function setActiveTab(tabName) {
  setTabState(tabName);
  marketsController.syncRouteViews();
=======
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
    renderMarketsView(data.prediction_id);
  } else if (type === "PREDICTION_CREATED") {
    const prediction = normalizePrediction(data);
    state.market.set(prediction.id, prediction);
    elements.marketCount.textContent = String(state.market.size);
    renderMarketsView(getPredictionRouteId() || state.selectedPredictionId || prediction.id);
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
  state.userProfiles.set(user.id, user);
  elements.userName.textContent = user.name || "Auth0 User";
  elements.userBalance.textContent = formatMoney(user.balance);
  elements.userEmail.textContent = user.email || "-";
  elements.accountUserName.textContent = user.name || "Auth0 User";
  elements.accountUserBalance.textContent = formatMoney(user.balance);
  elements.accountUserEmail.textContent = user.email || "-";
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
  const cardButton = fragment.querySelector(".market-card-button");
  const marketTag = fragment.querySelector(".market-tag");
  const marketEnd = fragment.querySelector(".market-end");
  const marketTitle = fragment.querySelector(".market-title");
  const marketTotalVolume = fragment.querySelector(".market-total-volume");
  const yesPercent = fragment.querySelector(".yes-percent");
  const noPercent = fragment.querySelector(".no-percent");
  const outcomeALabel = fragment.querySelector(".outcome-a-label");
  const outcomeBLabel = fragment.querySelector(".outcome-b-label");
  const cardYesBar = fragment.querySelector(".card-yes-bar");
  const cardNoBar = fragment.querySelector(".card-no-bar");
  const probabilitySummary = fragment.querySelector(".market-probability-summary");
  const creatorLink = fragment.querySelector(".creator-link");

  const labels = getPredictionOutcomeLabels(normalizedPrediction);
  const isHighLow = normalizedPrediction.bet_type === "high_low";
  marketTag.textContent = isHighLow ? "High / Low" : "Yes / No";
  marketEnd.textContent = `Closes ${formatDate(normalizedPrediction.end_time)}`;
  marketTitle.textContent = normalizedPrediction.bet_string;
  outcomeALabel.textContent = `${labels.positive} chance`;
  outcomeBLabel.textContent = `${labels.negative} chance`;
  marketTotalVolume.textContent = formatMoney(0);
  yesPercent.textContent = "50%";
  noPercent.textContent = "50%";
  cardYesBar.style.width = "50%";
  cardNoBar.style.width = "50%";
  probabilitySummary.textContent = "Awaiting first trade";
  attachCreatorLink(creatorLink, normalizedPrediction.creator_id);
  updateMarketCard(normalizedPrediction, card);

  cardButton.addEventListener("click", () => {
    setPredictionRoute(predictionId);
    state.activeTab = "predictions";
    syncRouteViews();
  });
  cardButton.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    setPredictionRoute(predictionId);
    state.activeTab = "predictions";
    syncRouteViews();
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
  const totalVolume = card.querySelector(".market-total-volume");
  const yesPercent = card.querySelector(".yes-percent");
  const noPercent = card.querySelector(".no-percent");
  const outcomeALabel = card.querySelector(".outcome-a-label");
  const outcomeBLabel = card.querySelector(".outcome-b-label");
  const cardYesBar = card.querySelector(".card-yes-bar");
  const cardNoBar = card.querySelector(".card-no-bar");
  const probabilitySummary = card.querySelector(".market-probability-summary");
  const metrics = getPredictionMetrics(normalizedPrediction);
  const labels = getPredictionOutcomeLabels(normalizedPrediction);

  outcomeALabel.textContent = `${labels.positive} chance`;
  outcomeBLabel.textContent = `${labels.negative} chance`;
  yesVolume.textContent = `${labels.positive}: ${formatMoney(metrics.yesAmount)}`;
  noVolume.textContent = `${labels.negative}: ${formatMoney(metrics.noAmount)}`;
  totalVolume.textContent = formatMoney(metrics.totalVolume);
  yesPercent.textContent = metrics.totalVolume > 0 ? formatPercent(metrics.yesPercent) : "--";
  noPercent.textContent = metrics.totalVolume > 0 ? formatPercent(metrics.noPercent) : "--";
  cardYesBar.style.width = `${metrics.yesPercent}%`;
  cardNoBar.style.width = `${metrics.noPercent}%`;
  const spread = Math.abs(metrics.yesPercent - metrics.noPercent);
  probabilitySummary.textContent = metrics.totalVolume <= 0
    ? "No trades yet"
    : spread === 0
      ? "Balanced activity so far"
      : `${labels.positive} leads by ${spread} points`;
  card.classList.toggle("active", state.selectedPredictionId === predictionId);

  if (state.selectedPredictionId === predictionId) {
    renderSelectedPrediction(normalizedPrediction);
  }
}

function clearSelectedPrediction() {
  state.selectedPredictionId = null;
  elements.marketDetail.classList.add("hidden");

  for (const card of state.marketCards.values()) {
    card.classList.remove("active");
  }
}

function renderSelectedPrediction(prediction) {
  const normalizedPrediction = normalizePrediction(prediction);
  const metrics = getPredictionMetrics(normalizedPrediction);
  const isHighLow = normalizedPrediction.bet_type === "high_low";
  const labels = getPredictionOutcomeLabels(normalizedPrediction);

  elements.predictionDetailMissing.classList.add("hidden");
  elements.marketDetail.classList.remove("hidden");
  elements.detailMarketTag.textContent = isHighLow ? "High / Low" : "Yes / No";
  elements.detailMarketEnd.textContent = `Closes ${formatDate(normalizedPrediction.end_time)}`;
  elements.detailMarketTitle.textContent = normalizedPrediction.bet_string;
  elements.detailTotalVolume.textContent = formatMoney(metrics.totalVolume);
  elements.detailYesLabel.textContent = `${labels.positive} chance`;
  elements.detailNoLabel.textContent = `${labels.negative} chance`;
  elements.detailYesPercent.textContent = metrics.totalVolume > 0 ? formatPercent(metrics.yesPercent) : "--";
  elements.detailNoPercent.textContent = metrics.totalVolume > 0 ? formatPercent(metrics.noPercent) : "--";
  elements.detailYesBar.style.width = `${metrics.yesPercent}%`;
  elements.detailNoBar.style.width = `${metrics.noPercent}%`;
  elements.detailProbabilitySummary.textContent = metrics.totalVolume > 0
    ? `${labels.positive} implied chance ${formatPercent(metrics.yesPercent)} from current observed market balance`
    : "No trades have been placed yet, so the market has not formed a price";
  elements.detailYesVolume.textContent = `${labels.positive} volume: ${formatMoney(metrics.yesAmount)}`;
  elements.detailNoVolume.textContent = `${labels.negative} volume: ${formatMoney(metrics.noAmount)}`;
  elements.detailYesButton.textContent = `Buy ${labels.positive}`;
  elements.detailNoButton.textContent = `Buy ${labels.negative}`;
  attachCreatorLink(elements.detailCreatorLink, normalizedPrediction.creator_id);
  renderPredictionHistory(normalizedPrediction);
}

function selectPrediction(predictionId) {
  const prediction = state.market.get(predictionId);
  if (!prediction) {
    clearSelectedPrediction();
    return;
  }

  state.selectedPredictionId = predictionId;

  for (const [id, card] of state.marketCards) {
    card.classList.toggle("active", id === predictionId);
  }

  renderSelectedPrediction(prediction);
}

function renderProfilePredictionList(predictions) {
  elements.profilePredictionsList.innerHTML = "";
  elements.profilePredictionsEmpty.classList.toggle("hidden", predictions.length > 0);

  for (const prediction of predictions) {
    const normalizedPrediction = normalizePrediction(prediction);
    const card = document.createElement("article");
    card.className = "profile-prediction-card";

    const title = document.createElement("h4");
    title.textContent = normalizedPrediction.bet_string;

    const meta = document.createElement("div");
    meta.className = "profile-prediction-meta";

    const type = document.createElement("span");
    type.className = "market-tag";
    type.textContent = normalizedPrediction.bet_type === "high_low" ? "High / Low" : "Yes / No";

    const created = document.createElement("span");
    created.className = "market-end";
    created.textContent = `Created ${formatDate(normalizedPrediction.created_at)}`;

    const ends = document.createElement("span");
    ends.className = "market-end";
    ends.textContent = `Closes ${formatDate(normalizedPrediction.end_time)}`;

    meta.append(type, created, ends);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button profile-prediction-open";
    button.textContent = "Open prediction";
    button.addEventListener("click", () => {
      setPredictionRoute(normalizedPrediction.id);
      state.activeTab = "predictions";
      syncRouteViews();
      renderMarketsView(normalizedPrediction.id);
    });

    card.append(title, meta, button);
    elements.profilePredictionsList.appendChild(card);
  }
}

async function renderProfilePage(userId) {
  elements.profileView.classList.remove("hidden");
  elements.profileMissing.classList.add("hidden");
  elements.profileContent.classList.add("hidden");

  if (!userId) {
    elements.profileMissing.classList.remove("hidden");
    return;
  }

  try {
    const [profile, predictions] = await Promise.all([
      ensureUserProfile(userId),
      api(`/users/${encodeURIComponent(userId)}/predictions`),
    ]);

    elements.profilePicture.src = profile?.picture || "";
    elements.profilePicture.classList.toggle("hidden", !profile?.picture);
    elements.profilePicture.alt = `${getUserDisplayName(userId, profile)} profile picture`;
    elements.profileName.textContent = getUserDisplayName(userId, profile);
    elements.profileEmail.textContent = profile?.email || "-";
    elements.profileCreatedAt.textContent = `Joined ${formatRelativeTime(profile?.created_at)}`;
    elements.profileBalance.textContent = formatMoney(profile?.balance);
    elements.profileTotalWins.textContent = String(profile?.total_wins ?? 0);
    elements.profileTotalLosses.textContent = String(profile?.total_losses ?? 0);
    elements.profileNetProfit.textContent = formatMoney(profile?.net_profit);
    renderProfilePredictionList(Array.isArray(predictions) ? predictions : []);

    elements.profileContent.classList.remove("hidden");
  } catch (_error) {
    elements.profileMissing.classList.remove("hidden");
    elements.profileContent.classList.add("hidden");
  }
}

function syncRouteViews() {
  const profileRouteId = getProfileRouteId();
  if (profileRouteId && state.activeTab !== "profiles") {
    state.activeTab = "profiles";
  } else if (!profileRouteId && state.activeTab === "profiles") {
    state.activeTab = "predictions";
  }

  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle("hidden", panel.dataset.panel !== state.activeTab);
  }

  const isProfilesTab = state.activeTab === "profiles";
  elements.profileView.classList.toggle("hidden", !isProfilesTab || !profileRouteId);

  if (isProfilesTab && profileRouteId) {
    elements.predictionsBrowseView.classList.add("hidden");
    elements.predictionDetailView.classList.add("hidden");
    renderProfilePage(profileRouteId);
    return;
  }

  const routeId = getPredictionRouteId();
  const isPredictionsTab = state.activeTab === "predictions";
  const showDetail = isPredictionsTab && Boolean(routeId);

  elements.predictionsBrowseView.classList.toggle("hidden", !isPredictionsTab || showDetail);
  elements.predictionDetailView.classList.toggle("hidden", !showDetail);

  if (!showDetail) {
    return;
  }

  const prediction = state.market.get(routeId);
  if (!prediction) {
    clearSelectedPrediction();
    elements.predictionDetailMissing.classList.remove("hidden");
    elements.marketDetail.classList.add("hidden");
    return;
  }

  selectPrediction(routeId);
}

async function handlePlaceBet(event) {
  event.preventDefault();
  const predictionId = state.selectedPredictionId;
  const prediction = state.market.get(predictionId);
  if (!prediction) {
    setMessage("Select a prediction before placing a trade.", "error");
    return;
  }

  const submitter = event.submitter;
  const amount = Number(new FormData(elements.detailBetForm).get("amount"));
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
    elements.detailBetForm.reset();
    setMessage(`Order placed on "${prediction.bet_string}".`);
    await loadUser();
  } catch (error) {
    setMessage(error.message, "error");
    await loadMarkets();
  }
}

async function loadMarkets() {
  const previousSelection = getPredictionRouteId() || state.selectedPredictionId;
  state.market.clear();
  const predictions = await api("/predictions/get-all-predictions");
  elements.marketCount.textContent = String(predictions.length);

  if (!predictions.length) {
    elements.marketsList.innerHTML = "";
    state.marketCards.clear();
    setMarketsEmptyState({
      kickerText: "Open markets",
      title: "No active markets yet.",
      copy: "Post the first prediction from the Create tab to start the order flow.",
      hidden: false,
    });
    clearSelectedPrediction();
    return;
  }

  for (const prediction of predictions) {
    const normalizedPrediction = normalizePrediction(prediction);
    state.market.set(normalizedPrediction.id, normalizedPrediction);
  }

  renderMarketsView(previousSelection);
}

function renderMarketsView(preferredSelectionId = state.selectedPredictionId) {
  const predictions = getFilteredSortedPredictions();
  elements.marketsList.innerHTML = "";
  state.marketCards.clear();

  if (!state.market.size) {
    setMarketsEmptyState({
      kickerText: "Open markets",
      title: "No active markets yet.",
      copy: "Post the first prediction from the Create tab to start the order flow.",
      hidden: false,
    });
    clearSelectedPrediction();
    syncRouteViews();
    return;
  }

  if (!predictions.length) {
    setMarketsEmptyState({
      kickerText: "Filtered results",
      title: "No predictions match the current search and filter settings.",
      copy: "Try a different keyword, broaden the market type filter, or switch the sort order.",
      hidden: false,
    });
    clearSelectedPrediction();
    syncRouteViews();
    return;
  }

  setMarketsEmptyState({ hidden: true });

  for (const prediction of predictions) {
    renderMarketCard(prediction);
  }

  const routeId = getPredictionRouteId();
  if (routeId) {
    syncRouteViews();
    return;
  }

  if (preferredSelectionId && state.marketCards.has(preferredSelectionId)) {
    state.selectedPredictionId = preferredSelectionId;
  }

  syncRouteViews();
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
  setActiveTab(state.activeTab);
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
    setActiveTab("predictions");
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
>>>>>>> parent of cff7030 (Chain sharing on login added)
}

function attachEvents() {
  marketsController.setupPredictionTypeToggles();

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  }

  elements.loginButton.addEventListener("click", () => {
    setAuthStatus("Redirecting to Auth0 sign in...");
    sessionController.login().catch((error) => {
      setAuthButtonsDisabled(false);
      setAuthStatus("Sign in could not start.");
      setMessage(error.message, "error");
    });
  });

  elements.signupButton.addEventListener("click", () => {
    setAuthStatus("Redirecting to Auth0 sign up...");
    sessionController.signup().catch((error) => {
      setAuthButtonsDisabled(false);
      setAuthStatus("Sign up could not start.");
      setMessage(error.message, "error");
    });
  });

  elements.logoutButton.addEventListener("click", () => {
    sessionController.logout().catch((error) => setMessage(error.message, "error"));
  });

  elements.refreshButton.addEventListener("click", async () => {
    try {
      await marketsController.loadMarkets();
      setMessage("Markets refreshed.");
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  elements.marketSearch.addEventListener("input", () => {
    marketsController.renderMarketsView();
  });
  elements.marketFilter.addEventListener("change", () => {
    marketsController.renderMarketsView();
  });
  elements.marketSort.addEventListener("change", () => {
    marketsController.renderMarketsView();
  });

  elements.detailChartOverlay.addEventListener("pointermove", (event) => {
    updateChartHover(event.clientX);
  });
  elements.detailChartOverlay.addEventListener("pointerenter", (event) => {
    updateChartHover(event.clientX);
  });
  elements.detailChartOverlay.addEventListener("pointerleave", () => {
    hideChartHover();
  });

  elements.createMarketForm.addEventListener("submit", marketsController.handleCreateMarket);
  elements.detailBetForm.addEventListener("submit", marketsController.handlePlaceBet);
  elements.backToMarketsButton.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("prediction");
    window.history.pushState({}, "", url);
    state.activeTab = "predictions";
    marketsController.syncRouteViews();
    marketsController.renderMarketsView();
  });
  elements.backToPredictionsButton.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("profile");
    window.history.pushState({}, "", url);
    state.activeTab = "predictions";
    marketsController.syncRouteViews();
    marketsController.renderMarketsView();
  });
  window.addEventListener("popstate", () => {
    marketsController.syncRouteViews();
    marketsController.renderMarketsView();
  });
}

async function initializeApp() {
  attachEvents();
  setActiveTab("predictions");
  setView("auth");
  setAuthStatus("Preparing login...");

  try {
    await sessionController.initializeAuth();
  } catch (error) {
    setToken("");
    realtimeController.cleanupRealtime();
    setAuthButtonsDisabled(false);
    setView("auth");
    setAuthStatus("Login is available, but setup needs attention.");
    setMessage(error.message, "error");
  }
}

initializeApp();
