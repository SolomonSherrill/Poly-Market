import { api } from "./api.js";
import {
  authConfig,
  elements,
  formatMoney,
  setAuthButtonsDisabled,
  setAuthStatus,
  setToken,
  setView,
  state,
} from "./shared.js";

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

export function createSessionController({
  broadcastBlockchainEvent,
  cleanupRealtime,
  connectSignaling,
  loadIceServers,
  loadMarkets,
  setActiveTab,
}) {
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

    if (user.was_just_created && broadcastBlockchainEvent) {
      await broadcastBlockchainEvent("USER_CREATED", {
        user_id: user.id,
        name: user.name || "Auth0 User",
        email: user.email || null,
        starting_balance: user.balance,
        timestamp: Date.now(),
      });
    }

    return user;
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

  async function bootAuthenticatedApp() {
    setView("dashboard");
    setActiveTab(state.activeTab);
    await Promise.all([loadUser(), loadMarkets()]);
    await loadIceServers();
    connectSignaling();
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
      search.delete("code");
      search.delete("state");
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${search.toString() ? `?${search.toString()}` : ""}`,
      );
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

  return {
    initializeAuth,
    loadUser,
    login,
    logout,
    signup,
  };
}
