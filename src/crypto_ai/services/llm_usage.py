"""Centralized LLM token-usage accounting.

Replaces the duplicated `_update_token_usage` helpers that lived in
`outlier_investigate.py`, `cohort_investigate.py`, and `chat.py`. Use
`record_anthropic_usage(...)` from any Claude call site to bump the
per-customer `Token` row and the matching per-(customer, llm, model)
`TokenLlm` row, creating either as needed.
"""

from sqlalchemy import select

from crypto_ai.database.connection import get_session
from crypto_ai.database.models.llm import Llm
from crypto_ai.database.models.token import Token, TokenLlm

ANTHROPIC_PROVIDER = "Anthropic"


async def record_llm_usage(
    customer_id: str,
    provider_name: str,
    model_name: str | None,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Add input/output tokens to the customer's Token row and to the
    matching per-(provider, model) TokenLlm row. `used` on TokenLlm
    tracks the total (input + output) for backwards compatibility.
    Silently no-ops if the LLM provider row is missing."""
    if input_tokens <= 0 and output_tokens <= 0:
        return
    total_tokens = max(0, input_tokens) + max(0, output_tokens)
    async for session in get_session():
        try:
            # Find-or-create the customer's Token row.
            result = await session.execute(
                select(Token).where(
                    Token.customer_id == customer_id,
                    Token.active.is_(True),
                )
            )
            token = result.scalar_one_or_none()
            if not token:
                token = Token(customer_id=customer_id, used=0, available=0)
                session.add(token)
                await session.flush()

            # Look up the LLM provider row.
            result = await session.execute(
                select(Llm).where(Llm.name == provider_name)
            )
            llm_row = result.scalar_one_or_none()
            if not llm_row:
                # No provider row registered; commit the Token bump and exit.
                token.used += total_tokens
                await session.commit()
                return

            # Find-or-create the per-(token, llm, model) row.
            result = await session.execute(
                select(TokenLlm).where(
                    TokenLlm.token_id == token.id,
                    TokenLlm.llm_id == llm_row.id,
                    TokenLlm.model_name == model_name,
                    TokenLlm.active.is_(True),
                )
            )
            token_llm = result.scalar_one_or_none()
            if not token_llm:
                token_llm = TokenLlm(
                    token_id=token.id,
                    llm_id=llm_row.id,
                    model_name=model_name,
                    used=0,
                    input_used=0,
                    output_used=0,
                    available=0,
                )
                session.add(token_llm)

            token.used += total_tokens
            token_llm.used += total_tokens
            token_llm.input_used += max(0, input_tokens)
            token_llm.output_used += max(0, output_tokens)
            await session.commit()
        except Exception:
            await session.rollback()


async def record_anthropic_usage(
    customer_id: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Convenience wrapper for Anthropic Claude usage."""
    await record_llm_usage(
        customer_id=customer_id,
        provider_name=ANTHROPIC_PROVIDER,
        model_name=model_name,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
