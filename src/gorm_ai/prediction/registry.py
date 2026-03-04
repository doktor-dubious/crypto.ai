"""Registry for prediction engines."""

from gorm_ai.prediction.engine import EngineCapabilities, PredictionEngine
from gorm_ai.schemas.prediction import PredictionEngine as PredictionEngineEnum


class EngineRegistry:
    """Registry for managing prediction engines."""

    def __init__(self):
        self._engines: dict[PredictionEngineEnum, type[PredictionEngine]] = {}
        self._register_default_engines()

    def _register_default_engines(self) -> None:
        """Register default prediction engines."""
        from gorm_ai.prediction.engines.statistical import StatisticalEngine

        self.register(PredictionEngineEnum.STATISTICAL, StatisticalEngine)

        # Register TimesFM stub (interface only)
        try:
            from gorm_ai.prediction.engines.timesfm import TimesFMEngine

            self.register(PredictionEngineEnum.TIMESFM, TimesFMEngine)
        except ImportError:
            pass  # TimesFM not available

        # Register custom engine
        try:
            from gorm_ai.prediction.engines.custom import CustomEngine

            self.register(PredictionEngineEnum.CUSTOM, CustomEngine)
        except ImportError:
            pass  # Custom engine not available

    def register(
        self,
        engine_type: PredictionEngineEnum,
        engine_class: type[PredictionEngine],
    ) -> None:
        """
        Register a prediction engine.

        Args:
            engine_type: Type of engine to register
            engine_class: Engine class to register
        """
        self._engines[engine_type] = engine_class

    def get_engine(self, engine_type: PredictionEngineEnum) -> PredictionEngine:
        """
        Get an instance of a prediction engine.

        Args:
            engine_type: Type of engine to get

        Returns:
            Instance of the requested engine

        Raises:
            ValueError: If engine type is not registered
        """
        if engine_type not in self._engines:
            raise ValueError(f"Engine type '{engine_type}' is not registered")

        return self._engines[engine_type]()

    def get_available_engines(self) -> list[PredictionEngineEnum]:
        """
        Get list of available engine types.

        Returns:
            List of registered engine types
        """
        return list(self._engines.keys())

    def get_capabilities(self, engine_type: PredictionEngineEnum) -> EngineCapabilities:
        """
        Get capabilities of a specific engine.

        Args:
            engine_type: Type of engine

        Returns:
            EngineCapabilities for the specified engine

        Raises:
            ValueError: If engine type is not registered
        """
        engine = self.get_engine(engine_type)
        return engine.get_capabilities()
