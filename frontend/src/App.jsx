import { useEffect, useMemo, useState } from "react";
import "./App.css";
import logo from "./assets/placefit-logo.svg";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "http://127.0.0.1:8000";

function App() {
  const [locationType, setLocationType] = useState("city");

  const [states, setStates] = useState([]);
  const [locations, setLocations] = useState([]);

  const [selectedState, setSelectedState] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");

  const [selectedPlaces, setSelectedPlaces] = useState([]);

  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);

  const [error, setError] = useState("");

  const [weights, setWeights] = useState({
    income: 3,
    poverty: 3,
    unemployment: 3,
    insurance: 2,
  });

  useEffect(() => {
    async function loadStates() {
      try {
        setLoadingStates(true);
        setError("");

        const response = await fetch(`${API_BASE}/api/states`);

        if (!response.ok) {
          throw new Error("Unable to load states.");
        }

        const data = await response.json();
        setStates(data.states || []);
      } catch (err) {
        console.error(err);
        setError("Unable to load states.");
      } finally {
        setLoadingStates(false);
      }
    }

    loadStates();
  }, []);

  useEffect(() => {
    setSelectedState("");
    setSelectedLocation("");
    setLocations([]);
    setError("");
  }, [locationType]);

  useEffect(() => {
    async function loadLocations() {
      if (!selectedState) {
        setLocations([]);
        setSelectedLocation("");
        return;
      }

      try {
        setLoadingLocations(true);
        setError("");
        setSelectedLocation("");

        const endpoint =
          locationType === "city" ? "places" : "counties";

        const response = await fetch(
          `${API_BASE}/api/${endpoint}?state_code=${selectedState}`
        );

        if (!response.ok) {
          throw new Error("Unable to load locations.");
        }

        const data = await response.json();

        setLocations(
          locationType === "city"
            ? data.places || []
            : data.counties || []
        );
      } catch (err) {
        console.error(err);
        setError("Unable to load locations.");
      } finally {
        setLoadingLocations(false);
      }
    }

    loadLocations();
  }, [selectedState, locationType]);

  function updateWeight(key, value) {
    setWeights((current) => ({
      ...current,
      [key]: Number(value),
    }));
  }

  async function addPlace() {
    if (!selectedState || !selectedLocation) {
      setError("Choose a state and location first.");
      return;
    }

    if (selectedPlaces.length >= 3) {
      setError("You can compare up to three places.");
      return;
    }

    const id = `${locationType}_${selectedState}_${selectedLocation}`;

    const alreadyAdded = selectedPlaces.some(
      (place) => place.id === id
    );

    if (alreadyAdded) {
      setError("That place is already in your comparison.");
      return;
    }

    try {
      setAddingPlace(true);
      setError("");

      const endpoint =
        locationType === "city"
          ? `${API_BASE}/api/place-profile?state_code=${selectedState}&place_code=${selectedLocation}`
          : `${API_BASE}/api/county-profile?state_code=${selectedState}&county_code=${selectedLocation}`;

      const response = await fetch(endpoint);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        throw new Error(
          errorData?.detail || "Unable to load location."
        );
      }

      const data = await response.json();

      setSelectedPlaces((current) => [
        ...current,
        {
          id,
          ...data,
        },
      ]);

      setSelectedLocation("");
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to add location.");
    } finally {
      setAddingPlace(false);
    }
  }

  function removePlace(id) {
    setSelectedPlaces((current) =>
      current.filter((place) => place.id !== id)
    );
    setError("");
  }

  const rankedPlaces = useMemo(() => {
    if (selectedPlaces.length === 0) {
      return [];
    }

    const benchmarks = {
      income: {
        min: 40000,
        max: 150000,
      },
      poverty: {
        min: 3,
        max: 30,
      },
      unemployment: {
        min: 2,
        max: 12,
      },
      insurance: {
        min: 75,
        max: 100,
      },
    };

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function highBetter(value, min, max) {
      if (value === null || value === undefined) {
        return 0;
      }

      const safe = clamp(value, min, max);

      return ((safe - min) / (max - min)) * 100;
    }

    function lowBetter(value, min, max) {
      if (value === null || value === undefined) {
        return 0;
      }

      const safe = clamp(value, min, max);

      return ((max - safe) / (max - min)) * 100;
    }

    return selectedPlaces
  .map((place) => {
    const requiredValues = [
      place.median_household_income,
      place.poverty_rate,
      place.unemployment_rate,
      place.insurance_coverage,
    ];

    const hasCompleteData = requiredValues.every(
      (value) =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
    );

    if (!hasCompleteData) {
      return {
        ...place,
        score: null,
        scoreAvailable: false,
        breakdown: {
          income: null,
          poverty: null,
          unemployment: null,
          insurance: null,
        },
      };
    }

    const income = highBetter(
      place.median_household_income,
      benchmarks.income.min,
      benchmarks.income.max
    );

    const poverty = lowBetter(
      place.poverty_rate,
      benchmarks.poverty.min,
      benchmarks.poverty.max
    );

    const unemployment = lowBetter(
      place.unemployment_rate,
      benchmarks.unemployment.min,
      benchmarks.unemployment.max
    );

    const insurance = highBetter(
      place.insurance_coverage,
      benchmarks.insurance.min,
      benchmarks.insurance.max
    );

    const totalWeight =
      weights.income +
      weights.poverty +
      weights.unemployment +
      weights.insurance;

    const score =
      (
        income * weights.income +
        poverty * weights.poverty +
        unemployment * weights.unemployment +
        insurance * weights.insurance
      ) / totalWeight;

    return {
      ...place,
      score: Math.round(score),
      scoreAvailable: true,
      breakdown: {
        income: Math.round(income),
        poverty: Math.round(poverty),
        unemployment: Math.round(unemployment),
        insurance: Math.round(insurance),
      },
    };
  })
  .sort((a, b) => {
    if (a.scoreAvailable && !b.scoreAvailable) {
      return -1;
    }

    if (!a.scoreAvailable && b.scoreAvailable) {
      return 1;
    }

    if (!a.scoreAvailable && !b.scoreAvailable) {
      return 0;
    }

    return b.score - a.score;
  });
  }, [selectedPlaces, weights]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <img src={logo} alt="PlaceFit logo" className="brand-logo" />
          <div className="brand-name">
            Place<span>Fit</span>
          </div>
        </div>

        <div className="data-pill">
          <span className="data-dot" />
          Powered by U.S. Census Data
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              LOCATION DECISION ENGINE
            </div>

            <h1>
              Find the place that
              <br />
              fits <span>your life best.</span>
            </h1>

            <p>
              Compare cities and counties using real Census data,
              then rank them based on what matters most to you.
            </p>
          </div>

          <div className="hero-visual">
            <div className="hero-orb hero-orb-one" />
            <div className="hero-orb hero-orb-two" />

            <div className="hero-card">
              <div className="hero-card-icon">PF</div>
              <div>
                <strong>Real data.</strong>
                <span>Real possibilities.</span>
              </div>
            </div>

            <div className="hero-cityscape">
              <div className="building b1" />
              <div className="building b2" />
              <div className="building b3" />
              <div className="building b4" />
              <div className="building b5" />
              <div className="building b6" />
              <div className="building b7" />
              <div className="building b8" />
            </div>
          </div>
        </section>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <section className="panel choose-panel">
          <div className="section-heading-row">
            <div className="step-circle">1</div>

            <div>
              <h2>Choose your locations</h2>
              <p>Compare up to three locations.</p>
            </div>

            <div className="selection-count">
              {selectedPlaces.length}/3 selected
            </div>
          </div>

          <div className="location-toggle">
            <button
              className={locationType === "city" ? "active" : ""}
              onClick={() => setLocationType("city")}
            >
              City
            </button>

            <button
              className={locationType === "county" ? "active" : ""}
              onClick={() => setLocationType("county")}
            >
              County
            </button>
          </div>

          <div className="location-form-grid">
            <div className="field-group">
              <label>State</label>

              <select
                value={selectedState}
                onChange={(event) =>
                  setSelectedState(event.target.value)
                }
                disabled={loadingStates}
              >
                <option value="">
                  {loadingStates
                    ? "Loading states..."
                    : "Choose state"}
                </option>

                {states.map((state) => (
                  <option
                    key={state.state_code}
                    value={state.state_code}
                  >
                    {state.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label>
                {locationType === "city"
                  ? "City / Place"
                  : "County"}
              </label>

              <select
                value={selectedLocation}
                onChange={(event) =>
                  setSelectedLocation(event.target.value)
                }
                disabled={!selectedState || loadingLocations}
              >
                <option value="">
                  {loadingLocations
                    ? "Loading..."
                    : locationType === "city"
                    ? "Choose city"
                    : "Choose county"}
                </option>

                {locations.map((location) => {
                  const code =
                    locationType === "city"
                      ? location.place_code
                      : location.county_code;

                  return (
                    <option
                      key={code}
                      value={code}
                    >
                      {location.name}
                    </option>
                  );
                })}
              </select>
            </div>

            <button
              className="add-place-button"
              onClick={addPlace}
              disabled={
                addingPlace ||
                !selectedState ||
                !selectedLocation ||
                selectedPlaces.length >= 3
              }
            >
              <span>+</span>
              {addingPlace ? "Adding..." : "Add place"}
            </button>
          </div>

          {selectedPlaces.length > 0 && (
            <>
              <div className="selected-label">
                Selected locations
                <span>{selectedPlaces.length}/3</span>
              </div>

              <div className="selected-place-grid">
                {selectedPlaces.map((place) => (
                  <div
                    className="selected-place-card"
                    key={place.id}
                  >
                    <div className="place-avatar">
                      {place.name.charAt(0)}
                    </div>

                    <div className="selected-place-copy">
                      <strong>{cleanPlaceName(place.name)}</strong>
                      <span>
                        Population {formatNumber(place.population)}
                      </span>
                    </div>

                    <button
                      className="remove-place"
                      onClick={() => removePlace(place.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <div className="lower-grid">
          <section className="panel priorities-panel">
            <div className="section-heading-row compact">
              <div className="step-circle">2</div>

              <div>
                <h2>What matters to you?</h2>
                <p>
                  Move the sliders to change how much each factor matters.
                </p>
              </div>
            </div>

            <PriorityRow
              icon="$"
              iconClass="green"
              title="Income strength"
              description="Higher median household income is rewarded."
              value={weights.income}
              onChange={(value) => updateWeight("income", value)}
            />

            <PriorityRow
              icon="P"
              iconClass="purple"
              title="Low poverty"
              description="Lower poverty rates score better."
              value={weights.poverty}
              onChange={(value) => updateWeight("poverty", value)}
            />

            <PriorityRow
              icon="J"
              iconClass="orange"
              title="Job stability"
              description="Lower unemployment rates score better."
              value={weights.unemployment}
              onChange={(value) =>
                updateWeight("unemployment", value)
              }
            />

            <PriorityRow
              icon="H"
              iconClass="pink"
              title="Health coverage"
              description="Higher insurance coverage scores better."
              value={weights.insurance}
              onChange={(value) =>
                updateWeight("insurance", value)
              }
            />
          </section>

          <section className="panel results-panel">
            <div className="section-heading-row compact">
              <div className="step-circle">3</div>

              <div>
                <h2>Your best fit</h2>
                <p>
                  Rankings update instantly when your priorities change.
                </p>
              </div>
            </div>

            {selectedPlaces.length < 2 ? (
              <div className="empty-state">
                <strong>Add at least two places.</strong>
                <span>Your comparison will appear here.</span>
              </div>
            ) : (
              <div className="results-list">
                {rankedPlaces.map((place, index) => (
                  <ResultCard
                    key={place.id}
                    place={place}
                    rank={index + 1}
                    winner={index === 0 &&place.scoreAvailable}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {selectedPlaces.length >= 2 && rankedPlaces[0] && (
          <div className="insight-strip">
            <div className="insight-icon">i</div>
            <strong>Insight</strong>
            <span>
              {cleanPlaceName(rankedPlaces[0].name)} ranks highest
              for your current priorities.
            </span>
          </div>
        )}

        <footer className="footer">
          <span>
            Data from the U.S. Census Bureau, ACS 2024 5-Year Estimates.
            PlaceFit rankings are independently calculated and are not
            official Census ratings.
          </span>

          <strong>PlaceFit</strong>
        </footer>
      </main>
    </div>
  );
}

function PriorityRow({
  icon,
  iconClass,
  title,
  description,
  value,
  onChange,
}) {
  return (
    <div className="priority-row">
      <div className={`priority-icon ${iconClass}`}>
        {icon}
      </div>

      <div className="priority-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>

      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
      />

      <div className="weight-box">
        {value}
      </div>
    </div>
  );
}

function ResultCard({
  place,
  rank,
  winner,
}) {
  return (
    <article
      className={`result-card ${
        winner ? "winner" : ""
      }`}
    >
      <div className="result-top">
        <div className="rank-badge">
          {rank}
        </div>

        <div className="result-place-avatar">
          {cleanPlaceName(place.name).charAt(0)}
        </div>

        <div className="result-heading-copy">
          <div className="result-title-row">
            <h3>
              {cleanPlaceName(place.name)}
            </h3>

            {winner && (
              <span className="best-fit-pill">
                Best fit
              </span>
            )}
          </div>

          <span>
            Population{" "}
            {formatNumber(place.population)}
          </span>
        </div>

        {place.scoreAvailable ? (
          <div className="score-ring">
            <strong>{place.score}</strong>
            <span>Overall score</span>
          </div>
        ) : (
          <div className="score-unavailable">
            <strong>N/A</strong>
            <span>Insufficient data</span>
          </div>
        )}
      </div>

      <div className="metric-grid">
        <Metric
          label="Median income"
          value={formatCurrency(
            place.median_household_income
          )}
          score={place.breakdown.income}
          tone="green"
        />

        <Metric
          label="Poverty rate"
          value={formatPercent(
            place.poverty_rate
          )}
          score={place.breakdown.poverty}
          tone="blue"
        />

        <Metric
          label="Unemployment"
          value={formatPercent(
            place.unemployment_rate
          )}
          score={place.breakdown.unemployment}
          tone="blue"
        />

        <Metric
          label="Insured"
          value={formatPercent(
            place.insurance_coverage
          )}
          score={place.breakdown.insurance}
          tone="green"
        />
      </div>
    </article>
  );
}
function Metric({
  label,
  value,
  score,
  tone,
}) {
  const safeScore =
    score === null ||
    score === undefined
      ? 0
      : score;

  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>

      <div className="metric-track">
        <div
          className={`metric-fill ${tone}`}
          style={{
            width: `${Math.max(
              0,
              Math.min(
                safeScore,
                100
              )
            )}%`,
          }}
        />
      </div>
    </div>
  );
}
function cleanPlaceName(name) {
  if (!name) {
    return "";
  }

  return name
    .replace(" city (balance),", ",")
    .replace(" city,", ",")
    .replace(" town,", ",")
    .replace(" village,", ",")
    .replace(" CDP,", ",");
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return Number(value).toLocaleString();
}

function formatCurrency(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return `${Number(value).toFixed(1)}%`;
}

export default App;