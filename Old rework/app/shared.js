import { Blockchain } from "../blockchain.js";

export const authConfig = {
  domain: document.body.dataset.auth0Domain,
  clientId: document.body.dataset.auth0ClientId,
  audience: document.body.dataset.auth0Audience,
  redirectUri: window.location.origin,
};

export const state = {
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
  predictionHistoryCache: new Map(),
  predictionHistoryRequests: new Map(),
  activeTab: "predictions",
  selectedPredictionId: null,
  activeChartHistory: [],
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const elements = {
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

export function setAuthStatus(text) {
  if (elements.authStatus) {
    elements.authStatus.textContent = text;
  }
}

export function setAuthButtonsDisabled(disabled) {
  elements.loginButton.disabled = disabled;
  elements.signupButton.disabled = disabled;
}

export function setMessage(text, tone = "success") {
  if (!text) {
    elements.messageBanner.className = "message-banner hidden";
    elements.messageBanner.textContent = "";
    return;
  }

  elements.messageBanner.textContent = text;
  elements.messageBanner.className = `message-banner ${tone}`;
}

export function setToken(token) {
  state.token = token || "";
  if (state.token) {
    localStorage.setItem("poly_token", state.token);
  } else {
    localStorage.removeItem("poly_token");
  }
}

export function setView(view) {
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

export function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount || 0));
}

export function formatDate(dateValue) {
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

export function formatChartDate(dateValue) {
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

export function formatChartTick(dateValue, startValue, endValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const sameDay = new Date(startValue).toDateString() === new Date(endValue).toDateString();
  return date.toLocaleString([], sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" });
}

export function formatRelativeTime(dateValue) {
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

export function isHighLowPrediction(prediction) {
  return prediction?.bet_type === "high_low" || prediction?.bet_type === "highLow";
}

export function normalizePrediction(prediction) {
  return {
    ...prediction,
    id: prediction.id || prediction._id || prediction.prediction_id,
    _id: prediction._id || prediction.id || prediction.prediction_id,
    bet_type: isHighLowPrediction(prediction) ? "high_low" : "yes_no",
    total_yes: Number(prediction.total_yes || 0),
    total_no: Number(prediction.total_no || 0),
  };
}

export function getPredictionMetrics(prediction) {
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

export function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

export function getPredictionOutcomeLabels(prediction) {
  const isHighLow = normalizePrediction(prediction).bet_type === "high_low";
  return {
    positive: isHighLow ? "High" : "Yes",
    negative: isHighLow ? "Low" : "No",
  };
}

export function getMarketSearchValue() {
  return String(elements.marketSearch?.value || "").trim().toLowerCase();
}

export function getPredictionRouteId() {
  const search = new URLSearchParams(window.location.search);
  return search.get("prediction") || "";
}

export function getProfileRouteId() {
  const search = new URLSearchParams(window.location.search);
  return search.get("profile") || "";
}

export function setPredictionRoute(predictionId = "") {
  const url = new URL(window.location.href);
  if (predictionId) {
    url.searchParams.set("prediction", predictionId);
    url.searchParams.delete("profile");
  } else {
    url.searchParams.delete("prediction");
  }
  window.history.pushState({}, "", url);
}

export function setProfileRoute(userId = "") {
  const url = new URL(window.location.href);
  if (userId) {
    url.searchParams.set("profile", userId);
    url.searchParams.delete("prediction");
  } else {
    url.searchParams.delete("profile");
  }
  window.history.pushState({}, "", url);
}

export function getWebSocketUrl(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/connect`);
  url.searchParams.set("token", token);
  return url.toString();
}

export function createShortNonce(byteLength = 4) {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildPredictionId(userId, betString) {
  const nonce = createShortNonce();
  return sha256Hex(`${userId}|${String(betString || "").trim()}|${nonce}`);
}

export function getUserDisplayName(userId, userProfile = null) {
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
