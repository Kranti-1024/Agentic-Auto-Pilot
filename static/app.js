document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('promptInput');
    const executeBtn = document.getElementById('executeBtn');
    const sampleBtns = document.querySelectorAll('.sample-btn');
    const taskChecklist = document.getElementById('taskChecklist');
    const terminalBody = document.getElementById('terminalBody');
    const globalProgress = document.getElementById('globalProgress');
    const exportMdBtn = document.getElementById('exportMdBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');

    let currentEventSource = null;
    let finalOutputs = [];
    let taskCount = 0;

    // --- UI Interactions ---

    sampleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            promptInput.value = btn.dataset.prompt;
        });
    });

    executeBtn.addEventListener('click', startPipeline);
    exportMdBtn.addEventListener('click', () => triggerExport('markdown'));
    exportPdfBtn.addEventListener('click', () => triggerExport('pdf'));

    // --- Pipeline Logic ---

    async function startPipeline() {
        const prompt = promptInput.value.trim();
        if (!prompt) {
            alert('Please enter a prompt first.');
            return;
        }

        // Reset UI state
        executeBtn.disabled = true;
        exportMdBtn.disabled = true;
        exportPdfBtn.disabled = true;
        promptInput.disabled = true;
        taskChecklist.innerHTML = `
            <div class="task-item" id="task-planning">
                <span class="task-badge badge-planning pulsing">[Planning]</span>
                <span class="task-title">Breaking down tasks...</span>
            </div>
        `;
        terminalBody.innerHTML = '<div class="terminal-line system-msg">Starting Agentic Pipeline...</div>';
        globalProgress.style.width = '5%';
        finalOutputs = [];
        taskCount = 0;

        try {
            // Trigger SSE backend
            const response = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Server error');
            }

            // Read SSE Stream manually to handle POST body (EventSource doesn't support POST)
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                
                // Process all complete events
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i];
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            handleStreamEvent(data);
                        } catch (e) {
                            console.error('Error parsing SSE json:', e, line);
                        }
                    }
                }
                // Keep incomplete event in buffer
                buffer = lines[lines.length - 1];
            }

        } catch (error) {
            appendTerminal(`ERROR: ${error.message}`, 'error');
            resetUI();
        }
    }

    // --- Stream Event Handler ---
    let currentTerminalBlock = null;

    function handleStreamEvent(data) {
        const { phase, status, content, task_index, task_title } = data;

        // Terminal Rendering
        if (status === 'start' || status === 'done' || status === 'failed') {
            appendTerminal(content, phase);
            currentTerminalBlock = null; // start fresh block for progress
        } else if (status === 'progress' || phase === 'planning' && status === 'complete') {
            if (!currentTerminalBlock) {
                currentTerminalBlock = document.createElement('span');
                currentTerminalBlock.className = `color-${phase}`;
                const line = document.createElement('div');
                line.className = 'terminal-line';
                line.appendChild(currentTerminalBlock);
                terminalBody.appendChild(line);
            }
            
            // Format markdown on the fly (basic)
            if (phase === 'planning' && status === 'complete') {
                 currentTerminalBlock.innerHTML = `<pre>${content}</pre>`;
            } else {
                 // Very naive append to avoid breaking HTML midway
                 currentTerminalBlock.textContent += content;
            }
            scrollToBottom();
        }

        // Checklist UI Updates
        if (phase === 'planning' && status === 'complete') {
            try {
                const plan = JSON.parse(content);
                buildTaskChecklist(plan.tasks);
                taskCount = plan.tasks.length;
                globalProgress.style.width = '20%';
                
                // Mark planning done
                const planBadge = document.querySelector('#task-planning .task-badge');
                if (planBadge) {
                    planBadge.className = 'task-badge badge-complete';
                    planBadge.textContent = '[Done]';
                }
            } catch(e) {}
        }
        else if (task_index >= 0) {
            updateTaskStatus(task_index, phase, status);
            // Update progress bar rough estimate
            const baseProgress = 20;
            const progressPerTask = 80 / taskCount;
            const currentTaskProgress = (task_index * progressPerTask);
            const phaseBonus = phase === 'drafting' ? (progressPerTask * 0.3) : (progressPerTask * 0.8);
            globalProgress.style.width = `${baseProgress + currentTaskProgress + phaseBonus}%`;
        }
        else if (phase === 'complete') {
            globalProgress.style.width = '100%';
            try {
                finalOutputs = JSON.parse(content);
                exportMdBtn.disabled = false;
                exportPdfBtn.disabled = false;
            } catch(e) {}
            resetUI();
        }
        else if (phase === 'error') {
            resetUI();
        }
    }

    // --- UI Helpers ---

    function buildTaskChecklist(tasks) {
        taskChecklist.innerHTML = '';
        tasks.forEach((task, index) => {
            const div = document.createElement('div');
            div.className = 'task-item';
            div.id = `task-${index}`;
            div.innerHTML = `
                <span class="task-badge badge-pending">[Waiting]</span>
                <span class="task-title" title="${task.description}">${task.title}</span>
            `;
            taskChecklist.appendChild(div);
        });
    }

    function updateTaskStatus(index, phase, status) {
        const taskEl = document.getElementById(`task-${index}`);
        if (!taskEl) return;
        const badge = taskEl.querySelector('.task-badge');
        
        if (status === 'start') {
            badge.className = `task-badge badge-${phase} pulsing`;
            badge.textContent = `[${phase}]`;
        } else if (phase === 'reviewing' && status === 'complete') {
            badge.className = `task-badge badge-complete`;
            badge.textContent = `[Done]`;
        }
    }

    function appendTerminal(text, phaseClass) {
        if (!text.trim()) return;
        const line = document.createElement('div');
        line.className = `terminal-line color-${phaseClass}`;
        line.textContent = text;
        terminalBody.appendChild(line);
        scrollToBottom();
    }

    function scrollToBottom() {
        terminalBody.scrollTop = terminalBody.scrollHeight;
    }

    function resetUI() {
        executeBtn.disabled = false;
        promptInput.disabled = false;
    }

    async function triggerExport(format) {
        try {
            if (format === 'pdf') {
                // Client-side PDF generation
                const element = document.createElement('div');
                // Professional styling injected for the PDF
                element.style.padding = '40px'; 
                element.style.fontFamily = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
                element.style.color = '#1f2937';
                element.style.background = '#fff';
                
                let htmlContent = `
                <style>
                    h1 { font-size: 26pt; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; margin-bottom: 30px; color: #111827; }
                    h2 { font-size: 18pt; color: #1f2937; margin-bottom: 15px; }
                    h3 { font-size: 14pt; color: #374151; page-break-after: avoid; margin-top: 20px; }
                    p, ul, ol { font-size: 11pt; line-height: 1.6; margin-bottom: 15px; }
                    li { page-break-inside: avoid; margin-bottom: 5px; }
                    pre { background: #f3f4f6; padding: 15px; border-radius: 8px; page-break-inside: avoid; font-family: monospace; white-space: pre-wrap; word-wrap: break-word; }
                    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
                    .task-container { page-break-after: always; padding-bottom: 20px; }
                    .task-container:last-child { page-break-after: auto; }
                </style>
                <h1>Agentic Execution Result</h1>`;
                
                finalOutputs.forEach((out, index) => {
                    htmlContent += `
                    <div class="task-container">
                        <h2>📌 ${out.title}</h2>
                        ${marked.parse(out.content)}
                    </div>`;
                });
                element.innerHTML = htmlContent;
                
                const opt = {
                    margin:       15, // Millimeters
                    filename:     `export_${Date.now()}.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true },
                    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak:    { mode: ['css', 'legacy'] }
                };
                
                html2pdf().set(opt).from(element).save();
                return;
            }

            // Fallback for markdown
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outputs: finalOutputs, format: format })
            });

            if (!response.ok) throw new Error('Export failed');

            // Handle file download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Try to extract filename from content-disposition header if available, else fallback
            const cd = response.headers.get('Content-Disposition');
            let filename = `export.md`;
            if (cd && cd.includes('filename=')) {
                filename = cd.split('filename=')[1].replace(/"/g, '');
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            
        } catch(e) {
            alert('Failed to export document: ' + e.message);
        }
    }
});
