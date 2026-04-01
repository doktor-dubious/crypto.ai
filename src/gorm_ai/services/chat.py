"""Chat service — orchestrates conversations between users and Claude.

Uses Claude's tool-use API to invoke safe, parameterized database queries.
No raw sales or prediction data flows to the LLM — only aggregated summaries.
"""

from __future__ import annotations

import json

import anthropic
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.connection import get_session
from gorm_ai.database.models.chat import ChatMessage, ChatSession
from gorm_ai.database.models.customer import Customer
from gorm_ai.database.models.configuration import Configuration
from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.llm import Llm
from gorm_ai.database.models.outlet import Outlet
from gorm_ai.database.models.outlet_group import OutletGroup
from gorm_ai.database.models.token import Token, TokenLlm
from gorm_ai.schemas.chat import (
    ChartConfig,
    ChartSeries,
    ChatMessageResponse,
    ChatSendResponse,
    OutletRef,
)
from gorm_ai.services.chat_tools import TOOL_DEFINITIONS, ToolExecutor

log = structlog.get_logger("gorm_ai.chat")

MODEL = "claude-haiku-4-5-20251001"
MAX_TOOL_ROUNDS = 8  # prevent runaway loops


DEFAULT_INSIGHTS_PROMPT = """\
You are a sales analytics assistant for Gorm AI, a newspaper/product \
distribution prediction platform.

You help users understand their historical sales data and forecasts. \
Answer concisely and helpfully.\
"""


def _build_system_prompt(
    customer_id: str,
    customer_name: str,
    outlet_groups: list[dict],
    custom_prompt: str | None = None,
    hidden_prompt: str | None = None,
) -> str:
    groups_text = "\n".join(
        f"  - {g['name']} (id: {g['id']})" for g in outlet_groups
    ) or "  (none)"

    persona = custom_prompt.strip() if custom_prompt else DEFAULT_INSIGHTS_PROMPT

    return f"""\
{persona}

## Current customer
ID: {customer_id}
Name: {customer_name}

IMPORTANT: Always use the customer_id UUID above when calling tools that \
require customer_id. Never pass a customer name as customer_id.

## Available outlet groups
{groups_text}

## Important rules
1. ALWAYS use the lookup_entities tool first when the user mentions an \
outlet, city, region, or group by name — you need the UUID before you \
can query data.
2. Use query_sales_summary, compare_periods, or get_top_outlets to \
answer questions about historical sales.
3. Use get_prediction_summary to answer questions about future demand / \
predictions.
4. If the user's question is ambiguous (unclear customer, date range, \
or outlet), ask for clarification rather than guessing.
5. When returning results that would benefit from a chart, include \
a JSON block with chart configuration in your response using this \
exact format on its own line:

CHART_JSON::{{"type":"line","title":"...","x_key":"period","series":[{{"name":"Sold","data_key":"total"}}],"data":[{{"period":"2025-01","total":1234}}]}}

6. When returning outlet-specific results (rankings, lookups), include \
an OUTLETS_JSON block:

OUTLETS_JSON::[{{"outlet_id":"...","name":"...","city":"...","value":123,"value_label":"Total sold"}}]

7. Weekday numbering: 1=Monday, 7=Sunday.
8. Keep answers concise. Use bullet points for lists.
{_hidden_section(hidden_prompt)}"""


def _hidden_section(hidden_prompt: str | None) -> str:
    if hidden_prompt and hidden_prompt.strip():
        return f"\n\n## Additional context\n{hidden_prompt}\n"
    return ""


