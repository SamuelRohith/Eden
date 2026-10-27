"""Microsoft Agent Framework agent using local Qwen; JSON stdin/stdout bridge.

Node owns retrieval and deterministic evidence checks. This agent writes the
story only; it never calculates scores or invents simulator events.
"""
import asyncio
import json
import sys


async def main():
    from agent_framework import Agent
    from agent_framework.ollama import OllamaChatClient
    payload = json.load(sys.stdin)
    agent = Agent(
        client=OllamaChatClient(host=payload["host"], model=payload["model"]),
        name="EdenStoryteller",
        instructions=payload["system"],
    )
    result = await agent.run(payload["prompt"], options={
        "temperature": 0,
        "think": False,
        "response_format": payload["schema"],
        "num_ctx": payload["context"],
        "max_tokens": payload["maxTokens"],
    })
    print(json.dumps({"text": result.text}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
