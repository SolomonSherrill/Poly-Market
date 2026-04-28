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
  userProfiles: new Map(),
  userProfileRequests: new Map(),
  activeTab: "predictions",
  selectedPredictionId: null,
  activeChartHistory: [],
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
  accountUserName: document.getElementById("account-user-name"),
  accountUserBalance: document.getElementById("account-user-balance"),
  accountUserEmail: document.getElementById("account-user-email"),
  marketCount: document.getElementById("market-count"),
  marketSearch: document.getElementById("market-search"),
  marketFilter: document.getElementById("market-filter"),
  marketSort: document.getElementById("market-sort"),
  marketsEmpty: document.getElementById("markets-empty"),
  marketsList: document.getElementById("markets-list"),
  marketTemplate: document.getElementById("market-card-template"),
  tabButtons: document.querySelectorAll("[data-tab]"),
  tabPanels: document.querySelectorAll("[data-panel]"),
  predictionsBrowseView: document.getElementById("predictions-browse-view"),
  predictionDetailView: document.getElementById("prediction-detail-view"),
  predictionDetailMissing: document.getElementById("prediction-detail-missing"),
  backToMarketsButton: document.getElementById("back-to-markets"),
  marketDetail: document.getElementById("market-detail"),
  detailCreatorLink: document.getElementById("detail-creator-link"),
  detailMarketTag: document.getElementById("detail-market-tag"),
  detailMarketEnd: document.getElementById("detail-market-end"),
  detailMarketTitle: document.getElementById("detail-market-title"),
  detailTotalVolume: document.getElementById("detail-total-volume"),
  detailYesLabel: document.getElementById("detail-yes-label"),
  detailNoLabel: document.getElementById("detail-no-label"),
  detailYesPercent: document.getElementById("detail-yes-percent"),
  detailNoPercent: document.getElementById("detail-no-percent"),
  detailYesBar: document.getElementById("detail-yes-bar"),
  detailNoBar: document.getElementById("detail-no-bar"),
  detailProbabilitySummary: document.getElementById("detail-probability-summary"),
  detailYesVolume: document.getElementById("detail-yes-volume"),
  detailNoVolume: document.getElementById("detail-no-volume"),
  detailChartCaption: document.getElementById("detail-chart-caption"),
  detailChartEmpty: document.getElementById("detail-chart-empty"),
  detailChartFrame: document.getElementById("detail-chart-frame"),
  detailPriceChart: document.getElementById("detail-price-chart"),
  detailChartGrid: document.getElementById("detail-chart-grid"),
  detailChartYAxis: document.getElementById("detail-chart-y-axis"),
  detailChartXAxis: document.getElementById("detail-chart-x-axis"),
  detailChartArea: document.getElementById("detail-chart-area"),
  detailChartLine: document.getElementById("detail-chart-line"),
  detailChartHoverLine: document.getElementById("detail-chart-hover-line"),
  detailChartHoverDot: document.getElementById("detail-chart-hover-dot"),
  detailChartOverlay: document.getElementById("detail-chart-overlay"),
  detailChartTooltip: document.getElementById("detail-chart-tooltip"),
  detailChartTooltipTime: document.getElementById("detail-chart-tooltip-time"),
  detailChartTooltipPrice: document.getElementById("detail-chart-tooltip-price"),
  detailChartTooltipVolume: document.getElementById("detail-chart-tooltip-volume"),
  detailBetForm: document.getElementById("detail-bet-form"),
  detailStakeInput: document.getElementById("detail-stake-input"),
  detailYesButton: document.getElementById("detail-yes-button"),
  detailNoButton: document.getElementById("detail-no-button"),
  profileView: document.getElementById("profile-view"),
  profileMissing: document.getElementById("profile-missing"),
  profileContent: document.getElementById("profile-content"),
  backToPredictionsButton: document.getElementById("back-to-predictions"),
  profilePicture: document.getElementById("profile-picture"),
  profileName: document.getElementById("profile-name"),
  profileEmail: document.getElementById("profile-email"),
  profileCreatedAt: document.getElementById("profile-created-at"),
  profileBalance: document.getElementById("profile-balance"),
  profileTotalWins: document.getElementById("profile-total-wins"),
  profileTotalLosses: document.getElementById("profile-total-losses"),
  profileNetProfit: document.getElementById("profile-net-profit"),
  profilePredictionsEmpty: document.getElementById("profile-predictions-empty"),
  profilePredictionsList: document.getElementById("profile-predictions-list"),
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

function formatChartDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatChartTick(dateValue, startValue, endValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const sameDay = new Date(startValue).toDateString() === new Date(endValue).toDateString();
  return date.toLocaleString([], sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" });
}

function formatRelativeTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const diffMs = Date.now() - date.getTime();
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  const units = [
    { limit: 60, divisor: 1, label: "minute" },
    { limit: 1440, divisor: 60, label: "hour" },
    { limit: 43200, divisor: 1440, label: "day" },
    { limit: 525600, divisor: 43200, label: "month" },
  ];

  for (const unit of units) {
    if (absMinutes < unit.limit) {
      const value = Math.max(1, Math.round(absMinutes / unit.divisor));
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }

  const years = Math.max(1, Math.round(absMinutes / 525600));
  return `${years} year${years === 1 ? "" : "s"} ago`;
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

function getPredictionMetrics(prediction) {
  const normalizedPrediction = normalizePrediction(prediction);
  const yesAmount = Number(normalizedPrediction.total_yes || 0);
  const noAmount = Number(normalizedPrediction.total_no || 0);
  const totalVolume = yesAmount + noAmount;

  if (totalVolume <= 0) {
    return {
      totalVolume,
      yesAmount,
      noAmount,
      yesPercent: 50,
      noPercent: 50,
    };
  }

  const yesPercent = Math.round((yesAmount / totalVolume) * 100);
  return {
    totalVolume,
    yesAmount,
    noAmount,
    yesPercent,
    noPercent: 100 - yesPercent,
  };
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function getPredictionOutcomeLabels(prediction) {
  const isHighLow = normalizePrediction(prediction).bet_type === "high_low";
  return {
    positive: isHighLow ? "High" : "Yes",
    negative: isHighLow ? "Low" : "No",
  };
}

function getMarketSearchValue() {
  return String(elements.marketSearch?.value || "").trim().toLowerCase();
}

function getPredictionRouteId() {
  const search = new URLSearchParams(window.location.search);
  return search.get("prediction") || "";
}

function getProfileRouteId() {
  const search = new URLSearchParams(window.location.search);
  return search.get("profile") || "";
}

function setPredictionRoute(predictionId = "") {
  const url = new URL(window.location.href);
  if (predictionId) {
    url.searchParams.set("prediction", predictionId);
    url.searchParams.delete("profile");
  } else {
    url.searchParams.delete("prediction");
  }
  window.history.pushState({}, "", url);
}

function setProfileRoute(userId = "") {
  const url = new URL(window.location.href);
  if (userId) {
    url.searchParams.set("profile", userId);
    url.searchParams.delete("prediction");
  } else {
    url.searchParams.delete("profile");
  }
  window.history.pushState({}, "", url);
}

function getFilteredSortedPredictions() {
  const searchValue = getMarketSearchValue();
  const filterValue = elements.marketFilter?.value || "all";
  const sortValue = elements.marketSort?.value || "volume";

  const predictions = Array.from(state.market.values()).filter((prediction) => {
    const normalizedPrediction = normalizePrediction(prediction);
    const matchesSearch = !searchValue
      || normalizedPrediction.bet_string.toLowerCase().includes(searchValue);

    if (!matchesSearch) {
      return false;
    }

    if (filterValue === "zero_volume") {
      return getPredictionMetrics(normalizedPrediction).totalVolume <= 0;
    }

    if (filterValue === "yes_no" || filterValue === "high_low") {
      return normalizedPrediction.bet_type === filterValue;
    }

    return true;
  });

  predictions.sort((left, right) => {
    const leftPrediction = normalizePrediction(left);
    const rightPrediction = normalizePrediction(right);
    const leftMetrics = getPredictionMetrics(leftPrediction);
    const rightMetrics = getPredictionMetrics(rightPrediction);

    if (sortValue === "closing") {
      return new Date(leftPrediction.end_time).getTime() - new Date(rightPrediction.end_time).getTime();
    }

    if (sortValue === "newest") {
      return new Date(rightPrediction.created_at || 0).getTime() - new Date(leftPrediction.created_at || 0).getTime();
    }

    if (sortValue === "alphabetical") {
      return leftPrediction.bet_string.localeCompare(rightPrediction.bet_string);
    }

    return rightMetrics.totalVolume - leftMetrics.totalVolume;
  });

  return predictions;
}

function setMarketsEmptyState({ kickerText = "No matches", title, copy, hidden }) {
  elements.marketsEmpty.classList.toggle("hidden", hidden);
  if (hidden) {
    return;
  }

  const kicker = elements.marketsEmpty.querySelector(".panel-kicker");
  const heading = elements.marketsEmpty.querySelector("h3");
  const body = elements.marketsEmpty.querySelector(".auth-copy");
  if (kicker) {
    kicker.textContent = kickerText;
  }
  if (heading) {
    heading.textContent = title;
  }
  if (body) {
    body.textContent = copy;
  }
}

function getUserDisplayName(userId, userProfile = null) {
  if (userId && state.user?.id === userId) {
    return "You";
  }

  const profile = userProfile || state.userProfiles.get(userId);
  if (profile?.name) {
    return profile.name;
  }
  if (profile?.email) {
    return profile.email;
  }
  if (!userId) {
    return "Unknown user";
  }
  return `${userId.slice(0, 8)}...`;
}

async function ensureUserProfile(userId) {
  if (!userId) {
    return null;
  }

  if (state.userProfiles.has(userId)) {
    return state.userProfiles.get(userId);
  }

  if (state.userProfileRequests.has(userId)) {
    return state.userProfileRequests.get(userId);
  }

  const request = api(`/users/${encodeURIComponent(userId)}`)
    .then((profile) => {
      state.userProfiles.set(userId, profile);
      state.userProfileRequests.delete(userId);
      return profile;
    })
    .catch((error) => {
      state.userProfileRequests.delete(userId);
      throw error;
    });

  state.userProfileRequests.set(userId, request);
  return request;
}

function attachCreatorLink(button, userId) {
  if (!button) {
    return;
  }

  button.textContent = getUserDisplayName(userId);
  button.onclick = (event) => {
    event.stopPropagation();
    setProfileRoute(userId);
    state.activeTab = "profiles";
    syncRouteViews();
  };

  ensureUserProfile(userId)
    .then((profile) => {
      button.textContent = getUserDisplayName(userId, profile);
    })
    .catch(() => {
      button.textContent = getUserDisplayName(userId);
    });
}

function getLocalPredictionHistory(predictionId) {
  const events = [];
  const appendIfMatch = (entry) => {
    if (entry?.event_type !== "BET_PLACED" || entry.prediction_id !== predictionId) {
      return;
    }

    events.push({
      timestamp: Number(entry.timestamp || 0),
      amount: Number(entry.amount || 0),
      isYes: Boolean(entry.is_yes),
    });
  };

  for (const block of state.chain.chain) {
    for (const entry of block.data || []) {
      appendIfMatch(entry);
    }
  }

  for (const entry of state.chain.queue.transactions || []) {
    appendIfMatch(entry);
  }

  events.sort((left, right) => left.timestamp - right.timestamp);

  let yesAmount = 0;
  let noAmount = 0;
  return events.map((event) => {
    yesAmount += event.isYes ? event.amount : 0;
    noAmount += event.isYes ? 0 : event.amount;
    const total = yesAmount + noAmount;
    return {
      timestamp: event.timestamp,
      yesAmount,
      noAmount,
      totalVolume: total,
      price: total > 0 ? (yesAmount / total) * 100 : 50,
    };
  });
}

function hideChartHover() {
  elements.detailChartHoverLine.classList.add("hidden");
  elements.detailChartHoverDot.classList.add("hidden");
  elements.detailChartTooltip.classList.add("hidden");
}

function drawChartAxes({ width, height, left, right, top, bottom, startTime, endTime }) {
  const yTicks = [0, 25, 50, 75, 100];
  elements.detailChartGrid.innerHTML = "";
  elements.detailChartYAxis.innerHTML = "";
  elements.detailChartXAxis.innerHTML = "";

  for (const value of yTicks) {
    const y = top + ((100 - value) / 100) * (bottom - top);
    const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    gridLine.setAttribute("x1", String(left));
    gridLine.setAttribute("x2", String(right));
    gridLine.setAttribute("y1", String(y));
    gridLine.setAttribute("y2", String(y));
    gridLine.setAttribute("class", "chart-grid-line");
    elements.detailChartGrid.appendChild(gridLine);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(left - 8));
    text.setAttribute("y", String(y + 3));
    text.setAttribute("text-anchor", "end");
    text.setAttribute("class", "chart-axis-text");
    text.textContent = `${value}%`;
    elements.detailChartYAxis.appendChild(text);
  }

  const xTickValues = startTime === endTime
    ? [startTime]
    : [startTime, startTime + ((endTime - startTime) / 2), endTime];

  for (const tickValue of xTickValues) {
    const progress = startTime === endTime ? 0.5 : (tickValue - startTime) / (endTime - startTime);
    const x = left + progress * (right - left);

    const tickLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tickLine.setAttribute("x1", String(x));
    tickLine.setAttribute("x2", String(x));
    tickLine.setAttribute("y1", String(bottom));
    tickLine.setAttribute("y2", String(bottom + 6));
    tickLine.setAttribute("class", "chart-axis-line");
    elements.detailChartXAxis.appendChild(tickLine);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(height - 8));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "chart-axis-text");
    text.textContent = formatChartTick(tickValue, startTime, endTime);
    elements.detailChartXAxis.appendChild(text);
  }
}

