const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const SEARCH_INTERVAL_MS = 1100;

const places = {
  start: { input: document.querySelector("#start-input"), selected: null },
  destination: {
    input: document.querySelector("#destination-input"),
    selected: null,
  },
};

const measureButton = document.querySelector(".measure-button");
const routeResult = document.querySelector(".route-result");
const distanceValue = document.querySelector(".distance-value");
const durationValue = document.querySelector(".duration-value");
const mapLink = document.querySelector(".map-link");
let lastSearchStartedAt = 0;
let routeRequestId = 0;

function getCard(placeName) {
  return document.querySelector(`[data-place="${placeName}"]`);
}

function setMessage(placeName, message, tone) {
  const element = getCard(placeName).querySelector(".field-message");
  element.textContent = message;
  if (tone) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}

function clearSearchResults(placeName) {
  getCard(placeName).querySelector(".search-results").replaceChildren();
}

function invalidateRoute() {
  routeRequestId += 1;
  routeResult.hidden = true;
  measureButton.disabled = !(places.start.selected && places.destination.selected);
  measureButton.querySelector("span").textContent = "거리 확인하기";
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters).toLocaleString("ko-KR")} m`;
  }
  return `${(meters / 1000).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })} km`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `예상 이동 시간 약 ${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `예상 이동 시간 약 ${hours}시간 ${remainingMinutes}분`
    : `예상 이동 시간 약 ${hours}시간`;
}

function renderPlaceResults(placeName, results) {
  const container = getCard(placeName).querySelector(".search-results");
  container.replaceChildren();

  for (const result of results) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "place-option";

    const name = document.createElement("strong");
    name.textContent = result.name || result.display_name.split(",")[0];

    const address = document.createElement("span");
    address.textContent = result.display_name;

    option.append(name, address);
    option.addEventListener("click", () => {
      places[placeName].selected = {
        lat: Number(result.lat),
        lon: Number(result.lon),
        name: result.display_name,
      };
      places[placeName].input.value =
        result.name || result.display_name.split(",")[0];
      getCard(placeName).querySelector(".selected-place").textContent =
        `선택됨 · ${result.display_name}`;
      setMessage(placeName, "", "");
      clearSearchResults(placeName);
      invalidateRoute();
    });
    container.append(option);
  }
}

async function searchPlace(placeName) {
  const card = getCard(placeName);
  const input = places[placeName].input;
  const query = input.value.trim();
  const button = card.querySelector(".search-button");

  if (query.length < 2) {
    setMessage(placeName, "두 글자 이상 입력해 주세요.", "");
    input.focus();
    return;
  }

  clearSearchResults(placeName);
  setMessage(placeName, "장소를 찾고 있어요…", "muted");
  button.disabled = true;

  try {
    const waitMs = Math.max(
      0,
      SEARCH_INTERVAL_MS - (Date.now() - lastSearchStartedAt),
    );
    if (waitMs) {
      await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    }

    lastSearchStartedAt = Date.now();
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
    });
    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`장소 검색 요청에 실패했어요. (${response.status})`);
    }

    const results = await response.json();
    if (input.value.trim() !== query) {
      return;
    }
    if (!results.length) {
      setMessage(placeName, "검색 결과가 없어요. 다른 이름으로 검색해 주세요.", "");
      return;
    }

    setMessage(placeName, "검색 결과에서 정확한 장소를 선택해 주세요.", "muted");
    renderPlaceResults(placeName, results);
  } catch (error) {
    setMessage(
      placeName,
      error instanceof Error
        ? error.message
        : "장소 검색 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
      "",
    );
  } finally {
    button.disabled = false;
  }
}

for (const placeName of Object.keys(places)) {
  const card = getCard(placeName);
  const input = places[placeName].input;

  card
    .querySelector(".search-button")
    .addEventListener("click", () => searchPlace(placeName));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlace(placeName);
    }
  });
  input.addEventListener("input", () => {
    places[placeName].selected = null;
    getCard(placeName).querySelector(".selected-place").textContent = "";
    setMessage(placeName, "", "");
    clearSearchResults(placeName);
    invalidateRoute();
  });
}

measureButton.addEventListener("click", async () => {
  if (!places.start.selected || !places.destination.selected) {
    return;
  }

  const requestId = ++routeRequestId;
  measureButton.disabled = true;
  measureButton.querySelector("span").textContent = "경로를 계산하고 있어요…";
  routeResult.hidden = true;

  const start = places.start.selected;
  const destination = places.destination.selected;
  const coordinates = `${start.lon},${start.lat};${destination.lon},${destination.lat}`;

  try {
    const response = await fetch(
      `${OSRM_URL}/${coordinates}?overview=false&steps=false`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(`경로 요청에 실패했어요. (${response.status})`);
    }

    const data = await response.json();
    if (requestId !== routeRequestId) {
      return;
    }
    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error("두 장소 사이의 자동차 경로를 찾지 못했어요.");
    }

    const route = data.routes[0];
    distanceValue.textContent = formatDistance(route.distance);
    durationValue.textContent = formatDuration(route.duration);
    const mapRoute = `${start.lat},${start.lon};${destination.lat},${destination.lon}`;
    mapLink.href = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(mapRoute)}`;
    routeResult.hidden = false;
  } catch (error) {
    if (requestId === routeRequestId) {
      durationValue.textContent = "";
      distanceValue.textContent =
        error instanceof Error
          ? error.message
          : "경로 계산 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.";
      routeResult.hidden = false;
    }
  } finally {
    if (requestId === routeRequestId) {
      measureButton.disabled = false;
      measureButton.querySelector("span").textContent = "다시 계산하기";
    }
  }
});
