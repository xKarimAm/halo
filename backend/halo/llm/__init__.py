"""The one shared model client used by Insight, Classifier and Notes Builder."""

from halo.llm.llm import FAILOVER_ENGINE, PRIMARY_ENGINE, LLMClient, LLMResult

__all__ = ["FAILOVER_ENGINE", "PRIMARY_ENGINE", "LLMClient", "LLMResult"]
