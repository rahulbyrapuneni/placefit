import asyncio
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


# ---ENVIRONMENT---
load_dotenv()

CENSUS_API_KEY = os.getenv("CENSUS_API_KEY")


# ---APP---
app = FastAPI(
    title="PlaceFit API",
    version="1.0.0"
)


# ---CORS---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# ---ROOT---
@app.get("/")
def root():
    return {
        "app": "PlaceFit",
        "status": "running"
    }


# ---HEALTH---
@app.get("/api/health")
def health():
    return {
        "status": "ok"
    }


# ---CENSUS REQUEST HELPER---
async def fetch_census_data(
    client: httpx.AsyncClient,
    url: str,
    params: dict
):
    for attempt in range(3):

        try:
            response = await client.get(
                url,
                params=params
            )

            response.raise_for_status()

            if not response.text.strip():
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue

                raise HTTPException(
                    status_code=502,
                    detail="Census API returned an empty response."
                )

            try:
                return response.json()

            except ValueError:
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue

                raise HTTPException(
                    status_code=502,
                    detail="Census API returned invalid JSON."
                )

        except httpx.RequestError as error:

            if attempt < 2:
                await asyncio.sleep(1)
                continue

            raise HTTPException(
                status_code=502,
                detail=(
                    "Unable to connect to Census API: "
                    f"{str(error)}"
                )
            )

        except httpx.HTTPStatusError as error:

            raise HTTPException(
                status_code=502,
                detail=(
                    "Census API error: "
                    f"{error.response.status_code} "
                    f"{error.response.text}"
                )
            )

    raise HTTPException(
        status_code=502,
        detail="Unable to retrieve Census data."
    )

# ---CENSUS VALUE CLEANER---
def clean_census_value(value):
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    special_values = {
        -999999999,
        -888888888,
        -777777777,
        -666666666,
        -555555555,
        -333333333,
        -222222222
    }

    if numeric_value in special_values:
        return None

    return numeric_value


# ---API KEY CHECK---
def validate_api_key():
    if not CENSUS_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Census API key is not configured."
        )


# ---STATES---
@app.get("/api/states")
async def get_states():

    validate_api_key()

    url = (
        "https://api.census.gov/"
        "data/2024/acs/acs5"
    )

    params = {
        "get": "NAME",
        "for": "state:*",
        "key": CENSUS_API_KEY
    }

    async with httpx.AsyncClient(
        timeout=20.0
    ) as client:

        data = await fetch_census_data(
            client,
            url,
            params
        )

    states = [
        {
            "name": row[0],
            "state_code": row[1]
        }
        for row in data[1:]
    ]

    states.sort(
        key=lambda item: item["name"]
    )

    return {
        "states": states
    }


# ---PLACES---
@app.get("/api/places")
async def get_places(
    state_code: str
):

    validate_api_key()

    url = (
        "https://api.census.gov/"
        "data/2024/acs/acs5"
    )

    params = {
        "get": "NAME",
        "for": "place:*",
        "in": f"state:{state_code}",
        "key": CENSUS_API_KEY
    }

    async with httpx.AsyncClient(
        timeout=20.0
    ) as client:

        data = await fetch_census_data(
            client,
            url,
            params
        )

    places = [
        {
            "name": row[0],
            "state_code": row[1],
            "place_code": row[2]
        }
        for row in data[1:]
    ]

    places.sort(
        key=lambda item: item["name"]
    )

    return {
        "places": places
    }


# ---COUNTIES---
@app.get("/api/counties")
async def get_counties(
    state_code: str
):

    validate_api_key()

    url = (
        "https://api.census.gov/"
        "data/2024/acs/acs5"
    )

    params = {
        "get": "NAME",
        "for": "county:*",
        "in": f"state:{state_code}",
        "key": CENSUS_API_KEY
    }

    async with httpx.AsyncClient(
        timeout=20.0
    ) as client:

        data = await fetch_census_data(
            client,
            url,
            params
        )

    counties = [
        {
            "name": row[0],
            "state_code": row[1],
            "county_code": row[2]
        }
        for row in data[1:]
    ]

    counties.sort(
        key=lambda item: item["name"]
    )

    return {
        "counties": counties
    }


