import os
import json
import google.generativeai as genai
from typing import List, Dict, Generator, Any

def get_gemini_model(system_instruction: str) -> genai.GenerativeModel:
    """Helper to initialize the model with a specific system prompt."""
    return genai.GenerativeModel(
        model_name="gemini-3.5-flash-lite",
        system_instruction=system_instruction
    )

# ---------------------------------------------------------------------------
# Planner Agent
# ---------------------------------------------------------------------------
PLANNER_PROMPT = """
You are the Planner Agent. Your job is to take a raw user prompt and break it down into a structured list of actionable sub-tasks.
Keep it FAST and CONCISE. Generate a maximum of 2 to 3 sub-tasks so the demo runs quickly.
You must return ONLY valid JSON in the following format:
{
    "title": "A short, descriptive title",
    "tasks": [
        {
            "title": "Sub-task title",
            "description": "Short 1-sentence description of what needs to be done",
            "complexity": "low|medium|high"
        }
    ]
}
Do not wrap the output in markdown code blocks like ```json. Return just the raw JSON object.
"""

def run_planner(prompt: str) -> Dict[str, Any]:
    """Runs the planner agent and returns the structured task breakdown."""
    model = get_gemini_model(PLANNER_PROMPT)
    # Using streaming just to wait for the full response in chunks, but we only return the final parsed JSON
    response = model.generate_content(prompt)
    try:
        # Strip potential markdown blocks if the model ignored instructions
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        return json.loads(text.strip())
    except Exception as e:
        # Fallback if parsing fails
        return {
            "title": "Fallback Task Breakdown",
            "tasks": [{"title": "Process Prompt", "description": prompt, "complexity": "medium"}],
            "error": str(e)
        }


# ---------------------------------------------------------------------------
# Worker Agent
# ---------------------------------------------------------------------------
WORKER_PROMPT = """
You are the Worker Agent. Your job is to take a single task description and execute it.
Be extremely fast, concise, and to the point. Do not write unnecessarily long paragraphs. Get straight to the value.
Focus only on this specific task. Output markdown formatted text.
"""

def run_worker_stream(task_description: str) -> Generator[str, None, None]:
    """Runs the worker agent and yields the response as a stream of text chunks."""
    model = get_gemini_model(WORKER_PROMPT)
    response = model.generate_content(
        f"Execute this task:\n{task_description}",
        stream=True
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text


# ---------------------------------------------------------------------------
# Reviewer Agent
# ---------------------------------------------------------------------------
REVIEWER_PROMPT = """
You are the Reviewer Agent. Your job is to take raw draft content from a worker and polish it into a final, professional deliverable.
Fix any formatting issues, ensure consistent tone, correct grammar, and make it look extremely clean using Markdown.
Do not add fluff or introductory text like 'Here is the polished version'. Just output the final polished text.
"""

def run_reviewer_stream(draft_content: str) -> Generator[str, None, None]:
    """Runs the reviewer agent and yields the response as a stream of text chunks."""
    model = get_gemini_model(REVIEWER_PROMPT)
    response = model.generate_content(
        f"Polish this draft content:\n{draft_content}",
        stream=True
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text