function updateChartHover(clientX) {
  const history = state.activeChartHistory;
  if (!history.length) {
    hideChartHover();
    return;
  }

  const rect = elements.detailChartOverlay.getBoundingClientRect();
  const relativeX = clientX - rect.left;
  const ratio = rect.width > 0 ? relativeX / rect.width : 0;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.max(0, Math.min(history.length - 1, Math.round(clampedRatio * (history.length - 1))));
  const point = history[index];
  if (!point) {
    hideChartHover();
    return;
  }

  elements.detailChartHoverLine.classList.remove("hidden");
  elements.detailChartHoverDot.classList.remove("hidden");
  elements.detailChartTooltip.classList.remove("hidden");

  elements.detailChartHoverLine.setAttribute("x1", String(point.chartX));
  elements.detailChartHoverLine.setAttribute("x2", String(point.chartX));
  elements.detailChartHoverLine.setAttribute("y1", String(point.chartTop));
  elements.detailChartHoverLine.setAttribute("y2", String(point.chartBottom));
  elements.detailChartHoverDot.setAttribute("cx", String(point.chartX));
  elements.detailChartHoverDot.setAttribute("cy", String(point.chartY));

  elements.detailChartTooltipTime.textContent = formatChartDate(point.timestamp);
  elements.detailChartTooltipPrice.textContent = `Implied price: ${formatPercent(point.price)}`;
  elements.detailChartTooltipVolume.textContent = `Volume: ${formatMoney(point.totalVolume)}`;

  const tooltipOffset = 14;
  const maxLeft = rect.width - 180;
  const left = Math.max(8, Math.min(maxLeft, relativeX + tooltipOffset));
  elements.detailChartTooltip.style.left = `${left}px`;
}

