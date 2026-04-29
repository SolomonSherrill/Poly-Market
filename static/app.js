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
