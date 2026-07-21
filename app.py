import os
import json
import time
from flask import Flask, render_template, request, Response, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
import markdown

from agents import run_planner, run_worker_stream, run_reviewer_stream

load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure Gemini
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Configure directories
EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exports')
os.makedirs(EXPORT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/health')
def health():
    return jsonify({"status": "ok", "configured": bool(api_key)})


@app.route('/api/execute', methods=['POST'])
def execute_pipeline():
    """SSE endpoint that runs the full agent pipeline and streams results."""
    data = request.get_json()
    prompt = data.get('prompt', '')

    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400
    
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY is not configured"}), 500

    def generate():
        # Helper to yield SSE events
        def emit(phase, status, content, task_index=-1, task_title=""):
            event = {
                "phase": phase,
                "status": status,
                "content": content,
                "task_index": task_index,
                "task_title": task_title
            }
            return f"data: {json.dumps(event)}\n\n"
        
        try:
            # 1. PLANNER PHASE
            yield emit("planning", "start", "Analyzing request and breaking down tasks...\n")
            
            plan = run_planner(prompt)
            tasks = plan.get('tasks', [])
            
            yield emit("planning", "complete", json.dumps(plan), -1, plan.get('title', 'Project Plan'))

            final_outputs = []

            # Loop through tasks for WORKER and REVIEWER phases
            for i, task in enumerate(tasks):
                task_title = task.get('title', f"Task {i+1}")
                task_desc = task.get('description', '')
                
                # 2. WORKER PHASE
                yield emit("drafting", "start", f"\n\n--- Starting Draft: {task_title} ---\n", i, task_title)
                
                draft_content = ""
                for chunk in run_worker_stream(task_desc):
                    draft_content += chunk
                    yield emit("drafting", "progress", chunk, i, task_title)
                
                yield emit("drafting", "complete", "\nDrafting complete.\n", i, task_title)

                # 3. REVIEWER PHASE
                yield emit("reviewing", "start", f"\n\n--- Reviewing & Polishing: {task_title} ---\n", i, task_title)
                
                final_content = ""
                for chunk in run_reviewer_stream(draft_content):
                    final_content += chunk
                    yield emit("reviewing", "progress", chunk, i, task_title)
                
                yield emit("reviewing", "complete", "\nReview complete.\n", i, task_title)
                
                final_outputs.append({
                    "title": task_title,
                    "content": final_content
                })

            # 4. COMPLETE PHASE
            yield emit("complete", "done", json.dumps(final_outputs))
            
        except Exception as e:
            yield emit("error", "failed", str(e))

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/export', methods=['POST'])
def export_document():
    """Exports the final markdown outputs to PDF or Markdown file."""
    data = request.get_json()
    outputs = data.get('outputs', [])
    format_type = data.get('format', 'markdown') # 'markdown' or 'pdf'
    
    if not outputs:
        return jsonify({"error": "No data to export"}), 400

    # Combine all outputs into one document
    combined_md = f"# Agentic Execution Result\n\n"
    for output in outputs:
        combined_md += f"## {output.get('title', 'Task')}\n\n{output.get('content', '')}\n\n---\n\n"

    filename_base = f"export_{int(time.time())}"

    if format_type == 'pdf':
        return jsonify({"error": "PDF export is handled client-side"}), 400
        
    else: # Default to Markdown
        filename = f"{filename_base}.md"
        filepath = os.path.join(EXPORT_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(combined_md)
        mimetype = 'text/markdown'

    return send_file(filepath, as_attachment=True, download_name=filename, mimetype=mimetype)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
