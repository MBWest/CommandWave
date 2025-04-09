/**
 * Filename: static/js/script.js - Modified for Playbook, Floating Notes, Upload & Prompt on Add
 * Description: Frontend JavaScript logic for the Command Wave application.
 * Handles:
 * - Reading Playbook file uploads from user's computer.
 * - Loading selected Playbook content for the active terminal tab.
 * - Rendering multiple Playbook contents in collapsible containers with remove buttons.
 * - Real-time code block preview with variable substitution (tab-specific).
 * - Copying/Executing code from Playbook code blocks.
 * - Managing terminal tabs (switching, adding with prompt, renaming, deleting).
 * - Managing tab-specific variable state and loaded playbooks state.
 * - Managing floating notes panels (global & tab-specific), using backend API for persistence.
 * - Activating Prism.js for syntax highlighting.
 */

document.addEventListener('DOMContentLoaded', async () => {

    // --- Constants & Global State ---
    const VARIABLE_MAP = {
        'var-target-ip': { stateKey: 'targetIP', placeholder: '$TargetIP' },
        'var-port':      { stateKey: 'port',     placeholder: '$Port' },
        'var-dc-ip':     { stateKey: 'dcIP',     placeholder: '$DCIP' },
        'var-user-file': { stateKey: 'userFile', placeholder: '$UserFile' },
        'var-pass-file': { stateKey: 'passFile', placeholder: '$PassFile' },
        'var-word-list': { stateKey: 'wordlist', placeholder: '$Wordlist' },
        'var-control-socket': { stateKey: 'controlSocket', placeholder: '$ControlSocket' }
    };
    const DEFAULT_VARIABLES = { targetIP: '', port: '', dcIP: '', userFile: '', passFile: '', wordlist: '', controlSocket: '' };

    // State structure: Holds non-note state client-side
    let terminalVariablesState = {}; // { terminalId: { variables: {...}, loadedPlaybooks: { 'filename.md': {...} } } }
    let activeTerminalId = 'term-main';
    let initialTerminalPort = 7681; // Default, might be overwritten by HTML data attribute
    // Debounce timer IDs for saving notes
    let globalNotesSaveTimeout = null;
    let tabNotesSaveTimeout = null;

    // --- DOM Element References ---
    const searchInput = document.getElementById('searchInput');
    const ioMessageDiv = document.getElementById('io-message');
    // Playbook Elements
    const playbookSection = document.getElementById('playbook-section');
    const playbookContentDiv = document.getElementById('playbook-content');
    const playbookUploadInput = document.getElementById('playbook-upload-input');
    // Variable Inputs
    const variableInputElements = {};
    Object.keys(VARIABLE_MAP).forEach(id => {
        variableInputElements[id] = document.getElementById(id);
        if (!variableInputElements[id]) { console.warn(`Var input "${id}" not found.`); }
    });
    // Terminal Elements
    const terminalTabsContainer = document.querySelector('.terminal-tabs');
    const terminalIframesContainer = document.querySelector('.terminal-iframes');
    const addTerminalTabBtn = document.getElementById('add-terminal-tab-btn');
    const mainTerminalTab = document.querySelector('.terminal-tab[data-terminal-id="term-main"]');
    // Notes Elements
    const tabNotesToggleBtn = document.getElementById('tab-notes-toggle-btn');
    const globalNotesToggleBtn = document.getElementById('global-notes-toggle-btn');
    const tabNotesPanel = document.getElementById('tab-notes-panel');
    const globalNotesPanel = document.getElementById('global-notes-panel');
    const tabNotesArea = document.getElementById('tab-notes-area');
    const globalNotesArea = document.getElementById('global-notes-area');
    const tabNotesPanelLabel = document.getElementById('tab-notes-panel-label');
    const closePanelButtons = document.querySelectorAll('.close-notes-panel-btn');

    // --- Utility Functions ---
    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return unsafe.toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function showIoMessage(message, type = 'info', duration = 5000) {
        if (!ioMessageDiv) return;
        ioMessageDiv.textContent = message;
        ioMessageDiv.className = `message ${type}`;
        void ioMessageDiv.offsetWidth; // Trigger reflow
        ioMessageDiv.classList.add('visible');
        if (ioMessageDiv.hideTimeout) clearTimeout(ioMessageDiv.hideTimeout);
        ioMessageDiv.hideTimeout = setTimeout(() => {
            ioMessageDiv.classList.remove('visible');
            ioMessageDiv.addEventListener('transitionend', () => {
                if (!ioMessageDiv.classList.contains('visible')) {
                    ioMessageDiv.textContent = '';
                    ioMessageDiv.className = 'message';
                }
            }, { once: true });
        }, duration);
    }


    // --- Initialization Functions ---
    function updateVariableInputsUI(terminalId) {
        const termState = terminalVariablesState[terminalId];
        const variables = termState ? termState.variables : DEFAULT_VARIABLES;
        for (const inputId in VARIABLE_MAP) {
            const stateKey = VARIABLE_MAP[inputId].stateKey;
            const inputElement = variableInputElements[inputId];
            if (inputElement) {
                inputElement.value = variables[stateKey] || '';
            }
        }
     }

    // ensureTerminalState no longer needs to manage 'notes' field directly
    function ensureTerminalState(terminalId) {
         if (!terminalVariablesState[terminalId]) {
             console.log(`Initializing non-note state for terminal: ${terminalId}`);
             terminalVariablesState[terminalId] = {
                 variables: { ...DEFAULT_VARIABLES },
                 loadedPlaybooks: {}
             };
         } else {
             if (!terminalVariablesState[terminalId].loadedPlaybooks) {
                 terminalVariablesState[terminalId].loadedPlaybooks = {};
             }
              // Removed notes initialization here
         }
     }

    async function initializeApp() {
        console.log("Initializing App...");
        try {
            // Get initial port
            const mainTermElem = document.getElementById('term-main');
            const portFromData = mainTermElem?.dataset.initialPort;
             if (portFromData && !isNaN(parseInt(portFromData, 10))) {
                initialTerminalPort = parseInt(portFromData, 10);
             }
             const mainTerminalTab = document.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTerminalTab) {
                mainTerminalTab.title = `Main Terminal (Port ${initialTerminalPort}). Double-click rename.`;
             }

            // Initialize state for the main terminal (non-notes)
            activeTerminalId = 'term-main';
            ensureTerminalState(activeTerminalId);
            updateVariableInputsUI(activeTerminalId);

            // Load Notes via API
            await loadInitialNotes();

            setupEventListeners();
            console.log("App Init OK.");
        } catch (error) {
            console.error("App Init failed:", error);
            if(playbookContentDiv) playbookContentDiv.innerHTML = `<p class="error">App init failed: ${escapeHtml(error.message)}</p>`;
            showIoMessage(`Init failed: ${error.message}`, 'error', 15000);
        }
    }

    // --- Variable Substitution (Unchanged) ---
    function performVariableSubstitution(originalCommand, variables) {
        let substitutedCommandHtml = escapeHtml(originalCommand);
        for (const inputId in VARIABLE_MAP) {
            const { stateKey, placeholder } = VARIABLE_MAP[inputId];
            const value = variables && variables[stateKey] ? variables[stateKey].trim() : '';
            if (value) {
                const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedPlaceholder, 'g');
                const replacementHtml = `<span class="substituted-var">${escapeHtml(value)}</span>`;
                substitutedCommandHtml = substitutedCommandHtml.replace(regex, replacementHtml);
            }
        }
        return substitutedCommandHtml;
    }

    function getSubstitutedPlainText(originalCommand, variables) {
        let text = originalCommand;
        for (const inputId in VARIABLE_MAP) {
            const { stateKey, placeholder } = VARIABLE_MAP[inputId];
            const value = variables && variables[stateKey] ? variables[stateKey].trim() : '';
            if (value) {
                const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedPlaceholder, 'g');
                text = text.replace(regex, value);
            }
        }
        return text;
    }


    // --- Playbook Handling (Using marked.js for parsing) ---
    function handlePlaybookUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!file.name.endsWith('.md')) {
             showIoMessage('Please select a Markdown (.md) file.', 'warning');
             event.target.value = ''; return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const mdContent = e.target.result;
            const filename = file.name;
            console.log(`Read playbook "${filename}" from disk.`);
            try {
                // Use marked.js for parsing
                if (typeof marked === 'undefined') throw new Error("Markdown library (marked.js) not loaded.");
                const tokens = marked.lexer(mdContent);
                const parsedContent = [];
                let currentTextBlock = '';
                const addTextBlock = () => {
                    if (currentTextBlock.trim()) {
                        parsedContent.push({ type: 'text', content: marked.parse(currentTextBlock.trim()) });
                    }
                    currentTextBlock = '';
                };
                tokens.forEach(token => {
                    if (token.type === 'code') {
                        addTextBlock();
                        parsedContent.push({ type: 'code', language: token.lang || 'plaintext', content: token.text });
                    } else if (token.type === 'space') {
                         currentTextBlock += token.raw;
                    } else {
                        currentTextBlock += token.raw + '\n';
                    }
                });
                addTextBlock();
                // End marked.js parsing

                // Add parsed content to state
                ensureTerminalState(activeTerminalId);
                if (terminalVariablesState[activeTerminalId]?.loadedPlaybooks[filename]) {
                     if (!confirm(`Playbook "${filename}" is already loaded. Replace it?`)) {
                         event.target.value = ''; return;
                     }
                }
                terminalVariablesState[activeTerminalId].loadedPlaybooks[filename] = { content: parsedContent, isExpanded: true };
                console.log(`Parsed and added playbook "${filename}" to state for ${activeTerminalId}`);
                displayPlaybooks(activeTerminalId); // Re-render display
                showIoMessage(`Playbook "${filename}" loaded and parsed.`, 'success');

            } catch (parseError) {
                 console.error("Error parsing uploaded playbook:", parseError);
                 showIoMessage(`Failed to parse ${filename}: ${parseError.message}`, 'error');
            }
            event.target.value = ''; // Reset input
        };
        reader.onerror = function(e) {
            console.error("Error reading file:", e);
            showIoMessage(`Error reading file: ${file.name}`, 'error');
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    function displayPlaybooks(terminalId) {
        if (!playbookContentDiv) return;
        ensureTerminalState(terminalId); // Ensure non-note state exists
        playbookContentDiv.innerHTML = '';
        const playbooksMap = terminalVariablesState[terminalId]?.loadedPlaybooks || {};
        const currentVariables = terminalVariablesState[terminalId]?.variables || DEFAULT_VARIABLES;

        if (Object.keys(playbooksMap).length === 0) {
            playbookContentDiv.innerHTML = '<p>No playbooks loaded. Upload one using the button above.</p>';
            return;
        }
        Object.entries(playbooksMap).forEach(([filename, playbookData]) => {
            try {
                // Create playbook container elements (wrapper, header, body, etc.)
                const wrapper = document.createElement('div');
                wrapper.className = 'playbook-container';
                wrapper.dataset.filename = filename;
                if (!playbookData.isExpanded) wrapper.classList.add('collapsed');

                const header = document.createElement('div'); header.className = 'playbook-header';
                const titleSpan = document.createElement('span'); titleSpan.className = 'playbook-title'; titleSpan.textContent = filename.replace('.md', '');
                header.appendChild(titleSpan);
                const removeBtn = document.createElement('button'); removeBtn.className = 'remove-playbook-btn'; removeBtn.innerHTML = '&times;'; removeBtn.title = `Remove playbook "${filename}"`; removeBtn.dataset.filename = filename;
                removeBtn.addEventListener('click', handleRemovePlaybookClick);
                header.appendChild(removeBtn);
                header.addEventListener('click', (event) => {
                    if (event.target === removeBtn || removeBtn.contains(event.target)) return;
                    playbookData.isExpanded = !playbookData.isExpanded; // Toggle state in memory
                    wrapper.classList.toggle('collapsed'); // Toggle CSS class
                });

                const body = document.createElement('div'); body.className = 'playbook-body';
                const content = playbookData.content || [];
                if (content.length === 0) { body.innerHTML = '<p><i>Playbook content is empty or failed to parse.</i></p>'; }
                else { content.forEach((block, index) => renderPlaybookBlock(block, index, body, currentVariables)); } // Pass variables

                wrapper.appendChild(header); wrapper.appendChild(body); playbookContentDiv.appendChild(wrapper);
            } catch (renderError) { console.error("Error rendering playbook container:", filename, renderError); }
        });
        // Apply syntax highlighting
        if (window.Prism) Prism.highlightAllUnder(playbookContentDiv);
        else console.warn("Prism.js not detected.");
    }

     function renderPlaybookBlock(block, index, parentElement, variables) {
        try {
            if (block.type === 'text') {
                const textDiv = document.createElement('div'); textDiv.className = 'playbook-text-block';
                textDiv.innerHTML = block.content || ''; parentElement.appendChild(textDiv); // Assumes HTML from marked.parse
            } else if (block.type === 'code') {
                // Create elements (container, pre, code, buttons)
                 const codeContainer = document.createElement('div'); codeContainer.className = 'playbook-code-block';
                 const pre = document.createElement('pre'); const code = document.createElement('code');
                 // Set language class for Prism
                 if (block.language) {
                    const safeLanguage = escapeHtml(block.language.toLowerCase().split(/[^a-z0-9]/)[0]);
                    const langClass = `language-${safeLanguage || 'plaintext'}`;
                    code.className = langClass; pre.className = langClass;
                 } else { code.className = 'language-plaintext'; pre.className = 'language-plaintext'; }
                 // Substitute variables
                const substitutedHtml = performVariableSubstitution(block.content || '', variables);
                code.innerHTML = substitutedHtml;
                const substitutedText = getSubstitutedPlainText(block.content || '', variables);
                pre.appendChild(code); codeContainer.appendChild(pre);
                // Add buttons
                 const buttonContainer = document.createElement('div'); buttonContainer.className = 'code-block-buttons';
                 const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'copy-btn'; copyBtn.title = 'Copy Code'; copyBtn.textContent = 'Copy'; copyBtn.dataset.commandSubstituted = substitutedText;
                 copyBtn.addEventListener('click', () => handleCopyCommand(copyBtn));
                 const executeBtn = document.createElement('button'); executeBtn.type = 'button'; executeBtn.className = 'execute-btn'; executeBtn.title = 'Execute Code'; executeBtn.textContent = 'Execute'; executeBtn.dataset.commandSubstituted = substitutedText;
                 executeBtn.addEventListener('click', () => handleExecuteCommand(executeBtn));
                 buttonContainer.appendChild(copyBtn); buttonContainer.appendChild(executeBtn); codeContainer.appendChild(buttonContainer); parentElement.appendChild(codeContainer);
            }
        } catch (error) { console.error("Error rendering playbook block:", error, "Block:", block); }
    }


    // --- Event Handlers ---
    function handleVariableInputChange(event) {
        const inputId = event.target.id;
        if (VARIABLE_MAP[inputId]) {
            const stateKey = VARIABLE_MAP[inputId].stateKey;
            const value = event.target.value;
            ensureTerminalState(activeTerminalId); // Ensure non-note state exists
            terminalVariablesState[activeTerminalId].variables[stateKey] = value; // Update variable state
            displayPlaybooks(activeTerminalId); // Re-render playbooks to reflect new variable values
        }
    }

     function handleSearchInputChange(event) {
        const searchTerm = event.target.value.toLowerCase().trim();
        const contentNodes = playbookContentDiv?.querySelectorAll('.playbook-body .playbook-text-block, .playbook-body .playbook-code-block code');

        contentNodes?.forEach(node => {
             const originalHtml = node.dataset.originalHtml || node.innerHTML;
             if (!node.dataset.originalHtml) { node.dataset.originalHtml = originalHtml; }

            if (searchTerm) {
                 const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                 // More robust highlight logic needed here to avoid breaking HTML/spans
                 // Placeholder: Simple replace, might break things
                 node.innerHTML = originalHtml.replace(regex, `<mark>$1</mark>`);
            } else {
                if(node.dataset.originalHtml) node.innerHTML = node.dataset.originalHtml;
                delete node.dataset.originalHtml;
            }
        });

        if (window.Prism) {
             Prism.highlightAllUnder(playbookContentDiv); // Re-highlight after search changes
        }
     }

    function handleRemovePlaybookClick(event) {
        event.stopPropagation();
        const button = event.currentTarget;
        const filenameToRemove = button.dataset.filename;
        if (!filenameToRemove) return;

        if (confirm(`Remove playbook "${filenameToRemove}" from this tab?`)) {
            ensureTerminalState(activeTerminalId);
            if (terminalVariablesState[activeTerminalId]?.loadedPlaybooks[filenameToRemove]) {
                delete terminalVariablesState[activeTerminalId].loadedPlaybooks[filenameToRemove]; // Remove from JS state
                displayPlaybooks(activeTerminalId); // Update display
                showIoMessage(`Playbook "${filenameToRemove}" removed.`, 'info');
            }
        }
    }

    // --- Playbook Code Block Action Handlers ---
     async function handleCopyCommand(button) {
         const commandToCopy = button.dataset.commandSubstituted;
         if (typeof commandToCopy !== 'string' || !navigator.clipboard) {
             showIoMessage("Clipboard copy failed.", "error");
             // Visual feedback
             const originalText = button.textContent; button.textContent = 'Fail'; button.disabled = true;
             setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 1500);
             return;
         }
         try {
             await navigator.clipboard.writeText(commandToCopy);
             showIoMessage("Copied!", "success", 2000);
             const originalText = button.textContent; button.textContent = 'Copied!'; button.disabled = true;
             setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 1500);
         } catch (err) {
             console.error("Clipboard write failed:", err);
             showIoMessage(`Copy Error: ${err.message}`, "error");
             const originalText = button.textContent; button.textContent = 'Error!'; button.disabled = true;
             setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
         }
      }

     async function handleExecuteCommand(button) {
         const commandToSend = button.dataset.commandSubstituted?.trim();
         if (!commandToSend) { showIoMessage("Empty command.", "warning"); return; }

         const activeTabElement = terminalTabsContainer?.querySelector('.terminal-tab.active');
         const currentTerminalId = activeTabElement?.dataset.terminalId;
         if (!currentTerminalId) { showIoMessage("No active terminal.", "error"); return; }

         let targetPort;
         if (currentTerminalId === 'term-main') {
             targetPort = initialTerminalPort;
         } else {
             const portMatch = currentTerminalId.match(/^term-(\d+)$/);
             targetPort = (portMatch && portMatch[1]) ? parseInt(portMatch[1], 10) : NaN;
         }
         if (isNaN(targetPort)) { showIoMessage("Cannot determine target port.", "error"); return; }

         console.log(`Executing on Port ${targetPort}: ${commandToSend}`);
         showIoMessage(`Sending to Port ${targetPort}...`, 'info', 2000);
         button.disabled = true; const originalText = button.textContent; button.textContent = 'Executing...';

         try {
             const response = await fetch('/api/terminals/sendkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: targetPort, command: commandToSend }) });
             const result = await response.json();

             if (response.ok && result.success) {
                 showIoMessage(result.message || "Command sent.", 'success', 3000);
                 button.textContent = 'Sent!'; button.classList.add('sent');
                 setTimeout(() => { button.textContent = originalText; button.classList.remove('sent'); button.disabled = false; }, 1500);
             } else {
                 console.error("Execute fail:", result);
                 showIoMessage(`Execute Error: ${result.error || response.statusText}`, 'error');
                 button.textContent = 'Error!'; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
             }
         } catch (error) {
             console.error("Net error exec:", error);
             showIoMessage(`Net Error: ${error.message}`, 'error');
             button.textContent = 'Error!'; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
         }
      }


    // --- Terminal Tab Handling ---
     function handleTerminalTabClick(event) {
        const clickedTab = event.target.closest('.terminal-tab');
        const clickedCloseButton = event.target.closest('.close-tab-btn');

        if (clickedCloseButton) { handleDeleteTerminalTab(clickedCloseButton); }
        else if (clickedTab && !clickedTab.classList.contains('active')) {
            if (clickedTab !== addTerminalTabBtn && clickedTab.dataset.terminalId) {
                switchActiveTerminalTab(clickedTab, clickedTab.dataset.terminalId);
            }
        }
     }

     function handleTerminalTabDoubleClick(event) {
        const clickedTab = event.target.closest('.terminal-tab');
        if (!clickedTab || event.target.closest('.close-tab-btn') || clickedTab === addTerminalTabBtn || !clickedTab.dataset.terminalId) { return; }
        renameTerminalTab(clickedTab);
     }

    // Modified to prompt for name on add
     async function handleAddTerminalTab() {
        if (!addTerminalTabBtn) return;

        // 1. Prompt for the tab name FIRST
        const defaultPromptName = "New Tab";
        const newName = prompt(`Enter name for the new terminal tab:`, defaultPromptName);

        // 2. Validate the input
        if (!newName || !newName.trim()) {
            showIoMessage("Tab creation cancelled or name empty.", "info");
            return; // Abort if user cancelled or entered nothing
        }
        const sanitizedName = escapeHtml(newName.trim());

        // 3. Proceed with backend terminal creation only if name is valid
        addTerminalTabBtn.disabled = true; addTerminalTabBtn.textContent = '...'; // Provide feedback

        try {
            const response = await fetch('/api/terminals/new', { method: 'POST' });
            const result = await response.json();

            if (response.ok && result.success) {
                const { port: newPort, url: newUrl } = result;
                const newTerminalId = `term-${newPort}`;

                // 4. Create tab button using the SANITIZED NAME from the prompt
                const newTabButton = document.createElement('button');
                newTabButton.className = 'terminal-tab';
                newTabButton.dataset.terminalId = newTerminalId;
                newTabButton.title = `Terminal: ${sanitizedName} (Port ${newPort}). Double-click rename.`; // Use sanitized name
                const textSpan = document.createElement('span'); textSpan.className = 'tab-text'; textSpan.textContent = sanitizedName; // Use sanitized name
                const closeSpan = document.createElement('span'); closeSpan.className = 'close-tab-btn'; closeSpan.innerHTML = '&times;'; closeSpan.title = 'Close Tab';
                newTabButton.appendChild(textSpan); newTabButton.appendChild(closeSpan);
                terminalTabsContainer?.insertBefore(newTabButton, addTerminalTabBtn);

                // 5. Create iframe using the SANITIZED NAME
                const newIframe = document.createElement('iframe');
                newIframe.id = newTerminalId; newIframe.className = 'terminal-iframe'; newIframe.src = newUrl;
                newIframe.title = `${sanitizedName} ttyd terminal`; // Use sanitized name
                terminalIframesContainer?.appendChild(newIframe);

                // Initialize non-note state
                ensureTerminalState(newTerminalId);
                // Switch to the new tab (this will also load its notes from API)
                switchActiveTerminalTab(newTabButton, newTerminalId);
                showIoMessage(`Terminal "${sanitizedName}" created on port ${newPort}.`, 'success');

            } else {
                showIoMessage(`Create terminal err: ${result.error || 'Unknown'}`, 'error');
            }
        } catch (error) {
             showIoMessage(`Net err creating term: ${error.message}`, 'error');
        } finally {
             addTerminalTabBtn.disabled = false; addTerminalTabBtn.textContent = '+'; // Restore button
        }
     }

    // Modified switchActiveTerminalTab to fetch notes instead of using state
    async function switchActiveTerminalTab(tabElement, terminalId) { // Now async
        if (!document.body.contains(tabElement) || !terminalId || activeTerminalId === terminalId) {
            return;
        }
        // console.log(`Switching active tab from ${activeTerminalId} to ${terminalId}`);

        // Update UI (Tabs & Iframes)
        terminalTabsContainer?.querySelectorAll('.terminal-tab').forEach(tab => tab.classList.remove('active'));
        terminalIframesContainer?.querySelectorAll('.terminal-iframe').forEach(iframe => iframe.classList.remove('active'));
        tabElement.classList.add('active');
        const iframeToShow = terminalIframesContainer?.querySelector(`#${terminalId}`);
        if (iframeToShow) {
            iframeToShow.classList.add('active');
            setTimeout(() => { try { iframeToShow.contentWindow?.focus(); } catch (e) { /* ignore */ } }, 100);
        } else {
            console.error(`Iframe missing for terminal ID: ${terminalId}`);
            showIoMessage(`Error: Cannot find content for ${terminalId}`, 'error');
            const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTabEl && terminalId !== 'term-main') { switchActiveTerminalTab(mainTabEl, 'term-main'); return; }
        }

        // Update internal active ID *before* fetching notes
        activeTerminalId = terminalId;
        ensureTerminalState(activeTerminalId); // Ensure non-note state exists

        // LOAD new tab's notes via API
        await loadTabNotes(activeTerminalId); // Use await for the async fetch function

        // Update the label in the tab notes panel header
        if (tabNotesPanelLabel) {
            const tabTextElement = tabElement?.querySelector('.tab-text');
            tabNotesPanelLabel.textContent = tabTextElement ? tabTextElement.textContent : terminalId;
        }

        // Update other UI
        updateVariableInputsUI(activeTerminalId);
        displayPlaybooks(activeTerminalId);
    }

     function renameTerminalTab(tabElement) {
         const textSpan = tabElement.querySelector('.tab-text');
         if (!textSpan) return;
         const currentName = textSpan.textContent;
         const terminalId = tabElement.dataset.terminalId;
         const iframe = terminalIframesContainer?.querySelector(`#${terminalId}`);
         const newName = prompt(`Enter new name for terminal "${currentName}":`, currentName);

         if (newName && newName.trim() && newName.trim() !== currentName) {
             const sanitizedName = escapeHtml(newName.trim());
             textSpan.textContent = sanitizedName;
             let portInfo = tabElement.title.match(/\(Port \d+\)/)?.[0] || '';
             tabElement.title = `Terminal: ${sanitizedName} ${portInfo}. Double-click rename.`;
             if (iframe) iframe.title = `${sanitizedName} ttyd terminal`;
             // Update notes panel label if it matches the active tab being renamed
             if (terminalId === activeTerminalId && tabNotesPanelLabel) {
                  tabNotesPanelLabel.textContent = sanitizedName;
             }
             showIoMessage(`Renamed tab to "${sanitizedName}"`, 'info', 3000);
         } else if (newName !== null && !newName.trim()) {
             showIoMessage("Tab name cannot be empty.", 'warning');
         }
      }

     async function handleDeleteTerminalTab(closeButton) {
        const tabToDelete = closeButton.closest('.terminal-tab'); if (!tabToDelete) return;
        const terminalId = tabToDelete.dataset.terminalId; const portMatch = terminalId?.match(/^term-(\d+)$/);
        // Do not delete main terminal
        if (terminalId === 'term-main') {
            showIoMessage("Main terminal cannot be closed.", "warning");
            return;
         }
        if (!portMatch || !portMatch[1]) {
            console.error(`Invalid terminal ID format for deletion: ${terminalId}`);
            return;
        }

        const port = parseInt(portMatch[1], 10);
        const tabName = tabToDelete.querySelector('.tab-text')?.textContent || `port ${port}`;

        if (!confirm(`Close terminal "${tabName}"? Corresponding notes file will also be removed.`)) { return; }

        console.log(`Deleting tab: ${terminalId} (Port: ${port})`);
        tabToDelete.style.opacity = '0.5'; tabToDelete.style.pointerEvents = 'none';

        try {
            // Call backend to delete terminal process and notes file
            const response = await fetch(`/api/terminals/${port}`, { method: 'DELETE' });
            const result = (response.ok && response.status !== 204)
                 ? await response.json().catch(() => ({ success: true, message: `Closed port ${port}.` }))
                 : (response.ok ? { success: true, message: `Closed port ${port}.` } : await response.json());

            if (result.success) {
                showIoMessage(result.message || `Term "${tabName}" closed.`, 'success', 3000);
                // Clean up DOM
                terminalIframesContainer?.querySelector(`#${terminalId}`)?.remove();
                tabToDelete.remove();
                // Clean up non-note JS state
                delete terminalVariablesState[terminalId];
                console.log(`Removed state for closed tab: ${terminalId}`);

                // Switch to another tab if the active one was closed
                if (activeTerminalId === terminalId) {
                    const allTabs = Array.from(terminalTabsContainer?.querySelectorAll('.terminal-tab:not(#add-terminal-tab-btn)') || []);
                    const nextActiveTabElement = allTabs[0] || null; // Default to the first remaining tab

                    if (nextActiveTabElement && nextActiveTabElement.dataset.terminalId) {
                        switchActiveTerminalTab(nextActiveTabElement, nextActiveTabElement.dataset.terminalId);
                    } else {
                        console.warn("No tabs left to switch to after delete.");
                        activeTerminalId = null; // Mark no active tab
                        // Clear notes area and label if no tabs left
                         if (tabNotesArea) tabNotesArea.value = '';
                         if (tabNotesPanelLabel) tabNotesPanelLabel.textContent = 'None';
                    }
                }
            } else {
                showIoMessage(`Err closing "${tabName}": ${result.error || 'Unknown'}`, 'error');
                tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; // Restore on error
            }
        } catch (error) {
            console.error("Net err delete term:", error);
            showIoMessage(`Net err closing "${tabName}": ${error.message}`, 'error');
            tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; // Restore on error
        }
     }

    // --- Notes Handling (Using API) ---

    // Function to load notes for a specific tab from backend
    async function loadTabNotes(terminalId) {
        if (!tabNotesArea || !terminalId) return;
         // console.log(`Workspaceing notes for ${terminalId}...`); // Keep for debug
         try {
             const response = await fetch(`/api/notes/tab/${encodeURIComponent(terminalId)}`);
             if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
             const data = await response.json();
             if (data.success) {
                 tabNotesArea.value = data.notes || "";
                 // console.log(`Loaded notes for ${terminalId}`); // Keep for debug
             } else {
                 console.error("Error fetching tab notes:", data.error);
                 showIoMessage(`Failed load notes: ${data.error}`, 'error');
                 tabNotesArea.value = ""; // Clear on error
             }
         } catch (error) {
             console.error("Network/fetch error loading tab notes:", error);
             showIoMessage(`Error loading notes: ${error.message}`, 'error');
             tabNotesArea.value = ""; // Clear on error
         }
    }

    // Function to load initial global and first tab notes
    async function loadInitialNotes() {
        // Load Global Notes via API
        if (globalNotesArea) {
             // console.log("Fetching global notes..."); // Keep for debug
            try {
                const response = await fetch('/api/notes/global');
                 if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                const data = await response.json();
                if (data.success) {
                    globalNotesArea.value = data.notes || "";
                    // console.log("Loaded global notes from API."); // Keep for debug
                } else { console.error("Error fetching global notes:", data.error); showIoMessage(`Failed load global notes: ${data.error}`, 'error'); }
            } catch (error) { console.error("Net error loading global notes:", error); showIoMessage(`Error loading global notes: ${error.message}`, 'error'); }
        }
        // Load Notes for the initially active tab
        await loadTabNotes(activeTerminalId);
        // Update initial tab notes label
         if (tabNotesPanelLabel) {
            const activeTabElement = terminalTabsContainer?.querySelector('.terminal-tab.active');
            const tabTextElement = activeTabElement?.querySelector('.tab-text');
            tabNotesPanelLabel.textContent = tabTextElement ? tabTextElement.textContent : activeTerminalId;
        }
    }

    // Debounced save function for global notes using API
    function handleGlobalNotesInput() {
        if (globalNotesSaveTimeout) clearTimeout(globalNotesSaveTimeout);
        globalNotesSaveTimeout = setTimeout(async () => {
            if (globalNotesArea) {
                // console.log("Saving global notes via API..."); // Keep for debug
                try {
                    const response = await fetch('/api/notes/global', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ notes: globalNotesArea.value })
                    });
                     if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                    const data = await response.json();
                    if (!data.success) { console.error("Error saving global notes:", data.error); showIoMessage(`Save error: ${data.error}`, 'error'); }
                    // else { console.log("Global notes saved."); } // Optional
                } catch (error) { console.error("Net error saving global notes:", error); showIoMessage(`Save error: ${error.message}`, 'error'); }
            }
        }, 750); // Debounce delay 750ms
    }

    // Debounced save function for tab notes using API
    function handleTabNotesInput() {
        if (tabNotesSaveTimeout) clearTimeout(tabNotesSaveTimeout);
        tabNotesSaveTimeout = setTimeout(async () => {
            if (tabNotesArea && activeTerminalId) {
                 // console.log(`Saving tab notes for ${activeTerminalId} via API...`); // Keep for debug
                 try {
                     const response = await fetch(`/api/notes/tab/${encodeURIComponent(activeTerminalId)}`, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ notes: tabNotesArea.value })
                     });
                     if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                     const data = await response.json();
                      if (!data.success) { console.error("Error saving tab notes:", data.error); showIoMessage(`Save error: ${data.error}`, 'error'); }
                      // else { console.log(`Tab notes saved for ${activeTerminalId}.`); } // Optional
                 } catch (error) { console.error("Net error saving tab notes:", error); showIoMessage(`Save error: ${error.message}`, 'error'); }
            }
        }, 750); // Debounce delay 750ms
    }

    // Toggle panel visibility (unchanged)
    function togglePanel(panelElement) {
        if (!panelElement) return;
        panelElement.classList.toggle('visible');
        if (panelElement.classList.contains('visible')) {
            const textarea = panelElement.querySelector('textarea');
            textarea?.focus();
        }
    }


    // --- Setup Event Listeners ---
    function setupEventListeners() {
        console.log("Setting up App listeners...");

        // Search, Variables, Upload, Terminals
        searchInput?.addEventListener('input', handleSearchInputChange);
        const variableSection = document.getElementById('variable-input-section');
        variableSection?.addEventListener('input', (event) => {
            if (event.target.matches('.variable-item input[type="text"]')) { handleVariableInputChange(event); }
        });
        playbookUploadInput?.addEventListener('change', handlePlaybookUpload);
        terminalTabsContainer?.addEventListener('click', handleTerminalTabClick);
        terminalTabsContainer?.addEventListener('dblclick', handleTerminalTabDoubleClick);
        addTerminalTabBtn?.addEventListener('click', handleAddTerminalTab);

        // Notes Listeners (Use debounced API calls)
        globalNotesArea?.addEventListener('input', handleGlobalNotesInput);
        tabNotesArea?.addEventListener('input', handleTabNotesInput);
        tabNotesToggleBtn?.addEventListener('click', () => togglePanel(tabNotesPanel));
        globalNotesToggleBtn?.addEventListener('click', () => togglePanel(globalNotesPanel));
        closePanelButtons.forEach(button => {
            button.addEventListener('click', () => {
                const panelId = button.dataset.panel;
                const panelToClose = document.getElementById(panelId);
                panelToClose?.classList.remove('visible');
            });
        });

        console.log("App Listeners setup OK.");
    }

    // --- Start ---
    initializeApp();

}); // End DOMContentLoaded
