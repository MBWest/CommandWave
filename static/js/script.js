/**
 * Filename: static/js/script.js
 * Description: Frontend JavaScript logic for the Command Wave application.
 * Handles:
 * - Fetching commands and filter data from the backend API.
 * - Displaying commands and applying filters (OS, Items, Tags, Search) using BUTTONS.
 * - Real-time command preview with variable substitution using TAB-SPECIFIC variables.
 * - Adding, editing commands via API calls using BUTTONS for tags in form.
 * - Deleting commands via API calls.
 * - Toggling UI sections (Add Form, Filters) using clickable titles.
 * - Copying commands to the clipboard.
 * - Sending commands (Execute) to the active terminal via backend API (Requires Execute Mode).
 * - Managing global Edit Mode & Execute Mode state.
 * - Handling Backup/Import functionality via a modal window.
 * - Handling terminal tab switching, adding new terminals, renaming, and DELETING tabs.
 */

document.addEventListener('DOMContentLoaded', async () => {

    // --- Constants & Global State ---
    const PREDEFINED_ITEMS = [ 'Username', 'Password', 'No Creds', 'Hash', 'TGS', 'TGT', 'PFX', 'Shell', 'Target IP', 'DC IP', 'DNS IP' ];
    const PREDEFINED_OS = ['linux', 'windows'];
    let PREDEFINED_FILTER_CATEGORIES = {};
    const ITEM_DESCRIPTIONS = {
        'Username': "A unique name identifying a user for login purposes.",
        'Password': "A secret word or phrase used to gain admission to something.",
        'No Creds': "Indicates that no specific credentials (username/password/hash) are required or used by the command.",
        'Hash': "A non-reversible representation of data, often used for password storage (e.g., NTLM, LM).",
        'TGS': "Kerberos Ticket Granting Service ticket, used to request service tickets for specific resources.",
        'TGT': "Kerberos Ticket Granting Ticket, obtained after initial authentication, used to request TGS tickets.",
        'PFX': "Personal Information Exchange format (.pfx), commonly used to bundle a certificate with its private key.",
        'Shell': "Command-line interface access to an operating system.",
        'Target IP': "The IP address of the primary machine or service being targeted by the command.",
        'DC IP': "The IP address associated with a network domain, typically a Domain Controller.",
        'DNS IP': "The IP address of a Domain Name System server used for name resolution."
    };
    const OS_DESCRIPTIONS = {
        'linux': "A family of open-source Unix-like operating systems based on the Linux kernel.",
        'windows': "A group of proprietary graphical operating system families developed and marketed by Microsoft."
    };
    const FILTER_DESCRIPTIONS = {
        // Services
        'SMB': "Server Message Block protocol, used for file sharing, printing, and inter-process communication on Windows networks.",
        'WMI': "Windows Management Instrumentation, allows scripting and management of Windows systems.",
        'DCOM': "Distributed Component Object Model, enables software components to communicate across networks.",
        'Kerberos': "Network authentication protocol using tickets to allow nodes to prove their identity over a non-secure network.",
        'RPC': "Remote Procedure Call, allows a program to execute code on another computer.",
        'LDAP': "Lightweight Directory Access Protocol, for accessing and maintaining distributed directory information services.",
        'NTLM': "NT LAN Manager, a suite of Microsoft security protocols for authentication.",
        'DNS': "Domain Name System, translates human-readable domain names to machine-readable IP addresses.",
        'SSH': "Secure Shell, a cryptographic network protocol for secure remote login and command execution.",
        'FTP': "File Transfer Protocol, used for transferring files between computers on a network.",
        'HTTP/HTTPS': "Hypertext Transfer Protocol (Secure), foundation of data communication for the World Wide Web.",
        'SNMP': "Simple Network Management Protocol, for collecting and organizing information about managed devices on IP networks.",
        // Attack Types (MITRE ATT&CK Tactics)
        'Enumeration': "Gathering information about the target system or network (users, shares, services).",
        'Exploitation': "Taking advantage of a vulnerability to gain access or execute code.",
        'Persistence': "Maintaining access to a compromised system across restarts or credential changes.",
        'Privilege Escalation': "Gaining higher-level permissions than initially granted.",
        'Credential Access': "Stealing account names and passwords/hashes (e.g., dumping LSASS, Mimikatz).",
        'Exfiltration': "Unauthorized transfer of data from a computer or network.",
        'Lateral Movement': "Moving through a network from one compromised host to another.",
        'Masquerade': "Posing as a legitimate user, service, or system component to evade detection."
    };
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

    let allCommands = [];
    let currentFilterOS = [];
    let currentFilterItems = [];
    let currentFilterTags = [];
    let currentSearchTerm = '';
    let terminalVariablesState = {};
    let activeTerminalId = 'term-main';
    let isEditMode = false;
    let globalEditModeEnabled = false;
    let globalExecuteModeEnabled = false;
    let initialTerminalPort = 7681;

    // --- DOM Element References ---
    const commandListDiv = document.getElementById('commandList');
    const addCommandForm = document.getElementById('addCommandForm');
    const searchInput = document.getElementById('searchInput');
    const formMessage = document.getElementById('form-message');
    const ioMessageDiv = document.getElementById('io-message');
    const addCommandSection = document.getElementById('add-command-section'); // The section itself
    const filterControlsSection = document.getElementById('filter-controls-section'); // The section itself
    const commandItemTemplate = document.getElementById('command-item-template');
    const toggleEditModeBtn = document.getElementById('toggle-edit-mode-btn');
    const toggleExecuteModeBtn = document.getElementById('toggle-execute-mode-btn');
    const addSectionToggle = document.getElementById('add-section-toggle'); // The H2 toggle
    const filterSectionToggle = document.getElementById('filter-section-toggle'); // The H2 toggle
    const formOSButtonGroupDiv = document.getElementById('form-os-button-group');
    const formItemsButtonGroupDiv = document.getElementById('form-items-button-group');
    const formServicesButtonGroupDiv = document.getElementById('form-services-button-group');
    const formAttackTypeButtonGroupDiv = document.getElementById('form-attacktype-button-group');
    const formSubmitBtn = document.getElementById('form-submit-btn');
    const formEditIdInput = document.getElementById('edit-command-id');
    const cancelEditContainer = document.getElementById('cancel-edit-container');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const filterOSButtonGroupDiv = document.getElementById('filter-os-button-group');
    const filterItemsButtonGroupDiv = document.getElementById('filter-items-button-group');
    const filterServicesButtonGroupDiv = document.getElementById('filter-services-button-group');
    const filterAttackTypeButtonGroupDiv = document.getElementById('filter-attacktype-button-group');
    const variableInputElements = {};
    Object.keys(VARIABLE_MAP).forEach(id => { variableInputElements[id] = document.getElementById(id); if (!variableInputElements[id]) { console.warn(`Var input "${id}" not found.`); } });
    const backupImportModal = document.getElementById('backup-import-modal');
    const toggleBackupImportModalBtn = document.getElementById('toggle-backup-import-modal-btn');
    const modalCloseBtn = backupImportModal?.querySelector('.modal-close-btn');
    const modalExportJsonBtn = document.getElementById('modal-export-json-btn');
    const modalExportCsvBtn = document.getElementById('modal-export-csv-btn');
    const modalImportFileInp = document.getElementById('modal-importFile');
    const modalImportBtn = document.getElementById('modal-import-btn');
    const terminalTabsContainer = document.querySelector('.terminal-tabs');
    const terminalIframesContainer = document.querySelector('.terminal-iframes');
    const addTerminalTabBtn = document.getElementById('add-terminal-tab-btn');
    const mainTerminalTab = document.querySelector('.terminal-tab[data-terminal-id="term-main"]');

    // --- Utility Functions ---
    function escapeHtml(unsafe) { if (unsafe === null || unsafe === undefined) return ''; return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
    function setButtonGroupState(containerDiv, values) { if (!containerDiv) return; const valuesSet = new Set(values || []); containerDiv.querySelectorAll('.filter-button').forEach(btn => { btn.classList.toggle('active', valuesSet.has(btn.dataset.value)); }); }
    function showIoMessage(message, type = 'info', duration = 7000) { if (!ioMessageDiv) return; ioMessageDiv.textContent = message; ioMessageDiv.className = `message ${type}`; void ioMessageDiv.offsetWidth; ioMessageDiv.classList.add('visible'); if (ioMessageDiv.hideTimeout) clearTimeout(ioMessageDiv.hideTimeout); ioMessageDiv.hideTimeout = setTimeout(() => { ioMessageDiv.classList.remove('visible'); ioMessageDiv.addEventListener('transitionend', () => { if (!ioMessageDiv.classList.contains('visible')) { ioMessageDiv.textContent = ''; ioMessageDiv.className = 'message'; } }, { once: true }); }, duration); }
    function openBackupImportModal() { if (backupImportModal) { backupImportModal.style.display = 'flex'; requestAnimationFrame(() => { backupImportModal.classList.add('visible'); }); } }
    function closeBackupImportModal() { if (backupImportModal) { backupImportModal.classList.remove('visible'); const handleTransitionEnd = (event) => { if (event.target === backupImportModal) { backupImportModal.style.display = 'none'; backupImportModal.removeEventListener('transitionend', handleTransitionEnd); } }; backupImportModal.addEventListener('transitionend', handleTransitionEnd); setTimeout(() => { if (backupImportModal.style.display !== 'none' && !backupImportModal.classList.contains('visible')) { backupImportModal.style.display = 'none'; backupImportModal.removeEventListener('transitionend', handleTransitionEnd); } }, 500); } }

    // --- Initialization Functions ---
    function updateVariableInputsUI(terminalId) { const variables = terminalVariablesState[terminalId] || DEFAULT_VARIABLES; console.log(`Updating var UI for: ${terminalId}`, variables); for (const inputId in VARIABLE_MAP) { const stateKey = VARIABLE_MAP[inputId].stateKey; const inputElement = variableInputElements[inputId]; if (inputElement) { inputElement.value = variables[stateKey] || ''; } } }
    async function initializeApp() { console.log("Initializing..."); try { const mainTermElem = document.getElementById('term-main'); const portFromData = mainTermElem?.dataset.initialPort; if (portFromData && !isNaN(parseInt(portFromData, 10))) { initialTerminalPort = parseInt(portFromData, 10); console.log(`Initial port: ${initialTerminalPort}`); } else { console.error("Could not get initial port!"); } if (mainTerminalTab) mainTerminalTab.title = `Main Terminal (Port ${initialTerminalPort}). Double-click rename.`; activeTerminalId = 'term-main'; terminalVariablesState[activeTerminalId] = { ...DEFAULT_VARIABLES }; updateVariableInputsUI(activeTerminalId); await fetchPredefinedFilters(); const itemsToDisplay = PREDEFINED_ITEMS; populateFilterButtons(formOSButtonGroupDiv, PREDEFINED_OS, 'form_os_', OS_DESCRIPTIONS); populateFilterButtons(formItemsButtonGroupDiv, itemsToDisplay, 'form_item_', ITEM_DESCRIPTIONS); populateFilterButtons(formServicesButtonGroupDiv, PREDEFINED_FILTER_CATEGORIES["Services"] || [], 'form_service_', FILTER_DESCRIPTIONS); populateFilterButtons(formAttackTypeButtonGroupDiv, PREDEFINED_FILTER_CATEGORIES["Attack Type"] || [], 'form_attack_', FILTER_DESCRIPTIONS); populateFilterButtons(filterOSButtonGroupDiv, PREDEFINED_OS, 'filter_os_', OS_DESCRIPTIONS); populateFilterButtons(filterItemsButtonGroupDiv, itemsToDisplay, 'filter_item_', ITEM_DESCRIPTIONS); populateFilterButtons(filterServicesButtonGroupDiv, PREDEFINED_FILTER_CATEGORIES["Services"] || [], 'filter_service_', FILTER_DESCRIPTIONS); populateFilterButtons(filterAttackTypeButtonGroupDiv, PREDEFINED_FILTER_CATEGORIES["Attack Type"] || [], 'filter_attack_', FILTER_DESCRIPTIONS); setupEventListeners(); await fetchCommands(); console.log("Init OK."); } catch (error) { console.error("Init failed:", error); commandListDiv.innerHTML = `<p class="error">App init failed: ${escapeHtml(error.message)}</p>`; showIoMessage(`Init failed: ${error.message}`, 'error', 15000); } }
    async function fetchPredefinedFilters() { try { const response = await fetch('/api/filter_tags'); if (!response.ok) throw new Error(`HTTP ${response.status} fetch filters`); PREDEFINED_FILTER_CATEGORIES = await response.json(); if (typeof PREDEFINED_FILTER_CATEGORIES !== 'object' || PREDEFINED_FILTER_CATEGORIES === null) { PREDEFINED_FILTER_CATEGORIES = {}; throw new Error("Invalid filter data."); } PREDEFINED_FILTER_CATEGORIES["Services"] = PREDEFINED_FILTER_CATEGORIES["Services"] || []; PREDEFINED_FILTER_CATEGORIES["Attack Type"] = PREDEFINED_FILTER_CATEGORIES["Attack Type"] || []; console.log("Fetched Filters:", PREDEFINED_FILTER_CATEGORIES); } catch (error) { console.error("Err fetch filters:", error); PREDEFINED_FILTER_CATEGORIES = {"Services": [], "Attack Type": []}; throw new Error(`Could not fetch Filter cats: ${error.message}`); } }
    function populateFilterButtons(containerDiv, itemsArray, idPrefix, descriptionMap) { if (!containerDiv) { console.warn("Btn container missing:", idPrefix); return; } containerDiv.innerHTML = ''; if (!Array.isArray(itemsArray) || itemsArray.length === 0) return; const sortedItems = [...itemsArray].sort((a, b) => a.localeCompare(b)); sortedItems.forEach(item => { const button = document.createElement('button'); button.type = 'button'; button.className = 'filter-button'; button.textContent = item; button.dataset.value = item; button.title = descriptionMap[item] || item; containerDiv.appendChild(button); }); }

    // --- Core Data Handling ---
    async function fetchCommands() { console.log("Fetching cmds..."); commandListDiv.innerHTML = '<p>Loading...</p>'; try { const response = await fetch('/api/commands'); if (!response.ok) throw new Error(`HTTP ${response.status} fetch cmds`); const fetchedCommands = await response.json(); if (!Array.isArray(fetchedCommands)) { allCommands = []; throw new Error("Cmd data not array."); } allCommands = fetchedCommands; console.log(`Workspaceed ${allCommands.length} cmds.`); applyFilters(); } catch (error) { console.error("Err fetch cmds:", error); allCommands = []; commandListDiv.innerHTML = `<p class="error">Load err: ${escapeHtml(error.message)}</p>`; applyFilters(); showIoMessage(`Load err: ${error.message}`, 'error'); } }

    // --- Filtering Logic ---
    function applyFilters() { console.log(`Applying filters - OS:[${currentFilterOS.join(',')}] Items:[${currentFilterItems.join(',')}] Tags:[${currentFilterTags.join(',')}] Search:[${currentSearchTerm}]`); let filteredCommands = allCommands; if (currentFilterOS.length > 0) { filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.os) && cmd.os.some(cmdOs => currentFilterOS.includes(cmdOs))); } if (currentFilterItems.length > 0) { filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.items) && cmd.items.some(item => currentFilterItems.includes(item))); } if (currentFilterTags.length > 0) { filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.filters) && cmd.filters.some(tag => currentFilterTags.includes(tag))); } if (currentSearchTerm) { const searchTermLower = currentSearchTerm; filteredCommands = filteredCommands.filter(cmd => { const searchString = [ cmd.command, cmd.description, ...(Array.isArray(cmd.os) ? cmd.os : []), ...(Array.isArray(cmd.items) ? cmd.items : []), ...(Array.isArray(cmd.filters) ? cmd.filters : []) ].join(' ').toLowerCase(); return searchString.includes(searchTermLower); }); } const currentActiveVariables = terminalVariablesState[activeTerminalId] || DEFAULT_VARIABLES; displayCommands(filteredCommands, currentActiveVariables); }

    // --- Variable Substitution ---
    function performVariableSubstitution(originalCommand, variables) { let substitutedCommandHtml = escapeHtml(originalCommand); for (const inputId in VARIABLE_MAP) { const { stateKey, placeholder } = VARIABLE_MAP[inputId]; const value = variables && variables[stateKey] ? variables[stateKey].trim() : ''; if (value) { const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(escapedPlaceholder, 'g'); const replacementHtml = `<span class="substituted-var">${escapeHtml(value)}</span>`; substitutedCommandHtml = substitutedCommandHtml.replace(regex, replacementHtml); } } return substitutedCommandHtml; }
    function getSubstitutedPlainText(originalCommand, variables) { let text = originalCommand; for (const inputId in VARIABLE_MAP) { const { stateKey, placeholder } = VARIABLE_MAP[inputId]; const value = variables && variables[stateKey] ? variables[stateKey].trim() : ''; if (value) { const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(escapedPlaceholder, 'g'); text = text.replace(regex, value); } } return text; }

    // --- Display Logic ---
     function displayCommands(commandsToDisplay, activeVariables) { if (!commandListDiv) { console.error("Cmd list container missing!"); return; } console.log(`Displaying ${commandsToDisplay ? commandsToDisplay.length : 0} cmds for tab ${activeTerminalId}`); commandListDiv.innerHTML = ''; if (!commandsToDisplay || commandsToDisplay.length === 0) { commandListDiv.innerHTML = `<p>No commands match filters.</p>`; return; } const list = document.createElement('ul'); commandsToDisplay.forEach(command => { try { const templateNode = commandItemTemplate.content.cloneNode(true); const listItem = templateNode.querySelector('li'); const currentVars = activeVariables || DEFAULT_VARIABLES; const substitutedText = getSubstitutedPlainText(command.command, currentVars); const substitutedHtml = performVariableSubstitution(command.command, currentVars); const createTagsHtml = (tags, cssClass, placeholderText) => { if (Array.isArray(tags) && tags.length > 0) { return tags.map(tag => `<span class="${cssClass}">${escapeHtml(tag)}</span>`).join(' '); } return `<span class="${cssClass} placeholder">${placeholderText}</span>`; }; listItem.querySelector('.tags-items').innerHTML = createTagsHtml(command.items, 'item-tag', '[No Items]'); listItem.querySelector('.tags-os').innerHTML = createTagsHtml(command.os, 'os-tag', '[No OS]'); listItem.querySelector('.tags-filters').innerHTML = createTagsHtml(command.filters, 'filter-tag', '[No Tags]'); listItem.querySelector('code').innerHTML = substitutedHtml; listItem.querySelector('p').textContent = escapeHtml(command.description || 'No description.'); const copyBtn = listItem.querySelector('.copy-btn'); if(copyBtn) copyBtn.dataset.commandSubstituted = substitutedText; const executeBtn = listItem.querySelector('.execute-btn'); if(executeBtn) executeBtn.dataset.commandSubstituted = substitutedText; const editBtn = listItem.querySelector('.edit-btn'); if(editBtn) editBtn.dataset.commandId = command.id; const deleteBtn = listItem.querySelector('.delete-btn'); if(deleteBtn) deleteBtn.dataset.commandId = command.id; listItem.querySelectorAll('.command-edit-delete-btn').forEach(btn => { btn.classList.toggle('hidden', !globalEditModeEnabled); }); executeBtn?.classList.toggle('hidden', !globalExecuteModeEnabled); list.appendChild(listItem); } catch (error) { console.error("Err creating cmd item:", error, "Cmd:", command); const errorItem = document.createElement('li'); errorItem.innerHTML = `<p class="error">Err display cmd ID ${command?.id || 'Unknown'}</p>`; list.appendChild(errorItem); } }); commandListDiv.appendChild(list); }

    // --- Form Handling ---
    function setFormMode(mode, commandData = null) {
        isEditMode = (mode === 'edit');
        formMessage.textContent = ''; formMessage.className = 'message';
        const formTitleElement = addSectionToggle; // Use the h2 toggle element

        if (isEditMode && commandData) {
            if (formTitleElement) formTitleElement.textContent = 'Edit Command';
            formSubmitBtn.textContent = 'Update Command';
            formEditIdInput.value = commandData.id;
            cancelEditContainer.style.display = 'inline-block';
            addCommandForm.elements['command'].value = commandData.command || '';
            addCommandForm.elements['description'].value = commandData.description || '';
            setButtonGroupState(formOSButtonGroupDiv, commandData.os);
            setButtonGroupState(formItemsButtonGroupDiv, commandData.items);
            const allCommandFilters = commandData.filters || [];
            setButtonGroupState(formServicesButtonGroupDiv, allCommandFilters);
            setButtonGroupState(formAttackTypeButtonGroupDiv, allCommandFilters);

            // Ensure section is expanded if not already
            if (addCommandSection && !addCommandSection.classList.contains('expanded')) {
                 addCommandSection.classList.add('expanded');
                 addSectionToggle?.setAttribute('aria-expanded', 'true');
            }
            // Scroll the title into view
            formTitleElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } else {
            if (formTitleElement) formTitleElement.textContent = 'Add New Command';
            formSubmitBtn.textContent = 'Add Command';
            formEditIdInput.value = '';
            cancelEditContainer.style.display = 'none';
            isEditMode = false;
            addCommandForm.reset();
            setButtonGroupState(formOSButtonGroupDiv, []);
            setButtonGroupState(formItemsButtonGroupDiv, []);
            setButtonGroupState(formServicesButtonGroupDiv, []);
            setButtonGroupState(formAttackTypeButtonGroupDiv, []);
        }
    }

    // --- Event Handlers ---
    async function handleAddCommandSubmit(event) { event.preventDefault(); const commandId = formEditIdInput.value; console.log(`Form submit. Mode: ${isEditMode ? 'Edit (ID: ' + commandId + ')' : 'Add'}`); formMessage.textContent = ''; formMessage.className = 'message'; const formData = new FormData(addCommandForm); const commandText = formData.get('command').trim(); const descriptionText = formData.get('description').trim(); const getActiveButtonValues = (containerDiv) => Array.from(containerDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value); const selectedOS = getActiveButtonValues(formOSButtonGroupDiv); const selectedItems = getActiveButtonValues(formItemsButtonGroupDiv); const selectedServiceFilters = getActiveButtonValues(formServicesButtonGroupDiv); const selectedAttackFilters = getActiveButtonValues(formAttackTypeButtonGroupDiv); const data = { os: selectedOS, items: selectedItems, command: commandText, description: descriptionText, filters: [...new Set([...selectedServiceFilters, ...selectedAttackFilters])] }; if (!data.command) { formMessage.textContent = 'Cmd text missing.'; formMessage.className = 'message error visible'; return; } const url = isEditMode ? `/api/commands/${commandId}` : '/api/commands'; const method = isEditMode ? 'PUT' : 'POST'; formSubmitBtn.disabled = true; formSubmitBtn.textContent = isEditMode ? 'Updating...' : 'Adding...'; try { const response = await fetch(url, { method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }); const result = await response.json(); if (response.ok) { console.log(`Cmd ${isEditMode ? 'updated' : 'added'}:`, result); formMessage.textContent = result.message || `Cmd ${isEditMode ? 'updated' : 'added'} OK!`; formMessage.className = 'message success visible'; setFormMode('add'); await fetchCommands(); if (addCommandSection.classList.contains('expanded')) { handleToggleSection(addSectionToggle, addCommandSection); } } else { console.error(`Fail ${isEditMode ? 'update' : 'add'}:`, result); let errorMsg = `Error: ${result.error || response.statusText || 'Op failed.'}`; if (result.details) { try { errorMsg += ` Details: ${JSON.stringify(result.details)}`; } catch (e) {} } formMessage.textContent = errorMsg; formMessage.className = 'message error visible'; } } catch (error) { console.error("Net err submit:", error); formMessage.textContent = `Net err: ${error.message}`; formMessage.className = 'message error visible'; } finally { formSubmitBtn.disabled = false; if (formMessage.classList.contains('error')) { formSubmitBtn.textContent = isEditMode ? 'Update Command' : 'Add Command'; } else if (!isEditMode) { formSubmitBtn.textContent = 'Add Command'; } setTimeout(() => { if (formMessage.classList.contains('visible')) { formMessage.className = 'message'; formMessage.textContent = ''; } }, 7000); } }
    function handleFilterButtonClick(event) { const button = event.target; if (!button.classList.contains('filter-button') || !button.closest('#filter-controls-section')) return; button.classList.toggle('active'); const container = button.closest('.filter-button-container'); if (!container) return; const activeButtons = container.querySelectorAll('.filter-button.active'); const activeValues = Array.from(activeButtons).map(btn => btn.dataset.value); switch (container.id) { case 'filter-os-button-group': currentFilterOS = activeValues; break; case 'filter-items-button-group': currentFilterItems = activeValues; break; case 'filter-services-button-group': case 'filter-attacktype-button-group': const serviceTags = Array.from(filterServicesButtonGroupDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value); const attackTags = Array.from(filterAttackTypeButtonGroupDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value); currentFilterTags = [...new Set([...serviceTags, ...attackTags])]; break; } applyFilters(); }
    function handleFormButtonClick(event) { const button = event.target; if (button.classList.contains('filter-button') && button.closest('#add-command-section')) { button.classList.toggle('active'); } }
    function handleSearchInputChange(event) { currentSearchTerm = event.target.value.toLowerCase().trim(); applyFilters(); }

    /** Generic function to toggle a collapsible section based on its controller (title) */
    function handleToggleSection(controllerElement, sectionElement) {
        if (!controllerElement || !sectionElement) {
             console.warn("Missing controller or section for toggle");
             return;
        }
        const isExpanded = sectionElement.classList.toggle('expanded');
        controllerElement.setAttribute('aria-expanded', isExpanded);

        // Specific logic for Add form reset when collapsing
        if (sectionElement.id === 'add-command-section' && !isExpanded && isEditMode) {
             setFormMode('add');
        }
    }

    function handleVariableInputChange(event) { const inputId = event.target.id; if (VARIABLE_MAP[inputId]) { const stateKey = VARIABLE_MAP[inputId].stateKey; const value = event.target.value; if (!terminalVariablesState[activeTerminalId]) { terminalVariablesState[activeTerminalId] = { ...DEFAULT_VARIABLES }; } terminalVariablesState[activeTerminalId][stateKey] = value; applyFilters(); } }

    // --- Command List Action Handlers ---
    async function handleCopyCommand(button) { const commandToCopy = button.dataset.commandSubstituted; if (typeof commandToCopy !== 'string' || !navigator.clipboard) { showIoMessage("Clipboard copy fail.", "error"); const originalText = button.textContent; button.textContent = 'Fail'; button.disabled = true; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 1500); return; } try { await navigator.clipboard.writeText(commandToCopy); showIoMessage("Copied OK!", "success", 3000); const originalText = button.textContent; button.textContent = 'Copied!'; button.disabled = true; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 1500); } catch (err) { console.error("Clipboard fail:", err); showIoMessage(`Copy Err: ${err.message}`, "error"); const originalText = button.textContent; button.textContent = 'Error!'; button.disabled = true; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000); } }
    function handleEditClick(button) { const commandId = button.dataset.commandId; const commandToEdit = allCommands.find(cmd => cmd.id == commandId); if (commandToEdit) { setFormMode('edit', commandToEdit); } else { console.error(`Cmd ID ${commandId} not found.`); showIoMessage("Err: Cmd data missing.", "error"); } }
    async function handleDeleteClick(button) { const commandId = button.dataset.commandId; const commandToDelete = allCommands.find(cmd => cmd.id == commandId); const commandText = commandToDelete ? `"${commandToDelete.command.substring(0, 50)}${commandToDelete.command.length > 50 ? '...' : ''}"` : `ID ${commandId}`; if (confirm(`Delete command ${commandText}?`)) { button.disabled = true; button.textContent = 'Deleting...'; try { const response = await fetch(`/api/commands/${commandId}`, { method: 'DELETE' }); const result = await response.json().catch(() => ({ message: response.statusText, error: null })); if (response.ok) { showIoMessage(result.message || "Cmd deleted.", 'success'); await fetchCommands(); } else { console.error("Delete fail:", result); showIoMessage(`Delete Err: ${result.error || result.message || response.statusText}`, 'error'); button.disabled = false; button.textContent = 'Delete'; } } catch (error) { console.error("Net err delete:", error); showIoMessage(`Net err: ${error.message}`, 'error'); button.disabled = false; button.textContent = 'Delete'; } } }
    function handleCancelEdit() { setFormMode('add'); }
    function handleToggleEditMode() { globalEditModeEnabled = !globalEditModeEnabled; toggleEditModeBtn.setAttribute('aria-pressed', globalEditModeEnabled); const textNode = Array.from(toggleEditModeBtn.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().startsWith('Edit Mode')); if (textNode) { textNode.textContent = globalEditModeEnabled ? ' Edit Mode ON' : ' Edit Mode'; } commandListDiv.querySelectorAll('.command-edit-delete-btn').forEach(btn => { btn.classList.toggle('hidden', !globalEditModeEnabled); }); if (!globalEditModeEnabled && isEditMode) { setFormMode('add'); } }
    function handleToggleExecuteMode() { globalExecuteModeEnabled = !globalExecuteModeEnabled; toggleExecuteModeBtn.setAttribute('aria-pressed', globalExecuteModeEnabled); const textNode = Array.from(toggleExecuteModeBtn.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().startsWith('Execute Mode')); if (textNode) { textNode.textContent = globalExecuteModeEnabled ? ' Execute Mode ON' : ' Execute Mode'; } commandListDiv.querySelectorAll('.execute-btn').forEach(btn => { btn.classList.toggle('hidden', !globalExecuteModeEnabled); }); if (globalExecuteModeEnabled) { showIoMessage("Execute Mode ON: Cmds -> Terminals.", "warning", 5000); } }
    async function handleExecuteCommand(button) { const commandToSend = button.dataset.commandSubstituted?.trim(); if (!commandToSend) { showIoMessage("Cannot exec empty cmd.", "warning"); return; } const activeTab = terminalTabsContainer?.querySelector('.terminal-tab.active'); const terminalId = activeTab?.dataset.terminalId; if (!terminalId) { showIoMessage("No active terminal.", "error"); return; } let targetPort; if (terminalId === 'term-main') { targetPort = initialTerminalPort; if (isNaN(targetPort)) { showIoMessage("Initial port unknown.", "error"); return; } } else { const portMatch = terminalId.match(/^term-(\d+)$/); if (portMatch && portMatch[1]) { targetPort = parseInt(portMatch[1], 10); } else { showIoMessage(`Invalid term ID: ${terminalId}`, "error"); return; } } if (isNaN(targetPort)) { showIoMessage("Cannot find target port.", "error"); return; } console.log(`Executing on port ${targetPort}: ${commandToSend}`); showIoMessage(`Sending to Port ${targetPort}...`, 'info', 2000); button.disabled = true; const originalText = button.textContent; button.textContent = 'Executing...'; try { const response = await fetch('/api/terminals/sendkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: targetPort, command: commandToSend }) }); const result = await response.json(); if (response.ok && result.success) { showIoMessage(result.message || "Cmd sent.", 'success', 3000); button.textContent = 'Sent!'; button.classList.add('sent'); setTimeout(() => { button.textContent = originalText; button.classList.remove('sent'); button.disabled = false; }, 1500); } else { console.error("Exec fail:", result); showIoMessage(`Exec Err: ${result.error || response.statusText}`, 'error'); button.textContent = 'Error!'; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000); } } catch (error) { console.error("Net err exec:", error); showIoMessage(`Net Err: ${error.message}`, 'error'); button.textContent = 'Error!'; setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000); } }

    // --- Backup/Import Event Handlers ---
    function handleExport(format) { showIoMessage(`Exporting ${format}...`, 'info', 3000); window.location.href = `/api/commands/export?format=${format}`; }
    async function handleImport() { const file = modalImportFileInp.files[0]; if (!file) { showIoMessage('Select .json/.csv file.', 'warning'); return; } showIoMessage(`Importing ${file.name}...`, 'info'); modalImportBtn.disabled = true; modalImportBtn.textContent = 'Importing...'; const formData = new FormData(); formData.append('importFile', file); try { const response = await fetch('/api/commands/import', { method: 'POST', body: formData }); const result = await response.json(); if (response.ok) { let message = result.message || `Import OK. Added: ${result.success_count || 0}, Skip: ${result.fail_count || 0}.`; showIoMessage(message, 'success', result.errors?.length > 0 ? 10000 : 5000); if (result.errors?.length > 0) console.warn("Import errs:", result.errors.slice(0, 20)); await fetchCommands(); closeBackupImportModal(); } else { console.error("Import fail:", result); showIoMessage(`Import Err: ${result.error || 'Unknown.'}`, 'error'); } } catch (error) { console.error("Net err import:", error); showIoMessage(`Net err: ${error.message}`, 'error'); } finally { modalImportBtn.disabled = false; modalImportBtn.textContent = 'Upload & Import'; modalImportFileInp.value = ''; } }

    // --- Terminal Tab Handling ---

     /** Handles clicks within the terminal tabs container (delegation). */
     function handleTerminalTabClick(event) {
        const clickedTab = event.target.closest('.terminal-tab');
        const clickedCloseButton = event.target.closest('.close-tab-btn');

        if (clickedCloseButton) {
            // Handle delete button click
            handleDeleteTerminalTab(clickedCloseButton);
        } else if (clickedTab && !clickedTab.classList.contains('active')) {
             // Handle tab switching (only if not clicking close btn and not already active)
             // Ignore clicks on the add button itself
            if (clickedTab !== addTerminalTabBtn && clickedTab.dataset.terminalId) {
                switchActiveTerminalTab(clickedTab, clickedTab.dataset.terminalId);
            }
        }
        // Ignore clicks not on a tab or close button, or on the active tab itself
    }

    /** Handles double-clicks within the terminal tabs container for renaming tabs (event delegation). */
    function handleTerminalTabDoubleClick(event) {
        const clickedTab = event.target.closest('.terminal-tab');
        // Ignore double-clicks on close button or add button
        if (!clickedTab || event.target.closest('.close-tab-btn') || clickedTab === addTerminalTabBtn || !clickedTab.dataset.terminalId) return;
        renameTerminalTab(clickedTab); // Initiate rename process
    }

    /** Sets the specified tab button and corresponding iframe as active. */
    function switchActiveTerminalTab(tabElement, terminalId) {
        // Check if the target element still exists in the DOM
        if (!document.body.contains(tabElement) || !terminalId || activeTerminalId === terminalId) {
            console.log("Switch aborted: Target tab doesn't exist or already active.", terminalId);
             // If the intended target is gone, maybe default to main?
             if (activeTerminalId === terminalId && !document.body.contains(tabElement)) {
                  const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
                  if (mainTabEl) {
                      console.log("Falling back to main tab.");
                      switchActiveTerminalTab(mainTabEl, 'term-main');
                      return; // Prevent further execution with old/invalid ID
                  }
             }
            return; // No change needed or possible
        }

        console.log(`Switching active tab from ${activeTerminalId} to ${terminalId}`);

        terminalTabsContainer?.querySelectorAll('.terminal-tab').forEach(tab => tab.classList.remove('active'));
        terminalIframesContainer?.querySelectorAll('.terminal-iframe').forEach(iframe => iframe.classList.remove('active'));

        tabElement.classList.add('active');
        const iframeToShow = terminalIframesContainer?.querySelector(`#${terminalId}`);
        if (iframeToShow) {
            iframeToShow.classList.add('active');
            setTimeout(() => { try { iframeToShow.contentWindow?.focus(); } catch (e) { console.warn("Cannot focus iframe:", e.message); } }, 0);
        } else {
            console.error(`Iframe missing: ${terminalId}`);
            showIoMessage(`Err: Cannot find term content ${terminalId}`, 'error');
            // Fallback if iframe is missing after tab switch attempt
            const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTabEl && terminalId !== 'term-main') {
                 switchActiveTerminalTab(mainTabEl, 'term-main');
             }
        }

        activeTerminalId = terminalId;
        updateVariableInputsUI(activeTerminalId);
        applyFilters();
    }


    /** Prompts the user for a new name for the tab and updates the UI. */
    function renameTerminalTab(tabElement) {
         const textSpan = tabElement.querySelector('.tab-text'); // Target the text span
         if (!textSpan) return; // Should not happen if structure is correct

         const currentName = textSpan.textContent; // Get text from inner span
         const terminalId = tabElement.dataset.terminalId;
         const iframe = terminalIframesContainer?.querySelector(`#${terminalId}`);
         const newName = prompt(`New name for "${currentName}":`, currentName);
         if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
             const sanitizedName = escapeHtml(newName.trim());
             textSpan.textContent = sanitizedName; // Update inner span text
             let portInfo = tabElement.title.match(/\(Port \d+\)/)?.[0] || '';
             tabElement.title = `Terminal: ${sanitizedName} ${portInfo}. Double-click rename.`;
             if (iframe) iframe.title = `${sanitizedName} ttyd terminal`;
             showIoMessage(`Renamed tab to "${sanitizedName}"`, 'info', 3000);
         } else if (newName !== null && newName.trim() === '') {
             showIoMessage("Tab name empty.", 'warning');
         }
    }


    /** Handles click on the '+' button to add a new terminal tab. */
     async function handleAddTerminalTab() {
        if (!addTerminalTabBtn) return;
        addTerminalTabBtn.disabled = true; addTerminalTabBtn.textContent = '...';
        try {
            const response = await fetch('/api/terminals/new', { method: 'POST' });
            const result = await response.json();
            if (response.ok && result.success) {
                const newPort = result.port;
                const newUrl = result.url;
                const newTerminalId = `term-${newPort}`;
                const defaultTabName = `Terminal ${newPort}`;

                // --- Create New Tab Button ---
                const newTabButton = document.createElement('button');
                newTabButton.className = 'terminal-tab';
                newTabButton.dataset.terminalId = newTerminalId;
                newTabButton.title = `Term port ${newPort}. Double-click rename.`;

                // -- Add Text Span and Close Button Span --
                const textSpan = document.createElement('span');
                textSpan.className = 'tab-text';
                textSpan.textContent = defaultTabName;

                const closeSpan = document.createElement('span');
                closeSpan.className = 'close-tab-btn';
                closeSpan.innerHTML = '&times;'; // Use HTML entity for 'x'
                closeSpan.setAttribute('aria-label', 'Close Tab');
                closeSpan.title = 'Close Tab'; // Tooltip

                newTabButton.appendChild(textSpan);
                newTabButton.appendChild(closeSpan);
                // ------------------------------------------

                terminalTabsContainer?.insertBefore(newTabButton, addTerminalTabBtn);

                // --- Create New Iframe ---
                const newIframe = document.createElement('iframe');
                newIframe.id = newTerminalId;
                newIframe.className = 'terminal-iframe';
                newIframe.src = newUrl;
                newIframe.title = `${defaultTabName} ttyd terminal`;
                newIframe.onload = () => console.log(`Iframe ${newTerminalId} loaded OK from ${newUrl}.`);
                newIframe.onerror = () => { console.error(`Iframe ${newTerminalId} failed load: ${newUrl}`); showIoMessage(`Err load term Port ${newPort}`, 'error'); try { newIframe.contentDocument.body.innerHTML = `<p style='color:red; padding: 10px;'>Error loading terminal.</p>`; } catch(e) {} };
                terminalIframesContainer?.appendChild(newIframe);

                terminalVariablesState[newTerminalId] = { ...DEFAULT_VARIABLES };
                console.log(`Init vars for new term: ${newTerminalId}`);
                switchActiveTerminalTab(newTabButton, newTerminalId);
            } else {
                const errorMsg = result.error || `Server error ${response.status}`;
                console.error("Fail create term:", result);
                showIoMessage(`Create term err: ${errorMsg}`, 'error');
            }
        } catch (error) {
            console.error("Net err create term:", error);
            showIoMessage(`Net err: ${error.message}`, 'error');
        } finally {
            addTerminalTabBtn.disabled = false; addTerminalTabBtn.textContent = '+';
        }
     }

    // --- Handler for deleting a terminal tab ---
    async function handleDeleteTerminalTab(closeButton) {
        const tabToDelete = closeButton.closest('.terminal-tab');
        if (!tabToDelete) return;

        const terminalId = tabToDelete.dataset.terminalId;
        const portMatch = terminalId.match(/^term-(\d+)$/);

        // Ensure it's a dynamic tab (has port number) and not the main tab
        if (!portMatch || !portMatch[1] || terminalId === 'term-main') {
            if (terminalId === 'term-main') {
                showIoMessage("The main terminal tab cannot be closed.", "warning");
            } else {
                console.error(`Invalid terminal ID format for deletion: ${terminalId}`);
            }
            return;
        }

        const port = parseInt(portMatch[1], 10);
        const tabName = tabToDelete.querySelector('.tab-text')?.textContent || `port ${port}`;

        if (!confirm(`Are you sure you want to close terminal "${tabName}"?`)) {
            return;
        }

        console.log(`Attempting to delete terminal tab: ${terminalId} (Port: ${port})`);
        tabToDelete.style.opacity = '0.5';
        tabToDelete.style.pointerEvents = 'none';

        try {
            const response = await fetch(`/api/terminals/${port}`, { method: 'DELETE' });
            // Allow for potentially empty successful responses
            const result = response.status === 200 ? (await response.json().catch(() => ({ success: true, message: `Terminal on port ${port} likely closed.` }))) : await response.json();


            if (response.ok && result.success) {
                showIoMessage(result.message || `Terminal "${tabName}" closed.`, 'success', 3000);

                const iframeToRemove = terminalIframesContainer?.querySelector(`#${terminalId}`);
                iframeToRemove?.remove();

                // Determine next active tab more robustly
                let nextActiveTabElement = null;
                const allTabs = Array.from(terminalTabsContainer?.querySelectorAll('.terminal-tab:not(#add-terminal-tab-btn)') || []);
                const currentIndex = allTabs.indexOf(tabToDelete);

                if (currentIndex > 0) { // If not the first tab, try previous
                    nextActiveTabElement = allTabs[currentIndex - 1];
                } else if (allTabs.length > 1) { // If it was the first, try the new first (which was originally second)
                    nextActiveTabElement = allTabs[1]; // Index 1 because tabToDelete is still technically in the array here before removal
                } else { // Only tab left is main (should always exist)
                     nextActiveTabElement = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
                }

                // Fallback to main just in case
                if (!nextActiveTabElement) {
                    nextActiveTabElement = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
                }

                // Remove the tab button
                tabToDelete.remove();

                // Clean up variable state
                delete terminalVariablesState[terminalId];

                // Switch to the determined next active tab
                if (nextActiveTabElement && nextActiveTabElement.dataset.terminalId) {
                     // Check if the currently active tab *was* the one deleted
                    if (activeTerminalId === terminalId) {
                        switchActiveTerminalTab(nextActiveTabElement, nextActiveTabElement.dataset.terminalId);
                    } else {
                         // Active tab was not deleted, no switch needed unless UI state is weird
                         console.log("Deleted tab was not active, no switch needed.");
                    }
                } else {
                    console.error("Could not determine valid next active tab after deletion.");
                     // Force switch to main as ultimate fallback
                    const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
                    if(mainTabEl) switchActiveTerminalTab(mainTabEl, 'term-main');
                }

            } else {
                showIoMessage(`Error closing tab "${tabName}": ${result.error || 'Unknown error'}`, 'error');
                tabToDelete.style.opacity = '';
                tabToDelete.style.pointerEvents = '';
            }
        } catch (error) {
            console.error("Network error deleting terminal:", error);
            showIoMessage(`Network error closing tab "${tabName}": ${error.message}`, 'error');
             tabToDelete.style.opacity = '';
             tabToDelete.style.pointerEvents = '';
        }
    }

    // --- Setup Event Listeners ---
    function setupEventListeners() {
        console.log("Setting up listeners...");

        // Core UI
        addCommandForm?.addEventListener('submit', handleAddCommandSubmit);
        searchInput?.addEventListener('input', handleSearchInputChange);
        cancelEditBtn?.addEventListener('click', handleCancelEdit);
        toggleEditModeBtn?.addEventListener('click', handleToggleEditMode);
        toggleExecuteModeBtn?.addEventListener('click', handleToggleExecuteMode);

        // Collapsible Section Titles
        addSectionToggle?.addEventListener('click', () => handleToggleSection(addSectionToggle, addCommandSection));
        addSectionToggle?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleToggleSection(addSectionToggle, addCommandSection); } });
        filterSectionToggle?.addEventListener('click', () => handleToggleSection(filterSectionToggle, filterControlsSection));
        filterSectionToggle?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleToggleSection(filterSectionToggle, filterControlsSection); } });

        // Filter/Form Buttons (Delegation)
        filterControlsSection?.addEventListener('click', handleFilterButtonClick);
        addCommandSection?.addEventListener('click', handleFormButtonClick);

        // Command List Actions (Delegation)
        commandListDiv?.addEventListener('click', (event) => { const targetButton = event.target.closest('button'); if (!targetButton) return; if (targetButton.classList.contains('copy-btn')) handleCopyCommand(targetButton); else if (targetButton.classList.contains('execute-btn') && !targetButton.classList.contains('hidden')) handleExecuteCommand(targetButton); else if (targetButton.classList.contains('edit-btn') && !targetButton.classList.contains('hidden')) handleEditClick(targetButton); else if (targetButton.classList.contains('delete-btn') && !targetButton.classList.contains('hidden')) handleDeleteClick(targetButton); });

        // Variable Inputs (Delegation)
        const variableSection = document.getElementById('variable-input-section');
        variableSection?.addEventListener('input', (event) => { if (event.target.matches('.variable-item input[type="text"]')) { handleVariableInputChange(event); } });

        // Modal
        toggleBackupImportModalBtn?.addEventListener('click', openBackupImportModal);
        modalCloseBtn?.addEventListener('click', closeBackupImportModal);
        backupImportModal?.addEventListener('click', (event) => { if (event.target === backupImportModal) closeBackupImportModal(); });
        modalExportJsonBtn?.addEventListener('click', () => handleExport('json'));
        modalExportCsvBtn?.addEventListener('click', () => handleExport('csv'));
        modalImportBtn?.addEventListener('click', handleImport);

        // Terminal Tabs - UPDATED listener to handle close buttons too
        terminalTabsContainer?.addEventListener('click', handleTerminalTabClick); // Single listener handles switching and close clicks
        terminalTabsContainer?.addEventListener('dblclick', handleTerminalTabDoubleClick); // Handles renaming
        addTerminalTabBtn?.addEventListener('click', handleAddTerminalTab); // Handles adding tabs

        console.log("Listeners setup OK.");
    }

    // --- Start ---
    initializeApp();

}); // End DOMContentLoaded