# ---PROFILE HELPER---
async def build_profile(
    geography_type: str,
    state_code: str,
    geography_code: str
):

    validate_api_key()

    if geography_type not in {
        "place",
        "county"
    }:
        raise HTTPException(
            status_code=400,
            detail="Unsupported geography type."
        )

    main_url = (
        "https://api.census.gov/"
        "data/2024/acs/acs5"
    )

    main_params = {
        "get": (
            "NAME,"
            "B01003_001E,"
            "B19013_001E,"
            "B17001_001E,"
            "B17001_002E,"
            "B23025_003E,"
            "B23025_005E"
        ),
        "for": (
            f"{geography_type}:"
            f"{geography_code}"
        ),
        "in": f"state:{state_code}",
        "key": CENSUS_API_KEY
    }

    insurance_url = (
        "https://api.census.gov/"
        "data/2024/acs/acs5/subject"
    )

    insurance_params = {
        "get": (
            "NAME,"
            "S2701_C03_001E"
        ),
        "for": (
            f"{geography_type}:"
            f"{geography_code}"
        ),
        "in": f"state:{state_code}",
        "key": CENSUS_API_KEY
    }

    async with httpx.AsyncClient(
        timeout=20.0
    ) as client:

        main_data = await fetch_census_data(
            client,
            main_url,
            main_params
        )

        insurance_data = await fetch_census_data(
            client,
            insurance_url,
            insurance_params
        )

    if len(main_data) < 2:
        raise HTTPException(
            status_code=404,
            detail="Location data not found."
        )

    if len(insurance_data) < 2:
        raise HTTPException(
            status_code=404,
            detail="Insurance data not found."
        )

    main_headers = main_data[0]
    main_values = main_data[1]

    record = dict(
        zip(
            main_headers,
            main_values
        )
    )

    insurance_headers = (
        insurance_data[0]
    )

    insurance_values = (
        insurance_data[1]
    )

    insurance_record = dict(
        zip(
            insurance_headers,
            insurance_values
        )
    )

    # ---POPULATION---
    population_value = clean_census_value(
        record["B01003_001E"]
    )

    population = (
        int(population_value)
        if population_value is not None
        else None
    )

    # ---INCOME---
    income_value = clean_census_value(
        record["B19013_001E"]
    )

    median_household_income = (
        int(income_value)
        if income_value is not None
        else None
    )

    # ---POVERTY---
    poverty_total = clean_census_value(
        record["B17001_001E"]
    )

    poverty_below = clean_census_value(
        record["B17001_002E"]
    )

    poverty_rate = (
        round(
            (poverty_below / poverty_total) * 100,
            1
        )
        if (
            poverty_total is not None
            and poverty_below is not None
            and poverty_total > 0
        )
        else None
    )

    # ---UNEMPLOYMENT---
    civilian_labor_force = clean_census_value(
        record["B23025_003E"]
    )

    unemployed = clean_census_value(
        record["B23025_005E"]
    )

    unemployment_rate = (
        round(
            (unemployed / civilian_labor_force) * 100,
            1
        )
        if (
            civilian_labor_force is not None
            and unemployed is not None
            and civilian_labor_force > 0
        )
        else None
    )

    # ---INSURANCE---
    insurance_value = clean_census_value(
        insurance_record.get(
            "S2701_C03_001E"
        )
    )

    insurance_coverage = (
        round(
            insurance_value,
            1
        )
        if insurance_value is not None
        else None
    )

    return {
        "name": record["NAME"],
        "geography_type":
            geography_type,
        "state_code":
            state_code,
        "geography_code":
            geography_code,
        "population":
            population,
        "median_household_income":
            median_household_income,
        "poverty_rate":
            poverty_rate,
        "unemployment_rate":
            unemployment_rate,
        "insurance_coverage":
            insurance_coverage,
        "source": (
            "U.S. Census Bureau "
            "ACS 2024 5-Year"
        )
    }


# ---PLACE PROFILE---
@app.get("/api/place-profile")
async def place_profile(
    state_code: str,
    place_code: str
):

    return await build_profile(
        geography_type="place",
        state_code=state_code,
        geography_code=place_code
    )


# ---COUNTY PROFILE---
@app.get("/api/county-profile")
async def county_profile(
    state_code: str,
    county_code: str
):

    return await build_profile(
        geography_type="county",
        state_code=state_code,
        geography_code=county_code
    )