"""Tests for statistical prediction engine."""

from datetime import date, timedelta

import pytest

from crypto_ai.prediction.engines.statistical import StatisticalEngine


@pytest.fixture
def engine():
    """Create statistical engine instance."""
    return StatisticalEngine()


@pytest.fixture
def historical_data():
    """Generate sample historical data."""
    base_date = date(2024, 1, 1)
    return [
        {"date": base_date + timedelta(days=i), "value": 100 + i * 2}
        for i in range(30)
    ]


@pytest.mark.asyncio
async def test_get_capabilities(engine: StatisticalEngine):
    """Test engine capabilities."""
    capabilities = engine.get_capabilities()
    assert capabilities.name == "Statistical Engine"
    assert capabilities.min_history_length == 7
    assert capabilities.max_horizon == 365


@pytest.mark.asyncio
async def test_predict_exponential_smoothing(
    engine: StatisticalEngine,
    historical_data: list[dict],
):
    """Test prediction with exponential smoothing."""
    results = await engine.predict(
        historical_data=historical_data,
        horizon=7,
        method="exponential_smoothing",
    )

    assert len(results) == 7
    for result in results:
        assert result.date is not None
        assert result.predicted_value is not None
        assert result.lower_bound is not None
        assert result.upper_bound is not None
        assert result.lower_bound <= result.predicted_value <= result.upper_bound


@pytest.mark.asyncio
async def test_predict_moving_average(
    engine: StatisticalEngine,
    historical_data: list[dict],
):
    """Test prediction with moving average."""
    results = await engine.predict(
        historical_data=historical_data,
        horizon=7,
        method="moving_average",
        window=7,
    )

    assert len(results) == 7
    for result in results:
        assert result.date is not None
        assert result.predicted_value is not None


@pytest.mark.asyncio
async def test_validate_input_insufficient_data(engine: StatisticalEngine):
    """Test validation with insufficient data."""
    short_data = [{"date": date(2024, 1, 1), "value": 100}]

    with pytest.raises(ValueError, match="Insufficient historical data"):
        await engine.predict(historical_data=short_data, horizon=7)


@pytest.mark.asyncio
async def test_validate_input_horizon_too_large(
    engine: StatisticalEngine,
    historical_data: list[dict],
):
    """Test validation with horizon exceeding max."""
    with pytest.raises(ValueError, match="Horizon exceeds maximum"):
        await engine.predict(historical_data=historical_data, horizon=500)