function renderPredictionHistory(prediction) {
  const normalizedPrediction = normalizePrediction(prediction);
  const labels = getPredictionOutcomeLabels(normalizedPrediction);
  const history = getLocalPredictionHistory(normalizedPrediction.id);
  state.activeChartHistory = [];

  if (!history.length) {
    const metrics = getPredictionMetrics(normalizedPrediction);
    const emptyText = elements.detailChartEmpty.querySelector("p");
    elements.detailChartFrame.classList.add("hidden");
    elements.detailChartEmpty.classList.remove("hidden");
    elements.detailChartCaption.textContent = `Waiting for local blockchain ${labels.positive.toLowerCase()} / ${labels.negative.toLowerCase()} trades`;
    if (emptyText) {
      emptyText.textContent = metrics.totalVolume > 0
        ? "Current market volume exists, but this local blockchain session has not observed past trade points for this prediction id yet."
        : "No local price points yet for this prediction id.";
    }
    hideChartHover();
    elements.detailChartArea.setAttribute("d", "");
    elements.detailChartLine.setAttribute("d", "");
    return;
  }

  const width = 320;
  const height = 220;
  const padding = {
    top: 16,
    right: 10,
    bottom: 28,
    left: 38,
  };
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = height - padding.bottom;
  const startTime = history[0].timestamp;
  const endTime = history[history.length - 1].timestamp;
  drawChartAxes({
    width,
    height,
    left: chartLeft,
    right: chartRight,
    top: chartTop,
    bottom: chartBottom,
    startTime,
    endTime,
  });

  const points = history.map((entry, index) => {
    const xProgress = history.length === 1
      ? 0.5
      : endTime === startTime
        ? index / Math.max(1, history.length - 1)
        : (entry.timestamp - startTime) / (endTime - startTime);
    const x = chartLeft + xProgress * (chartRight - chartLeft);
    const y = chartTop + ((100 - entry.price) / 100) * (chartBottom - chartTop);
    return {
      ...entry,
      chartX: x,
      chartY: y,
      chartTop,
      chartBottom,
    };
  });
  state.activeChartHistory = points;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.chartX.toFixed(2)} ${point.chartY.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].chartX.toFixed(2)} ${chartBottom.toFixed(2)} L ${points[0].chartX.toFixed(2)} ${chartBottom.toFixed(2)} Z`;
  const latestPoint = history[history.length - 1];

  elements.detailChartArea.setAttribute("d", areaPath);
  elements.detailChartLine.setAttribute("d", linePath);
  elements.detailChartFrame.classList.remove("hidden");
  elements.detailChartEmpty.classList.add("hidden");
  elements.detailChartCaption.textContent = `${history.length} local trade${history.length === 1 ? "" : "s"} observed, latest implied ${labels.positive.toLowerCase()} price ${formatPercent(latestPoint.price)}`;
  updateChartHover(elements.detailChartOverlay.getBoundingClientRect().left + (elements.detailChartOverlay.getBoundingClientRect().width / 2));
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

function setActiveTab(tabName) {
  state.activeTab = tabName;

  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of elements.tabPanels) {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
  }

  syncRouteViews();
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
}

function attachEvents() {
  setupPredictionTypeToggles();
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  }
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
  elements.marketSearch.addEventListener("input", () => {
    renderMarketsView();
  });
  elements.marketFilter.addEventListener("change", () => {
    renderMarketsView();
  });
  elements.marketSort.addEventListener("change", () => {
    renderMarketsView();
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
  elements.createMarketForm.addEventListener("submit", handleCreateMarket);
  elements.detailBetForm.addEventListener("submit", handlePlaceBet);
  elements.backToMarketsButton.addEventListener("click", () => {
    setPredictionRoute("");
    state.activeTab = "predictions";
    syncRouteViews();
    renderMarketsView();
  });
  elements.backToPredictionsButton.addEventListener("click", () => {
    setProfileRoute("");
    state.activeTab = "predictions";
    syncRouteViews();
    renderMarketsView();
  });
  window.addEventListener("popstate", () => {
    syncRouteViews();
    renderMarketsView();
  });
}

async function initializeApp() {
  attachEvents();
  setActiveTab(state.activeTab);
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