class ChatService:
    """Orchestrates LLM conversations with tool execution."""

    def __init__(self, db: AsyncSession, api_key: str) -> None:
        self.db = db
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self._tool_executor: ToolExecutor | None = None

    def _get_tool_executor(self, customer_id: str) -> ToolExecutor:
        if not self._tool_executor or self._tool_executor.allowed_customer_id != customer_id:
            self._tool_executor = ToolExecutor(self.db, allowed_customer_id=customer_id)
        return self._tool_executor

    async def send_message(
        self,
        customer_id: str,
        message: str,
        session_id: str | None = None,
    ) -> ChatSendResponse:
        """Process a user message and return the assistant response."""

        # 1. Load customer context
        customer = await self._get_customer(customer_id)
        if not customer:
            raise ValueError(f"Customer not found: {customer_id}")

        outlet_groups = await self._get_outlet_groups(customer_id)
        custom_prompt, hidden_prompt = await self._get_insights_prompts(customer_id)

        # 2. Get or create session
        session = await self._get_or_create_session(
            customer_id, session_id, message,
        )

        # 3. Persist user message and commit so session exists for sure
        user_msg = ChatMessage(
            session_id=session.id,
            role=1,
            content=message,
        )
        self.db.add(user_msg)
        await self.db.commit()

        # 4. Build conversation history for Claude
        messages = await self._build_messages(session, message)

        # 5. Call Claude in a tool-use loop
        system = _build_system_prompt(customer_id, customer.name, outlet_groups, custom_prompt, hidden_prompt)
        assistant_text, chart, outlets, total_tokens = await self._run_conversation(
            system, messages, customer_id,
        )

        # 6. Persist assistant message
        data: dict = {}
        if chart:
            data["chart"] = chart.model_dump()
        if outlets:
            data["outlets"] = [o.model_dump() for o in outlets]

        assistant_msg = ChatMessage(
            session_id=session.id,
            role=2,
            content=assistant_text,
            data=data or None,
            input_tokens=total_tokens.get("input"),
            output_tokens=total_tokens.get("output"),
        )
        self.db.add(assistant_msg)

        # 7. Update session title if this is the first exchange
        try:
            await self.db.refresh(session, ["messages"])
            user_count = sum(1 for m in session.messages if m.role == 1)
            if user_count <= 1:
                session.title = message[:120]
        except Exception:
            pass

        await self.db.commit()
        await self.db.refresh(assistant_msg)

        # 8. Track token usage
        if total_tokens.get("input") or total_tokens.get("output"):
            total = (total_tokens.get("input") or 0) + (total_tokens.get("output") or 0)
            await self._update_token_usage(customer_id, total)

        return ChatSendResponse(
            session_id=session.id,
            message=ChatMessageResponse(
                id=assistant_msg.id,
                role="assistant",
                content=assistant_text,
                chart=chart,
                outlets=outlets,
                created_at=assistant_msg.created_at,
            ),
        )

    async def _run_conversation(
        self,
        system: str,
        messages: list[dict],
        customer_id: str,
    ) -> tuple[str, ChartConfig | None, list[OutletRef] | None, dict]:
        """Run the Claude conversation loop with tool use."""
        total_input = 0
        total_output = 0

        for round_num in range(MAX_TOOL_ROUNDS):
            try:
                response = await self.client.messages.create(
                    model=MODEL,
                    max_tokens=4096,
                    system=system,
                    tools=TOOL_DEFINITIONS,
                    messages=messages,
                )
            except anthropic.RateLimitError as exc:
                log.warning("rate_limited", round=round_num, error=str(exc))
                # If we already have some results, return what we have
                if round_num > 0:
                    return (
                        "I was rate-limited while processing your request. "
                        "Please wait a moment and try again.",
                        None, None,
                        {"input": total_input, "output": total_output},
                    )
                raise ValueError(
                    "The AI service is temporarily busy. "
                    "Please wait a minute and try again."
                )

            total_input += response.usage.input_tokens
            total_output += response.usage.output_tokens

            # Check if Claude wants to use tools
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            text_blocks = [b for b in response.content if b.type == "text"]

            if not tool_uses:
                # Final text response — extract charts/outlets and return
                full_text = "\n".join(b.text for b in text_blocks)
                chart, clean_text = self._extract_chart(full_text)
                outlets, clean_text = self._extract_outlets(clean_text)
                return (
                    clean_text.strip(),
                    chart,
                    outlets,
                    {"input": total_input, "output": total_output},
                )

            # Build assistant message content
            assistant_content = []
            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            messages.append({"role": "assistant", "content": assistant_content})

            # Execute each tool and build tool results
            tool_results = []
            for tool_use in tool_uses:
                log.info(
                    "tool_call",
                    tool=tool_use.name,
                    params=tool_use.input,
                )
                tool_executor = self._get_tool_executor(customer_id)
                result = await tool_executor.execute(
                    tool_use.name, tool_use.input,
                )
                log.info(
                    "tool_result",
                    tool=tool_use.name,
                    result_keys=list(result.keys()) if isinstance(result, dict) else None,
                )
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": json.dumps(result, default=str),
                })

            messages.append({"role": "user", "content": tool_results})

        # If we exhaust rounds, return whatever text we have
        return (
            "I wasn't able to fully answer your question — too many tool "
            "calls were needed. Please try a more specific question.",
            None,
            None,
            {"input": total_input, "output": total_output},
        )

    async def _build_messages(
        self, session: ChatSession, new_message: str,
    ) -> list[dict]:
        """Build Claude message history from persisted messages."""
        # Eagerly load messages to avoid sync lazy-load in async context
        await self.db.refresh(session, ["messages"])
        messages: list[dict] = []

        for msg in session.messages:
            if msg.role == 1:  # user
                messages.append({"role": "user", "content": msg.content})
            elif msg.role == 2:  # assistant
                messages.append({"role": "assistant", "content": msg.content})

        # Add the new user message
        messages.append({"role": "user", "content": new_message})
        return messages

    def _extract_chart(
        self, text: str,
    ) -> tuple[ChartConfig | None, str]:
        """Extract CHART_JSON:: block from assistant text."""
        marker = "CHART_JSON::"
        if marker not in text:
            return None, text

        lines = text.split("\n")
        clean_lines = []
        chart = None

        for line in lines:
            stripped = line.strip()
            if stripped.startswith(marker):
                try:
                    raw = stripped[len(marker):]
                    data = json.loads(raw)
                    chart = ChartConfig(
                        type=data["type"],
                        title=data.get("title"),
                        x_key=data["x_key"],
                        series=[ChartSeries(**s) for s in data["series"]],
                        data=data["data"],
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    log.warning("chart_parse_error", error=str(exc))
                    clean_lines.append(line)
            else:
                clean_lines.append(line)

        return chart, "\n".join(clean_lines)

    def _extract_outlets(
        self, text: str,
    ) -> tuple[list[OutletRef] | None, str]:
        """Extract OUTLETS_JSON:: block from assistant text."""
        marker = "OUTLETS_JSON::"
        if marker not in text:
            return None, text

        lines = text.split("\n")
        clean_lines = []
        outlets: list[OutletRef] | None = None

        for line in lines:
            stripped = line.strip()
            if stripped.startswith(marker):
                try:
                    raw = stripped[len(marker):]
                    data = json.loads(raw)
                    outlets = [OutletRef(**o) for o in data]
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    log.warning("outlets_parse_error", error=str(exc))
                    clean_lines.append(line)
            else:
                clean_lines.append(line)

        return outlets, "\n".join(clean_lines)

    async def _get_customer(self, customer_id: str) -> Customer | None:
        result = await self.db.execute(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def _get_insights_prompts(
        self, customer_id: str,
    ) -> tuple[str | None, str | None]:
        """Return (system_prompt, hidden_prompt).

        system_prompt comes from customer_configuration (per-customer).
        hidden_prompt comes from configuration (gorm-level, shared).
        """
        # Per-customer system prompt
        result = await self.db.execute(
            select(CustomerConfiguration.insights_system_prompt).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        system_prompt = result.scalar_one_or_none()

        # Gorm-level hidden prompt
        result = await self.db.execute(
            select(Configuration.insights_hidden_prompt).where(
                Configuration.active.is_(True),
            )
        )
        hidden_prompt = result.scalar_one_or_none()

        return system_prompt, hidden_prompt

    async def _get_outlet_groups(self, customer_id: str) -> list[dict]:
        result = await self.db.execute(
            select(OutletGroup.id, OutletGroup.name).where(
                OutletGroup.customer_id == customer_id,
                OutletGroup.active.is_(True),
            )
        )
        return [{"id": r.id, "name": r.name} for r in result.all()]

    async def _get_or_create_session(
        self,
        customer_id: str,
        session_id: str | None,
        first_message: str,
    ) -> ChatSession:
        if session_id:
            result = await self.db.execute(
                select(ChatSession).where(
                    ChatSession.id == session_id,
                    ChatSession.active.is_(True),
                )
            )
            session = result.scalar_one_or_none()
            if session:
                return session

        session = ChatSession(
            customer_id=customer_id,
            title=first_message[:120],
        )
        self.db.add(session)
        await self.db.flush()
        return session

    async def _update_token_usage(
        self, customer_id: str, total_tokens: int,
    ) -> None:
        """Track token usage in token/token_llm tables."""
        async for session in get_session():
            try:
                result = await session.execute(
                    select(Token).where(
                        Token.customer_id == customer_id,
                        Token.active.is_(True),
                    )
                )
                token = result.scalar_one_or_none()
                if not token:
                    token = Token(
                        customer_id=customer_id, used=0, available=0,
                    )
                    session.add(token)
                    await session.flush()

                result = await session.execute(
                    select(Llm).where(Llm.name == "Anthropic")
                )
                llm_row = result.scalar_one_or_none()
                if not llm_row:
                    await session.commit()
                    return

                result = await session.execute(
                    select(TokenLlm).where(
                        TokenLlm.token_id == token.id,
                        TokenLlm.llm_id == llm_row.id,
                        TokenLlm.active.is_(True),
                    )
                )
                token_llm = result.scalar_one_or_none()
                if not token_llm:
                    token_llm = TokenLlm(
                        token_id=token.id,
                        llm_id=llm_row.id,
                        used=0, available=0,
                    )
                    session.add(token_llm)

                token.used += total_tokens
                token_llm.used += total_tokens
                await session.commit()
            except Exception:
                await session.rollback()
