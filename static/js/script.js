/**
 * Filename: static/js/script.js - Modified for Playbook, Floating Notes, Upload, Local Search & Import, and Code Block Editing
 * Description: Frontend JavaScript logic for the Command Wave application.
 * Handles:
 * - Reading Playbook file uploads from user's computer.
 * - Searching local playbook files via backend API (with line context).
 * - Importing selected playbooks from local search results.
 * - Loading selected Playbook content for the active terminal tab.
 * - Rendering multiple Playbook contents in collapsible containers with remove buttons.
 * - Real-time code block preview with variable substitution (tab-specific).
 * - Double-click to edit code blocks temporarily (changes not saved to original file).
 * - Copying/Executing code from Playbook code blocks (uses edited content if available).
 * - Managing terminal tabs (switching, adding with prompt, renaming, deleting).
 * - Managing tab-specific variable state and loaded playbooks state (including temporary edits).
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
    // Playbook content block now has original 'content' and potentially 'editedContent'
    let terminalVariablesState = {}; // { terminalId: { variables: {...}, loadedPlaybooks: { 'filename.md': { content: [{type, content, language?, editedContent?}, ...], isExpanded: true } } } }
    let activeTerminalId = 'term-main';
    let initialTerminalPort = 7681; // Default, might be overwritten by HTML data attribute
    // Debounce timer IDs
    let globalNotesSaveTimeout = null;
    let tabNotesSaveTimeout = null;
    let searchDebounceTimeout = null; // For search debounce

    // --- DOM Element References ---
    const searchInput = document.getElementById('searchInput');
    const searchResultsContainer = document.getElementById('search-results-container');
    const searchResultsList = document.getElementById('search-results-list');
    const ioMessageDiv = document.getElementById('io-message');
    const playbookSection = document.getElementById('playbook-section');
    const playbookContentDiv = document.getElementById('playbook-content');
    const playbookUploadInput = document.getElementById('playbook-upload-input');
    const variableInputElements = {};
    Object.keys(VARIABLE_MAP).forEach(id => {
        variableInputElements[id] = document.getElementById(id);
        if (!variableInputElements[id]) { console.warn(`Var input "${id}" not found.`); }
    });
    const terminalTabsContainer = document.querySelector('.terminal-tabs');
    const terminalIframesContainer = document.querySelector('.terminal-iframes');
    const addTerminalTabBtn = document.getElementById('add-terminal-tab-btn');
    const mainTerminalTab = document.querySelector('.terminal-tab[data-terminal-id="term-main"]');
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
         }
     }

    async function initializeApp() {
        console.log("Initializing App...");
        try {
            const mainTermElem = document.getElementById('term-main');
            const portFromData = mainTermElem?.dataset.initialPort;
             if (portFromData && !isNaN(parseInt(portFromData, 10))) {
                initialTerminalPort = parseInt(portFromData, 10);
             }
             const mainTerminalTab = document.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTerminalTab) {
                mainTerminalTab.title = `Main Terminal (Port ${initialTerminalPort}). Double-click rename.`;
             }

            activeTerminalId = 'term-main';
            ensureTerminalState(activeTerminalId);
            updateVariableInputsUI(activeTerminalId);

            await loadInitialNotes();

            setupEventListeners();
            console.log("App Init OK.");
        } catch (error) {
            console.error("App Init failed:", error);
            if(playbookContentDiv) playbookContentDiv.innerHTML = `<p class="error">App init failed: ${escapeHtml(error.message)}</p>`;
            showIoMessage(`Init failed: ${error.message}`, 'error', 15000);
        }
    }

    // --- Variable Substitution ---
    function performVariableSubstitution(originalCommand, variables) {
        let substitutedCommandHtml = escapeHtml(originalCommand);
        for (const inputId in VARIABLE_MAP) {
            const { stateKey, placeholder } = VARIABLE_MAP[inputId];
            const value = variables && variables[stateKey] ? variables[stateKey].trim() : '';
            if (value) {
                // Escape regex special characters in the placeholder
                const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedPlaceholder, 'g');
                // Only substitute if placeholder exists in the command
                if (regex.test(substitutedCommandHtml)) {
                    const replacementHtml = `<span class="substituted-var">${escapeHtml(value)}</span>`;
                    substitutedCommandHtml = substitutedCommandHtml.replace(regex, replacementHtml);
                }
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
                // Only substitute if placeholder exists in the command
                if (regex.test(text)) {
                     text = text.replace(regex, value);
                }
            }
        }
        return text;
    }


    // --- Playbook Handling ---
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
                        // Store original content, type, language
                        parsedContent.push({ type: 'code', language: token.lang || 'plaintext', content: token.text });
                    } else if (token.type === 'space') {
                         currentTextBlock += token.raw;
                    } else {
                        currentTextBlock += token.raw + '\n';
                    }
                });
                addTextBlock();

                ensureTerminalState(activeTerminalId);
                if (terminalVariablesState[activeTerminalId]?.loadedPlaybooks[filename]) {
                     if (!confirm(`Playbook "${filename}" is already loaded. Replace it?`)) {
                         event.target.value = ''; return;
                     }
                }
                // Store the array of parsed blocks in state
                terminalVariablesState[activeTerminalId].loadedPlaybooks[filename] = { parsedBlocks: parsedContent, isExpanded: true };
                console.log(`Parsed and added playbook "${filename}" to state for ${activeTerminalId}`);
                displayPlaybooks(activeTerminalId);
                showIoMessage(`Playbook "${filename}" loaded and parsed.`, 'success');

            } catch (parseError) {
                 console.error("Error parsing uploaded playbook:", parseError);
                 showIoMessage(`Failed to parse ${filename}: ${parseError.message}`, 'error');
            }
            event.target.value = '';
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
        ensureTerminalState(terminalId);
        playbookContentDiv.innerHTML = '';
        const playbooksMap = terminalVariablesState[terminalId]?.loadedPlaybooks || {};
        const currentVariables = terminalVariablesState[terminalId]?.variables || DEFAULT_VARIABLES;

        if (Object.keys(playbooksMap).length === 0) {
            playbookContentDiv.innerHTML = '<p>No playbooks loaded. Upload one using the button above or search and import local playbooks.</p>';
            return;
        }
        Object.entries(playbooksMap).forEach(([filename, playbookData]) => {
            try {
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
                    playbookData.isExpanded = !playbookData.isExpanded;
                    wrapper.classList.toggle('collapsed');
                });

                const body = document.createElement('div'); body.className = 'playbook-body';
                // Use parsedBlocks from state
                const blocks = playbookData.parsedBlocks || [];
                if (blocks.length === 0) { body.innerHTML = '<p><i>Playbook content is empty or failed to parse.</i></p>'; }
                else {
                    // Pass filename and block index to renderPlaybookBlock for state management
                    blocks.forEach((block, index) => renderPlaybookBlock(filename, block, index, body, currentVariables));
                 }

                wrapper.appendChild(header); wrapper.appendChild(body); playbookContentDiv.appendChild(wrapper);
            } catch (renderError) { console.error("Error rendering playbook container:", filename, renderError); }
        });

        if (window.Prism) Prism.highlightAllUnder(playbookContentDiv);
        else console.warn("Prism.js not detected.");
    }

    // *** MODIFIED: renderPlaybookBlock ***
    // Now takes filename and blockIndex to identify the block in the state
    function renderPlaybookBlock(filename, block, blockIndex, parentElement, variables) {
        try {
            if (block.type === 'text') {
                const textDiv = document.createElement('div'); textDiv.className = 'playbook-text-block';
                textDiv.innerHTML = block.content || ''; // Assumes pre-rendered HTML
                parentElement.appendChild(textDiv);
            } else if (block.type === 'code') {
                // --- Main container for code block ---
                const codeContainer = document.createElement('div');
                codeContainer.className = 'playbook-code-block';
                // Store identifying information for editing
                codeContainer.dataset.filename = filename;
                codeContainer.dataset.blockIndex = blockIndex;

                // --- <pre> and <code> elements for display ---
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                const langClass = `language-${escapeHtml(block.language || 'plaintext').toLowerCase().split(/[^a-z0-9]/)[0] || 'plaintext'}`;
                pre.className = langClass; code.className = langClass;

                // --- Determine content: Use edited content if available, otherwise original ---
                const originalContent = block.content || '';
                const currentContent = (typeof block.editedContent === 'string') ? block.editedContent : originalContent;

                // --- Apply variable substitution for display ---
                const substitutedHtml = performVariableSubstitution(currentContent, variables);
                code.innerHTML = substitutedHtml; // Display substituted version
                pre.appendChild(code);
                codeContainer.appendChild(pre); // Add <pre> to container

                // --- Content for Copy/Execute (apply substitution to current content) ---
                const substitutedText = getSubstitutedPlainText(currentContent, variables);

                // --- Buttons (Copy/Execute) ---
                const buttonContainer = document.createElement('div'); buttonContainer.className = 'code-block-buttons';
                const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'copy-btn'; copyBtn.title = 'Copy Code'; copyBtn.textContent = 'Copy'; copyBtn.dataset.commandSubstituted = substitutedText;
                copyBtn.addEventListener('click', () => handleCopyCommand(copyBtn));
                const executeBtn = document.createElement('button'); executeBtn.type = 'button'; executeBtn.className = 'execute-btn'; executeBtn.title = 'Execute Code'; executeBtn.textContent = 'Execute'; executeBtn.dataset.commandSubstituted = substitutedText;
                executeBtn.addEventListener('click', () => handleExecuteCommand(executeBtn));
                buttonContainer.appendChild(copyBtn); buttonContainer.appendChild(executeBtn); codeContainer.appendChild(buttonContainer);

                 // --- Add Double-Click Listener to <pre> for Editing ---
                 pre.addEventListener('dblclick', (event) => {
                    // Prevent double-click from triggering header collapse if nested
                    event.stopPropagation();
                    enableCodeBlockEditing(codeContainer, filename, blockIndex);
                 });

                parentElement.appendChild(codeContainer); // Add container to the DOM
            }
        } catch (error) { console.error("Error rendering playbook block:", error, "Block:", block); }
    }

    // *** NEW: Function to enable editing on a code block ***
    function enableCodeBlockEditing(codeContainer, filename, blockIndex) {
        const preElement = codeContainer.querySelector('pre');
        if (!preElement || codeContainer.querySelector('textarea.editing')) return; // Already editing or no <pre>

        // Find the block data in the state
        const blockData = terminalVariablesState[activeTerminalId]?.loadedPlaybooks[filename]?.parsedBlocks[blockIndex];
        if (!blockData) {
            console.error("Could not find block data in state for editing.");
            showIoMessage("Error: Cannot initiate edit.", "error");
            return;
        }

        // Get current raw content (edited or original)
        const contentToEdit = (typeof blockData.editedContent === 'string') ? blockData.editedContent : blockData.content;

        // --- Calculate height BEFORE hiding the <pre> element ---
        const preRect = preElement.getBoundingClientRect();
        const requiredHeight = preRect.height;

        // Hide the <pre> element
        preElement.style.display = 'none';
        codeContainer.classList.add('editing-active'); // Add class for styling

        // Create and configure the textarea
        const editorTextarea = document.createElement('textarea');
        editorTextarea.className = 'code-block-editor editing'; // Add class for styling/selection
        editorTextarea.value = contentToEdit;

        // --- Set the height based on the calculated dimension ---
        // Using preRect.height might be more accurate for visual size
        // Add a small buffer (e.g., 2px) just in case.
        if (requiredHeight > 0) { // Only set if height is valid
             editorTextarea.style.height = (requiredHeight + 15) + 'px';
        }

        // Other styles (should match CSS or be defined there)
        editorTextarea.style.width = '100%';
        editorTextarea.style.fontFamily = 'var(--font-code)';
        editorTextarea.style.fontSize = '1.1em';
        editorTextarea.style.lineHeight = '1.4';
        editorTextarea.spellcheck = false;


        // --- Event Listeners for Textarea ---
        const handleEditFinish = (saveChanges) => {
            const editedValue = editorTextarea.value;
            // Clean up: remove textarea, show pre, remove editing class
            editorTextarea.remove();
            preElement.style.display = '';
            codeContainer.classList.remove('editing-active');

            if (saveChanges) {
                // Only update state if content actually changed
                 if (editedValue !== contentToEdit) {
                    console.log(`Saving temporary edit for ${filename}, block ${blockIndex}`);
                    blockData.editedContent = editedValue; // Save to state
                     // Re-render the entire playbook section to reflect changes and update buttons
                     displayPlaybooks(activeTerminalId);
                     showIoMessage("Temporary edit saved.", "info", 2000);
                 } else {
                      console.log("Edit finished, no changes made.");
                 }
            } else {
                console.log("Edit cancelled.");
                 // No state change needed, just revert UI which is done by cleanup
                 // Optionally re-render to ensure display is correct if needed
                 // displayPlaybooks(activeTerminalId); // Might be overkill
            }
        };

        // On losing focus (blur), save changes
        editorTextarea.addEventListener('blur', () => handleEditFinish(true));

        // On keydown
        editorTextarea.addEventListener('keydown', (e) => {
            // Escape key: Cancel changes
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation(); // Prevent other listeners
                handleEditFinish(false);
            }
            // Ctrl+Enter or Cmd+Enter: Save changes
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                 e.preventDefault();
                 e.stopPropagation();
                 handleEditFinish(true);
            }
            // Allow Tab key for indentation
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editorTextarea.selectionStart;
                const end = editorTextarea.selectionEnd;
                // Insert tab character at cursor position
                editorTextarea.value = editorTextarea.value.substring(0, start) + "\t" + editorTextarea.value.substring(end);
                // Move cursor
                editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 1;
            }
        });

        // Insert textarea before the button container, focus it
        const buttonContainer = codeContainer.querySelector('.code-block-buttons');
        if (buttonContainer) {
            codeContainer.insertBefore(editorTextarea, buttonContainer);
        } else {
            codeContainer.appendChild(editorTextarea); // Fallback
        }
        editorTextarea.focus();
        editorTextarea.select(); // Select text for easy replacement
    }
    // *** END NEW Editing Function ***


    // --- Event Handlers ---
    function handleVariableInputChange(event) {
        const inputId = event.target.id;
        if (VARIABLE_MAP[inputId]) {
            const stateKey = VARIABLE_MAP[inputId].stateKey;
            const value = event.target.value;
            ensureTerminalState(activeTerminalId);
            if (!terminalVariablesState[activeTerminalId].variables) {
                 terminalVariablesState[activeTerminalId].variables = { ...DEFAULT_VARIABLES };
            }
            terminalVariablesState[activeTerminalId].variables[stateKey] = value;
            // Re-render playbooks to reflect new variable values (will use edited content if exists)
            displayPlaybooks(activeTerminalId);
        }
    }

    function handleSearchInputChange(event) {
        const searchTerm = event.target.value.trim();
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        if (!searchTerm || searchTerm.length < 2) {
            if(searchResultsContainer) searchResultsContainer.style.display = 'none';
            if(searchResultsList) searchResultsList.innerHTML = '';
             if (searchTerm && searchResultsList) {
                 searchResultsList.innerHTML = '<li><i>Please enter at least 2 characters to search.</i></li>';
                 if(searchResultsContainer) searchResultsContainer.style.display = 'block';
             }
            return;
        }
        searchDebounceTimeout = setTimeout(async () => {
            console.log(`Searching local playbooks for: ${searchTerm}`);
            if (searchResultsList) searchResultsList.innerHTML = '<li><i>Searching...</i></li>';
            if (searchResultsContainer) searchResultsContainer.style.display = 'block';
            try {
                const response = await fetch(`/api/playbooks/search?query=${encodeURIComponent(searchTerm)}`);
                if (!response.ok) {
                     let errorMsg = `HTTP error! status: ${response.status}`;
                     try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch (jsonError) { /* Ignore */ }
                     throw new Error(errorMsg);
                }
                const results = await response.json();
                if (results.success && searchResultsList) {
                    displaySearchResults(results.matches || []);
                } else if (!results.success) {
                    console.error("Search API Error:", results.error);
                    if(searchResultsList) searchResultsList.innerHTML = `<li><i>Error: ${escapeHtml(results.error || 'Unknown search error')}</i></li>`;
                }
            } catch (error) {
                console.error("Fetch error during search:", error);
                if(searchResultsList) searchResultsList.innerHTML = `<li><i>Error fetching search results: ${escapeHtml(error.message)}</i></li>`;
            }
        }, 300);
    }

    function displaySearchResults(matches) {
        if (!searchResultsList || !searchResultsContainer) return;
        searchResultsList.innerHTML = '';
        if (matches.length === 0) {
            searchResultsList.innerHTML = '<li><i>No matching lines found in local playbooks.</i></li>';
        } else {
            const searchTermRegex = new RegExp(`(${escapeHtml(searchInput.value.trim())})`, 'gi');
            matches.forEach(match => {
                const li = document.createElement('li'); li.classList.add('search-result-item');
                const infoDiv = document.createElement('div'); infoDiv.className = 'search-result-info';
                const fileSpan = document.createElement('span'); fileSpan.className = 'search-result-filename'; fileSpan.textContent = match.filename;
                const lineNumSpan = document.createElement('span'); lineNumSpan.className = 'search-result-linenum'; lineNumSpan.textContent = ` (Line: ${match.line_number})`;
                const lineContentSpan = document.createElement('code'); lineContentSpan.className = 'search-result-linecontent';
                const highlightedContent = escapeHtml(match.line_content).replace(searchTermRegex, '<mark>$1</mark>');
                lineContentSpan.innerHTML = highlightedContent;
                infoDiv.appendChild(fileSpan); infoDiv.appendChild(lineNumSpan); infoDiv.appendChild(lineContentSpan);
                const importBtn = document.createElement('button'); importBtn.textContent = 'Import'; importBtn.className = 'import-playbook-btn'; importBtn.dataset.filename = match.filename; importBtn.title = `Import ${match.filename} into current tab`;
                importBtn.addEventListener('click', handleImportPlaybookClick);
                li.appendChild(infoDiv); li.appendChild(importBtn); searchResultsList.appendChild(li);
            });
        }
        searchResultsContainer.style.display = 'block';
    }

    async function handleImportPlaybookClick(event) {
        const button = event.currentTarget;
        const filenameToImport = button.dataset.filename;
        if (!filenameToImport) { showIoMessage("Error: Filename missing.", "error"); return; }
        button.disabled = true; button.textContent = 'Importing...';
        console.log(`Attempting to import playbook: ${filenameToImport} into tab ${activeTerminalId}`);
        try {
            const response = await fetch(`/api/playbooks/load/${encodeURIComponent(filenameToImport)}`);
            if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })); throw new Error(errorData.error || `Failed to load playbook (${response.status})`); }
            const data = await response.json();
            if (data.success && data.content) {
                 if (typeof marked === 'undefined') throw new Error("Markdown library (marked.js) not loaded.");
                 const tokens = marked.lexer(data.content);
                 const parsedContent = [];
                 let currentTextBlock = '';
                 const addTextBlock = () => { if (currentTextBlock.trim()) { parsedContent.push({ type: 'text', content: marked.parse(currentTextBlock.trim()) }); } currentTextBlock = ''; };
                 tokens.forEach(token => {
                     if (token.type === 'code') { addTextBlock(); parsedContent.push({ type: 'code', language: token.lang || 'plaintext', content: token.text }); }
                     else if (token.type === 'space') { currentTextBlock += token.raw; }
                     else { currentTextBlock += token.raw + '\n'; }
                 });
                 addTextBlock();

                 ensureTerminalState(activeTerminalId);
                 if (terminalVariablesState[activeTerminalId]?.loadedPlaybooks[data.filename]) {
                      if (!confirm(`Playbook "${data.filename}" is already loaded. Replace it?`)) { button.disabled = false; button.textContent = 'Import'; return; }
                 }
                // Store parsed blocks array
                terminalVariablesState[activeTerminalId].loadedPlaybooks[data.filename] = { parsedBlocks: parsedContent, isExpanded: true };
                console.log(`Parsed and added playbook "${data.filename}" from local search to state for ${activeTerminalId}`);
                displayPlaybooks(activeTerminalId);
                showIoMessage(`Playbook "${data.filename}" imported successfully.`, 'success');
            } else { throw new Error(data.error || "Failed to get playbook content."); }
        } catch (error) { console.error("Error importing playbook:", error); showIoMessage(`Import failed for ${filenameToImport}: ${error.message}`, 'error');
        } finally { if (button.disabled) { button.disabled = false; button.textContent = 'Import'; } }
    }

    function handleRemovePlaybookClick(event) {
        event.stopPropagation();
        const button = event.currentTarget;
        const filenameToRemove = button.dataset.filename;
        if (!filenameToRemove) return;
        if (confirm(`Remove playbook "${filenameToRemove}" from this tab?`)) {
            ensureTerminalState(activeTerminalId);
            if (terminalVariablesState[activeTerminalId]?.loadedPlaybooks[filenameToRemove]) {
                delete terminalVariablesState[activeTerminalId].loadedPlaybooks[filenameToRemove];
                displayPlaybooks(activeTerminalId);
                showIoMessage(`Playbook "${filenameToRemove}" removed.`, 'info');
            }
        }
    }

    // --- Playbook Code Block Action Handlers (Copy/Execute - Use data attribute which is updated on render) ---
     async function handleCopyCommand(button) {
         // commandSubstituted data attribute is updated whenever the block is rendered (including after edits)
         const commandToCopy = button.dataset.commandSubstituted;
         if (typeof commandToCopy !== 'string' || !navigator.clipboard) {
             showIoMessage("Clipboard copy failed.", "error");
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
        // commandSubstituted data attribute is updated whenever the block is rendered (including after edits)
         const commandToSend = button.dataset.commandSubstituted?.trim();
         if (!commandToSend) { showIoMessage("Empty command.", "warning"); return; }

         const activeTabElement = terminalTabsContainer?.querySelector('.terminal-tab.active');
         const currentTerminalId = activeTabElement?.dataset.terminalId;
         if (!currentTerminalId) { showIoMessage("No active terminal.", "error"); return; }

         let targetPort;
         if (currentTerminalId === 'term-main') { targetPort = initialTerminalPort; }
         else { const portMatch = currentTerminalId.match(/^term-(\d+)$/); targetPort = (portMatch && portMatch[1]) ? parseInt(portMatch[1], 10) : NaN; }
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
                 console.error("Execute fail:", result); showIoMessage(`Execute Error: ${result.error || response.statusText}`, 'error');
                 button.textContent = 'Error!'; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
             }
         } catch (error) {
             console.error("Net error exec:", error); showIoMessage(`Net Error: ${error.message}`, 'error');
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

     async function handleAddTerminalTab() {
        if (!addTerminalTabBtn) return;
        const defaultPromptName = "New Tab";
        const newName = prompt(`Enter name for the new terminal tab:`, defaultPromptName);
        if (!newName || !newName.trim()) { showIoMessage("Tab creation cancelled or name empty.", "info"); return; }
        const sanitizedName = escapeHtml(newName.trim());
        addTerminalTabBtn.disabled = true; addTerminalTabBtn.textContent = '...';
        try {
            const response = await fetch('/api/terminals/new', { method: 'POST' });
            const result = await response.json();
            if (response.ok && result.success) {
                const { port: newPort, url: newUrl } = result; const newTerminalId = `term-${newPort}`;
                const newTabButton = document.createElement('button'); newTabButton.className = 'terminal-tab'; newTabButton.dataset.terminalId = newTerminalId; newTabButton.title = `Terminal: ${sanitizedName} (Port ${newPort}). Double-click rename.`;
                const textSpan = document.createElement('span'); textSpan.className = 'tab-text'; textSpan.textContent = sanitizedName;
                const closeSpan = document.createElement('span'); closeSpan.className = 'close-tab-btn'; closeSpan.innerHTML = '&times;'; closeSpan.title = 'Close Tab';
                newTabButton.appendChild(textSpan); newTabButton.appendChild(closeSpan);
                terminalTabsContainer?.insertBefore(newTabButton, addTerminalTabBtn);
                const newIframe = document.createElement('iframe'); newIframe.id = newTerminalId; newIframe.className = 'terminal-iframe'; newIframe.src = newUrl; newIframe.title = `${sanitizedName} ttyd terminal`;
                terminalIframesContainer?.appendChild(newIframe);
                ensureTerminalState(newTerminalId);
                switchActiveTerminalTab(newTabButton, newTerminalId);
                showIoMessage(`Terminal "${sanitizedName}" created on port ${newPort}.`, 'success');
            } else { showIoMessage(`Create terminal err: ${result.error || 'Unknown'}`, 'error'); }
        } catch (error) { showIoMessage(`Net err creating term: ${error.message}`, 'error');
        } finally { addTerminalTabBtn.disabled = false; addTerminalTabBtn.textContent = '+'; }
     }

    async function switchActiveTerminalTab(tabElement, terminalId) {
        if (!document.body.contains(tabElement) || !terminalId || activeTerminalId === terminalId) return;
        terminalTabsContainer?.querySelectorAll('.terminal-tab').forEach(tab => tab.classList.remove('active'));
        terminalIframesContainer?.querySelectorAll('.terminal-iframe').forEach(iframe => iframe.classList.remove('active'));
        tabElement.classList.add('active');
        const iframeToShow = terminalIframesContainer?.querySelector(`#${terminalId}`);
        if (iframeToShow) {
            iframeToShow.classList.add('active');
            setTimeout(() => { try { iframeToShow.contentWindow?.focus(); } catch (e) { /* ignore */ } }, 100);
        } else {
            console.error(`Iframe missing for terminal ID: ${terminalId}`); showIoMessage(`Error: Cannot find content for ${terminalId}`, 'error');
            const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTabEl && terminalId !== 'term-main') { switchActiveTerminalTab(mainTabEl, 'term-main'); return; }
        }
        activeTerminalId = terminalId;
        ensureTerminalState(activeTerminalId); // Ensure non-note state exists first
        await loadTabNotes(activeTerminalId); // Load notes for the new tab
        if (tabNotesPanelLabel) { const tabTextElement = tabElement?.querySelector('.tab-text'); tabNotesPanelLabel.textContent = tabTextElement ? tabTextElement.textContent : terminalId; }
        updateVariableInputsUI(activeTerminalId); // Update var inputs based on new tab's state
        displayPlaybooks(activeTerminalId); // Render playbooks for the new tab
    }

     function renameTerminalTab(tabElement) {
         const textSpan = tabElement.querySelector('.tab-text'); if (!textSpan) return;
         const currentName = textSpan.textContent; const terminalId = tabElement.dataset.terminalId; const iframe = terminalIframesContainer?.querySelector(`#${terminalId}`);
         const newName = prompt(`Enter new name for terminal "${currentName}":`, currentName);
         if (newName && newName.trim() && newName.trim() !== currentName) {
             const sanitizedName = escapeHtml(newName.trim()); textSpan.textContent = sanitizedName; let portInfo = tabElement.title.match(/\(Port \d+\)/)?.[0] || ''; tabElement.title = `Terminal: ${sanitizedName} ${portInfo}. Double-click rename.`;
             if (iframe) iframe.title = `${sanitizedName} ttyd terminal`;
             if (terminalId === activeTerminalId && tabNotesPanelLabel) { tabNotesPanelLabel.textContent = sanitizedName; }
             showIoMessage(`Renamed tab to "${sanitizedName}"`, 'info', 3000);
         } else if (newName !== null && !newName.trim()) { showIoMessage("Tab name cannot be empty.", 'warning'); }
      }

     async function handleDeleteTerminalTab(closeButton) {
        const tabToDelete = closeButton.closest('.terminal-tab'); if (!tabToDelete) return;
        const terminalId = tabToDelete.dataset.terminalId; const portMatch = terminalId?.match(/^term-(\d+)$/);
        if (terminalId === 'term-main') { showIoMessage("Main terminal cannot be closed.", "warning"); return; }
        if (!portMatch || !portMatch[1]) { console.error(`Invalid terminal ID format: ${terminalId}`); return; }
        const port = parseInt(portMatch[1], 10); const tabName = tabToDelete.querySelector('.tab-text')?.textContent || `port ${port}`;
        if (!confirm(`Close terminal "${tabName}"? Corresponding notes file will also be removed.`)) { return; }
        console.log(`Deleting tab: ${terminalId} (Port: ${port})`); tabToDelete.style.opacity = '0.5'; tabToDelete.style.pointerEvents = 'none';
        try {
            const response = await fetch(`/api/terminals/${port}`, { method: 'DELETE' });
            const result = (response.ok && response.status !== 204) ? await response.json().catch(() => ({ success: true, message: `Closed port ${port}.` })) : (response.ok ? { success: true, message: `Closed port ${port}.` } : await response.json());
            if (result.success) {
                showIoMessage(result.message || `Term "${tabName}" closed.`, 'success', 3000);
                terminalIframesContainer?.querySelector(`#${terminalId}`)?.remove(); tabToDelete.remove();
                delete terminalVariablesState[terminalId]; // Clean up non-note JS state
                console.log(`Removed state for closed tab: ${terminalId}`);
                if (activeTerminalId === terminalId) {
                    const allTabs = Array.from(terminalTabsContainer?.querySelectorAll('.terminal-tab:not(#add-terminal-tab-btn)') || []);
                    const nextActiveTabElement = allTabs[0] || null;
                    if (nextActiveTabElement && nextActiveTabElement.dataset.terminalId) { switchActiveTerminalTab(nextActiveTabElement, nextActiveTabElement.dataset.terminalId); }
                    else { console.warn("No tabs left."); activeTerminalId = null; if (tabNotesArea) tabNotesArea.value = ''; if (tabNotesPanelLabel) tabNotesPanelLabel.textContent = 'None'; }
                }
            } else { showIoMessage(`Err closing "${tabName}": ${result.error || 'Unknown'}`, 'error'); tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; }
        } catch (error) { console.error("Net err delete term:", error); showIoMessage(`Net err closing "${tabName}": ${error.message}`, 'error'); tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; }
     }

    // --- Notes Handling (Using API) ---
    async function loadTabNotes(terminalId) {
        if (!tabNotesArea || !terminalId) return;
         try {
             const response = await fetch(`/api/notes/tab/${encodeURIComponent(terminalId)}`);
             if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
             const data = await response.json();
             if (data.success) { tabNotesArea.value = data.notes || ""; }
             else { console.error("Error fetching tab notes:", data.error); showIoMessage(`Failed load notes: ${data.error}`, 'error'); tabNotesArea.value = ""; }
         } catch (error) { console.error("Network/fetch error loading tab notes:", error); showIoMessage(`Error loading notes: ${error.message}`, 'error'); tabNotesArea.value = ""; }
    }

    async function loadInitialNotes() {
        if (globalNotesArea) {
            try {
                const response = await fetch('/api/notes/global');
                 if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                const data = await response.json();
                if (data.success) { globalNotesArea.value = data.notes || ""; }
                else { console.error("Error fetching global notes:", data.error); showIoMessage(`Failed load global notes: ${data.error}`, 'error'); }
            } catch (error) { console.error("Net error loading global notes:", error); showIoMessage(`Error loading global notes: ${error.message}`, 'error'); }
        }
        await loadTabNotes(activeTerminalId); // Load notes for initial tab
         if (tabNotesPanelLabel) { const activeTabElement = terminalTabsContainer?.querySelector('.terminal-tab.active'); const tabTextElement = activeTabElement?.querySelector('.tab-text'); tabNotesPanelLabel.textContent = tabTextElement ? tabTextElement.textContent : activeTerminalId; }
    }

    function handleGlobalNotesInput() {
        if (globalNotesSaveTimeout) clearTimeout(globalNotesSaveTimeout);
        globalNotesSaveTimeout = setTimeout(async () => {
            if (globalNotesArea) {
                try {
                    const response = await fetch('/api/notes/global', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: globalNotesArea.value }) });
                     if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                    const data = await response.json(); if (!data.success) { console.error("Error saving global notes:", data.error); showIoMessage(`Save error: ${data.error}`, 'error'); }
                } catch (error) { console.error("Net error saving global notes:", error); showIoMessage(`Save error: ${error.message}`, 'error'); }
            }
        }, 750);
    }

    function handleTabNotesInput() {
        if (tabNotesSaveTimeout) clearTimeout(tabNotesSaveTimeout);
        tabNotesSaveTimeout = setTimeout(async () => {
            if (tabNotesArea && activeTerminalId) {
                 try {
                     const response = await fetch(`/api/notes/tab/${encodeURIComponent(activeTerminalId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: tabNotesArea.value }) });
                     if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                     const data = await response.json(); if (!data.success) { console.error("Error saving tab notes:", data.error); showIoMessage(`Save error: ${data.error}`, 'error'); }
                 } catch (error) { console.error("Net error saving tab notes:", error); showIoMessage(`Save error: ${error.message}`, 'error'); }
            }
        }, 750);
    }

    function togglePanel(panelElement) {
        if (!panelElement) return;
        panelElement.classList.toggle('visible');
        if (panelElement.classList.contains('visible')) { panelElement.querySelector('textarea')?.focus(); }
    }


    // --- Setup Event Listeners ---
    function setupEventListeners() {
        console.log("Setting up App listeners...");
        searchInput?.addEventListener('input', handleSearchInputChange);
        const variableSection = document.getElementById('variable-input-section');
        variableSection?.addEventListener('input', (event) => { if (event.target.matches('.variable-item input[type="text"]')) { handleVariableInputChange(event); } });
        playbookUploadInput?.addEventListener('change', handlePlaybookUpload);
        terminalTabsContainer?.addEventListener('click', handleTerminalTabClick);
        terminalTabsContainer?.addEventListener('dblclick', handleTerminalTabDoubleClick);
        addTerminalTabBtn?.addEventListener('click', handleAddTerminalTab);
        globalNotesArea?.addEventListener('input', handleGlobalNotesInput);
        tabNotesArea?.addEventListener('input', handleTabNotesInput);
        tabNotesToggleBtn?.addEventListener('click', () => togglePanel(tabNotesPanel));
        globalNotesToggleBtn?.addEventListener('click', () => togglePanel(globalNotesPanel));
        closePanelButtons.forEach(button => { button.addEventListener('click', () => { const panelId = button.dataset.panel; document.getElementById(panelId)?.classList.remove('visible'); }); });
        document.addEventListener('click', (event) => { if (searchResultsContainer && searchResultsContainer.style.display !== 'none') { if (!searchResultsContainer.contains(event.target) && event.target !== searchInput) { searchResultsContainer.style.display = 'none'; } } });
        console.log("App Listeners setup OK.");
    }

    // --- Start ---
    initializeApp();

}); // End DOMContentLoaded
