import { api } from "./api.js";
import { renderPredictionHistory } from "./charts.js";
import {
  buildPredictionId,
  elements,
  formatDate,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  getMarketSearchValue,
  getPredictionMetrics,
  getPredictionOutcomeLabels,
  getPredictionRouteId,
  getProfileRouteId,
  getUserDisplayName,
  normalizePrediction,
  setPredictionRoute,
  setProfileRoute,
  state,
} from "./shared.js";

function getFilteredSortedPredictions() {
  const searchValue = getMarketSearchValue();
  const filterValue = elements.marketFilter?.value || "all";
  const sortValue = elements.marketSort?.value || "volume";

  const predictions = Array.from(state.market.values()).filter((prediction) => {
    const normalizedPrediction = normalizePrediction(prediction);
    const matchesSearch = !searchValue || normalizedPrediction.bet_string.toLowerCase().includes(searchValue);
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

function attachCreatorLink(button, userId, syncRouteViews) {
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

function renderProfilePredictionList(predictions, syncRouteViews, renderMarketsView) {
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

export function createMarketsController({ setMessage, refreshUser, broadcastBlockchainEvent, setActiveTab }) {
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
    const labels = getPredictionOutcomeLabels(normalizedPrediction);
    const isHighLow = normalizedPrediction.bet_type === "high_low";

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
    attachCreatorLink(elements.detailCreatorLink, normalizedPrediction.creator_id, syncRouteViews);
    renderPredictionHistory(normalizedPrediction).catch(() => {
      elements.detailChartFrame.classList.add("hidden");
      elements.detailChartEmpty.classList.remove("hidden");
      elements.detailChartCaption.textContent = "Database chart history unavailable";
      const emptyText = elements.detailChartEmpty.querySelector("p");
      if (emptyText) {
        emptyText.textContent = "The market history query failed, so past price points could not be loaded from the database.";
      }
    });
  }

  function updateMarketCard(prediction, existingCard = null) {
    const normalizedPrediction = normalizePrediction(prediction);
    const predictionId = normalizedPrediction.id;
    const card = existingCard || state.marketCards.get(predictionId);
    if (!card) {
      return;
    }

    const metrics = getPredictionMetrics(normalizedPrediction);
    const labels = getPredictionOutcomeLabels(normalizedPrediction);
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

    marketTag.textContent = normalizedPrediction.bet_type === "high_low" ? "High / Low" : "Yes / No";
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
    attachCreatorLink(creatorLink, normalizedPrediction.creator_id, syncRouteViews);
    updateMarketCard(normalizedPrediction, card);

    const openPrediction = () => {
      setPredictionRoute(predictionId);
      state.activeTab = "predictions";
      syncRouteViews();
    };

    cardButton.addEventListener("click", openPrediction);
    cardButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      openPrediction();
    });

    elements.marketsList.appendChild(card);
    state.marketCards.set(predictionId, card);
    return card;
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
      renderProfilePredictionList(Array.isArray(predictions) ? predictions : [], syncRouteViews, renderMarketsView);

      elements.profileContent.classList.remove("hidden");
    } catch {
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
      state.predictionHistoryCache.delete(predictionId);
      state.predictionHistoryRequests.delete(predictionId);
      elements.detailBetForm.reset();
      setMessage(`Order placed on "${prediction.bet_string}".`);
      await refreshUser();
    } catch (error) {
      setMessage(error.message, "error");
      await loadMarkets();
    }
  }

  async function handleCreateMarket(event) {
    event.preventDefault();
    const formData = new FormData(elements.createMarketForm);

    try {
      const isYesNo = formData.get("is_yes_no") === "on";
      const isHighLow = formData.get("is_high_low") === "on";
      const betString = String(formData.get("bet_string") || "").trim();
      const endTimeValue = String(formData.get("end_time") || "");
      if (!betString) {
        throw new Error("Question is required.");
      }
      if (!endTimeValue) {
        throw new Error("End time is required.");
      }

      const endTime = new Date(endTimeValue);
      if (Number.isNaN(endTime.getTime())) {
        throw new Error("Enter a valid end time.");
      }

      const predictionId = await buildPredictionId(state.user.id, betString);
      const prediction = normalizePrediction(await api("/predictions/post-prediction", {
        method: "POST",
        body: JSON.stringify({
          prediction_id: predictionId,
          bet_string: betString,
          is_high_low: isHighLow,
          is_yes_no: isYesNo,
          end_time: endTime.toISOString(),
        }),
      }));

      await broadcastBlockchainEvent("PREDICTION_CREATED", {
        ...prediction,
        prediction_id: prediction.id,
        timestamp: Date.now(),
      });
      elements.createMarketForm.reset();
      const yesNoToggle = elements.createMarketForm?.querySelector('input[name="is_yes_no"]');
      const highLowToggle = elements.createMarketForm?.querySelector('input[name="is_high_low"]');
      if (yesNoToggle) {
        yesNoToggle.checked = true;
      }
      if (highLowToggle) {
        highLowToggle.checked = false;
      }
      setMessage("Prediction posted.");
      setActiveTab("predictions");
    } catch (error) {
      setMessage(error.message, "error");
      await loadMarkets();
    }
  }

  function applyRemoteBet(data) {
    const existing = state.market.get(data.prediction_id);
    if (!existing) {
      return;
    }

    state.predictionHistoryCache.delete(data.prediction_id);
    state.predictionHistoryRequests.delete(data.prediction_id);
    state.market.set(data.prediction_id, {
      ...existing,
      total_yes: Number(existing.total_yes || 0) + (data.is_yes ? Number(data.amount || 0) : 0),
      total_no: Number(existing.total_no || 0) + (!data.is_yes ? Number(data.amount || 0) : 0),
    });

    const prediction = state.market.get(data.prediction_id);
    updateMarketCard(prediction);
    renderMarketsView(data.prediction_id);
  }

  function applyRemotePrediction(prediction) {
    const normalizedPrediction = normalizePrediction(prediction);
    state.market.set(normalizedPrediction.id, normalizedPrediction);
    elements.marketCount.textContent = String(state.market.size);
    renderMarketsView(getPredictionRouteId() || state.selectedPredictionId || normalizedPrediction.id);
  }

  return {
    applyRemoteBet,
    applyRemotePrediction,
    handleCreateMarket,
    handlePlaceBet,
    loadMarkets,
    renderMarketsView,
    setupPredictionTypeToggles,
    syncRouteViews,
  };
}
