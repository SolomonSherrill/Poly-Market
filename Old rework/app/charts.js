import { api } from "./api.js";
import {
  elements,
  state,
  formatChartDate,
  formatChartTick,
  formatMoney,
  formatPercent,
  getPredictionMetrics,
  getPredictionOutcomeLabels,
  normalizePrediction,
} from "./shared.js";

async function getPredictionHistory(predictionId) {
  if (!predictionId) {
    return [];
  }

  if (state.predictionHistoryCache.has(predictionId)) {
    return state.predictionHistoryCache.get(predictionId);
  }

  if (state.predictionHistoryRequests.has(predictionId)) {
    return state.predictionHistoryRequests.get(predictionId);
  }

  const request = api(`/predictions/${encodeURIComponent(predictionId)}/history`)
    .then((historyEntries) => {
      const history = (Array.isArray(historyEntries) ? historyEntries : [])
        .map((entry) => ({
          timestamp: new Date(entry.created_at).getTime(),
          amount: Number(entry.stake || 0),
          isYes: entry.bet_type === "yes",
        }))
        .filter((entry) => !Number.isNaN(entry.timestamp))
        .sort((left, right) => left.timestamp - right.timestamp);

      let yesAmount = 0;
      let noAmount = 0;
      const series = history.map((entry) => {
        yesAmount += entry.isYes ? entry.amount : 0;
        noAmount += entry.isYes ? 0 : entry.amount;
        const total = yesAmount + noAmount;
        return {
          timestamp: entry.timestamp,
          yesAmount,
          noAmount,
          totalVolume: total,
          price: total > 0 ? (yesAmount / total) * 100 : 50,
        };
      });

      state.predictionHistoryCache.set(predictionId, series);
      state.predictionHistoryRequests.delete(predictionId);
      return series;
    })
    .catch((error) => {
      state.predictionHistoryRequests.delete(predictionId);
      throw error;
    });

  state.predictionHistoryRequests.set(predictionId, request);
  return request;
}

export function hideChartHover() {
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

export function updateChartHover(clientX) {
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
  const maxLeft = Math.max(8, rect.width - 180);
  const left = Math.max(8, Math.min(maxLeft, relativeX + tooltipOffset));
  elements.detailChartTooltip.style.left = `${left}px`;
}

export async function renderPredictionHistory(prediction) {
  const normalizedPrediction = normalizePrediction(prediction);
  const labels = getPredictionOutcomeLabels(normalizedPrediction);
  const history = await getPredictionHistory(normalizedPrediction.id);
  if (state.selectedPredictionId !== normalizedPrediction.id) {
    return;
  }
  state.activeChartHistory = [];

  if (!history.length) {
    const metrics = getPredictionMetrics(normalizedPrediction);
    const emptyText = elements.detailChartEmpty.querySelector("p");
    elements.detailChartFrame.classList.add("hidden");
    elements.detailChartEmpty.classList.remove("hidden");
    elements.detailChartCaption.textContent = `Waiting for database ${labels.positive.toLowerCase()} / ${labels.negative.toLowerCase()} trade history`;
    if (emptyText) {
      emptyText.textContent = metrics.totalVolume > 0
        ? "Current market volume exists, but no historical trade points were returned from the database for this prediction yet."
        : "No database price points yet for this prediction id.";
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
  elements.detailChartCaption.textContent = `${history.length} database trade${history.length === 1 ? "" : "s"} observed, latest implied ${labels.positive.toLowerCase()} price ${formatPercent(latestPoint.price)}`;
  const overlayRect = elements.detailChartOverlay.getBoundingClientRect();
  updateChartHover(overlayRect.left + (overlayRect.width / 2));
}
