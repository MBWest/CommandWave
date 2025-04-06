/**
 * Filename: static/js/script.js
 * Description: Frontend JavaScript logic for the Command Wave application.
 * Handles:
 * - Fetching commands and DYNAMIC option data (OS, Items, Filters) from the backend API.
 * - Displaying commands and applying filters (OS, Items, Tags, Search) using BUTTONS.
 * - Handling the addition of NEW options (OS, Items, Filters) via API calls.
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
    // REMOVED hardcoded: PREDEFINED_ITEMS, PREDEFINED_OS
    let dynamicOsOptions = []; // Will be fetched
    let dynamicItemOptions = []; // Will be fetched
    let dynamicFilterCategories = { "Service": [], "Attack Type": [] }; // Structure expected by populate functions

    // Descriptions remain useful for tooltips
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
        // Add descriptions for dynamically added items here if needed, or fetch them? For now, relies on keys.
    };
    const OS_DESCRIPTIONS = {
        'linux': "A family of open-source Unix-like operating systems based on the Linux kernel.",
        'windows': "A group of proprietary graphical operating system families developed and marketed by Microsoft."
        // Add descriptions for dynamically added OS here if needed
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
        // Add descriptions for dynamically added filters here if needed
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
    let initialTerminalPort = 7681; // Default, might be overwritten

    // --- DOM Element References ---
    const commandListDiv = document.getElementById('commandList');
    const addCommandForm = document.getElementById('addCommandForm');
    const searchInput = document.getElementById('searchInput');
    const formMessage = document.getElementById('form-message');
    const ioMessageDiv = document.getElementById('io-message');
    const addCommandSection = document.getElementById('add-command-section');
    const filterControlsSection = document.getElementById('filter-controls-section');
    const commandItemTemplate = document.getElementById('command-item-template');
    const toggleEditModeBtn = document.getElementById('toggle-edit-mode-btn');
    const toggleExecuteModeBtn = document.getElementById('toggle-execute-mode-btn');
    const addSectionToggle = document.getElementById('add-section-toggle');
    const filterSectionToggle = document.getElementById('filter-section-toggle');
    // Form Button Groups
    const formOSButtonGroupDiv = document.getElementById('form-os-button-group');
    const formItemsButtonGroupDiv = document.getElementById('form-items-button-group');
    const formServicesButtonGroupDiv = document.getElementById('form-services-button-group');
    const formAttackTypeButtonGroupDiv = document.getElementById('form-attacktype-button-group');
    // Filter Button Groups
    const filterOSButtonGroupDiv = document.getElementById('filter-os-button-group');
    const filterItemsButtonGroupDiv = document.getElementById('filter-items-button-group');
    const filterServicesButtonGroupDiv = document.getElementById('filter-services-button-group');
    const filterAttackTypeButtonGroupDiv = document.getElementById('filter-attacktype-button-group');
    // Add Option Inputs/Buttons (in Form section)
    const addOsInput = document.getElementById('add-os-input');
    const addOsBtn = document.getElementById('add-os-btn');
    const addItemInput = document.getElementById('add-item-input');
    const addItemBtn = document.getElementById('add-item-btn');
    const addServiceInput = document.getElementById('add-service-input');
    const addServiceBtn = document.getElementById('add-service-btn');
    const addAttackTypeInput = document.getElementById('add-attacktype-input');
    const addAttackTypeBtn = document.getElementById('add-attacktype-btn');
    // Other Form Elements
    const formSubmitBtn = document.getElementById('form-submit-btn');
    const formEditIdInput = document.getElementById('edit-command-id');
    const cancelEditContainer = document.getElementById('cancel-edit-container');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    // Variable Inputs
    const variableInputElements = {};
    Object.keys(VARIABLE_MAP).forEach(id => { variableInputElements[id] = document.getElementById(id); if (!variableInputElements[id]) { console.warn(`Var input "${id}" not found.`); } });
    // Modal Elements
    const backupImportModal = document.getElementById('backup-import-modal');
    const toggleBackupImportModalBtn = document.getElementById('toggle-backup-import-modal-btn');
    const modalCloseBtn = backupImportModal?.querySelector('.modal-close-btn');
    const modalExportJsonBtn = document.getElementById('modal-export-json-btn');
    const modalExportCsvBtn = document.getElementById('modal-export-csv-btn');
    const modalImportFileInp = document.getElementById('modal-importFile');
    const modalImportBtn = document.getElementById('modal-import-btn');
    // Terminal Elements
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
    async function initializeApp() {
        console.log("Initializing...");
        try {
            // Get initial terminal port from HTML
            const mainTermElem = document.getElementById('term-main');
            const portFromData = mainTermElem?.dataset.initialPort;
            if (portFromData && !isNaN(parseInt(portFromData, 10))) {
                initialTerminalPort = parseInt(portFromData, 10);
            } else {
                console.error("Could not get initial terminal port from HTML data attribute!");
            }

            if (mainTerminalTab) mainTerminalTab.title = `Main Terminal (Port ${initialTerminalPort}). Double-click rename.`;
            activeTerminalId = 'term-main';
            terminalVariablesState[activeTerminalId] = { ...DEFAULT_VARIABLES };
            updateVariableInputsUI(activeTerminalId);

            // Fetch all dynamic options concurrently
            await Promise.all([
                fetchOsOptions(),
                fetchItemOptions(),
                fetchFilterTags()
            ]);

            // Setup listeners *after* initial data fetch might be needed
            setupEventListeners();
            await fetchCommands(); // Fetch commands after options are ready

            console.log("Init OK.");
        } catch (error) {
            console.error("Init failed:", error);
            commandListDiv.innerHTML = `<p class="error">App init failed: ${escapeHtml(error.message)}</p>`;
            showIoMessage(`Init failed: ${error.message}`, 'error', 15000);
        }
    }

    // --- Option Fetching and Population ---
    async function fetchOsOptions() {
        try {
            const response = await fetch('/api/options/os');
            if (!response.ok) throw new Error(`HTTP ${response.status} fetch OS options`);
            const data = await response.json();
            dynamicOsOptions = data.options || [];
            console.log("Fetched OS Options:", dynamicOsOptions);
            populateFilterButtons(formOSButtonGroupDiv, dynamicOsOptions, 'form_os_', OS_DESCRIPTIONS);
            populateFilterButtons(filterOSButtonGroupDiv, dynamicOsOptions, 'filter_os_', OS_DESCRIPTIONS);
        } catch (error) {
            console.error("Err fetch OS options:", error);
            showIoMessage(`Failed to load OS options: ${error.message}`, 'error');
            dynamicOsOptions = []; // Ensure it's an empty array on error
            // Populate with empty array to clear out any stale buttons
            populateFilterButtons(formOSButtonGroupDiv, [], 'form_os_', OS_DESCRIPTIONS);
            populateFilterButtons(filterOSButtonGroupDiv, [], 'filter_os_', OS_DESCRIPTIONS);
        }
    }

    async function fetchItemOptions() {
        try {
            const response = await fetch('/api/options/item');
            if (!response.ok) throw new Error(`HTTP ${response.status} fetch Item options`);
            const data = await response.json();
            dynamicItemOptions = data.options || [];
            console.log("Fetched Item Options:", dynamicItemOptions);
            populateFilterButtons(formItemsButtonGroupDiv, dynamicItemOptions, 'form_item_', ITEM_DESCRIPTIONS);
            populateFilterButtons(filterItemsButtonGroupDiv, dynamicItemOptions, 'filter_item_', ITEM_DESCRIPTIONS);
        } catch (error) {
            console.error("Err fetch Item options:", error);
            showIoMessage(`Failed to load Item options: ${error.message}`, 'error');
            dynamicItemOptions = [];
            populateFilterButtons(formItemsButtonGroupDiv, [], 'form_item_', ITEM_DESCRIPTIONS);
            populateFilterButtons(filterItemsButtonGroupDiv, [], 'filter_item_', ITEM_DESCRIPTIONS);
        }
    }

    async function fetchFilterTags() {
        try {
            const response = await fetch('/api/filter_tags');
            if (!response.ok) throw new Error(`HTTP ${response.status} fetch filter tags`);
            const data = await response.json();
            // Ensure the expected structure exists, even if empty
            dynamicFilterCategories = {
                "Service": data["Service"] || [],
                "Attack Type": data["Attack Type"] || []
            };
            console.log("Fetched Filter Categories:", dynamicFilterCategories);
            populateFilterButtons(formServicesButtonGroupDiv, dynamicFilterCategories["Service"], 'form_service_', FILTER_DESCRIPTIONS);
            populateFilterButtons(formAttackTypeButtonGroupDiv, dynamicFilterCategories["Attack Type"], 'form_attack_', FILTER_DESCRIPTIONS);
            populateFilterButtons(filterServicesButtonGroupDiv, dynamicFilterCategories["Service"], 'filter_service_', FILTER_DESCRIPTIONS);
            populateFilterButtons(filterAttackTypeButtonGroupDiv, dynamicFilterCategories["Attack Type"], 'filter_attack_', FILTER_DESCRIPTIONS);
        } catch (error) {
            console.error("Err fetch filter tags:", error);
            showIoMessage(`Failed to load Filter tags: ${error.message}`, 'error');
            dynamicFilterCategories = { "Service": [], "Attack Type": [] };
            populateFilterButtons(formServicesButtonGroupDiv, [], 'form_service_', FILTER_DESCRIPTIONS);
            populateFilterButtons(formAttackTypeButtonGroupDiv, [], 'form_attack_', FILTER_DESCRIPTIONS);
            populateFilterButtons(filterServicesButtonGroupDiv, [], 'filter_service_', FILTER_DESCRIPTIONS);
            populateFilterButtons(filterAttackTypeButtonGroupDiv, [], 'filter_attack_', FILTER_DESCRIPTIONS);
        }
    }

    function populateFilterButtons(containerDiv, itemsArray, idPrefix, descriptionMap) {
        if (!containerDiv) { console.warn("Btn container missing:", idPrefix); return; }
        containerDiv.innerHTML = ''; // Clear existing buttons
        if (!Array.isArray(itemsArray) || itemsArray.length === 0) return;
        // Sort alphabetically for consistent display
        const sortedItems = [...itemsArray].sort((a, b) => a.localeCompare(b));
        sortedItems.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'filter-button';
            button.textContent = item;
            button.dataset.value = item; // Store the value
            // Try to find description, default to item name if not found
            button.title = descriptionMap[item] || item;
            containerDiv.appendChild(button);
        });
    }

    // --- Core Data Handling ---
    async function fetchCommands() {
        console.log("Fetching cmds...");
        commandListDiv.innerHTML = '<p>Loading commands...</p>';
        try {
            const response = await fetch('/api/commands');
            if (!response.ok) throw new Error(`HTTP ${response.status} fetch cmds`);
            const fetchedCommands = await response.json();
            if (!Array.isArray(fetchedCommands)) {
                allCommands = []; throw new Error("Cmd data not array.");
            }
            allCommands = fetchedCommands;
            console.log(`Workspaceed ${allCommands.length} cmds.`);
            applyFilters(); // Display initial list
        } catch (error) {
            console.error("Err fetch cmds:", error);
            allCommands = [];
            commandListDiv.innerHTML = `<p class="error">Load commands err: ${escapeHtml(error.message)}</p>`;
            applyFilters(); // Ensure display is updated even on error
            showIoMessage(`Load commands err: ${error.message}`, 'error');
        }
    }

    // --- Filtering Logic ---
    function applyFilters() {
        console.log(`Applying filters - OS:[${currentFilterOS.join(',')}] Items:[${currentFilterItems.join(',')}] Tags:[${currentFilterTags.join(',')}] Search:[${currentSearchTerm}]`);
        let filteredCommands = allCommands;
        // Apply OS Filter (if any selected)
        if (currentFilterOS.length > 0) {
            filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.os) && cmd.os.some(cmdOs => currentFilterOS.includes(cmdOs)));
        }
        // Apply Item Filter (if any selected)
        if (currentFilterItems.length > 0) {
            filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.items) && cmd.items.some(item => currentFilterItems.includes(item)));
        }
        // Apply Tag Filter (Service, Attack Type) (if any selected)
        if (currentFilterTags.length > 0) {
            filteredCommands = filteredCommands.filter(cmd => Array.isArray(cmd.filters) && cmd.filters.some(tag => currentFilterTags.includes(tag)));
        }
        // Apply Search Term Filter (if term exists)
        if (currentSearchTerm) {
            const searchTermLower = currentSearchTerm; // Already lowercased on input
            filteredCommands = filteredCommands.filter(cmd => {
                // Combine searchable fields into one string
                const searchString = [
                    cmd.command,
                    cmd.description,
                    ...(Array.isArray(cmd.os) ? cmd.os : []),
                    ...(Array.isArray(cmd.items) ? cmd.items : []),
                    ...(Array.isArray(cmd.filters) ? cmd.filters : [])
                ].join(' ').toLowerCase();
                return searchString.includes(searchTermLower);
            });
        }
        const currentActiveVariables = terminalVariablesState[activeTerminalId] || DEFAULT_VARIABLES;
        displayCommands(filteredCommands, currentActiveVariables);
    }

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
            // Use the dynamically fetched options for setting state
            setButtonGroupState(formOSButtonGroupDiv, commandData.os);
            setButtonGroupState(formItemsButtonGroupDiv, commandData.items);
            const allCommandFilters = commandData.filters || [];
            // Need to separate filters back by category for setting state if using separate button groups
            const serviceFilters = allCommandFilters.filter(f => dynamicFilterCategories["Service"].includes(f));
            const attackFilters = allCommandFilters.filter(f => dynamicFilterCategories["Attack Type"].includes(f));
            setButtonGroupState(formServicesButtonGroupDiv, serviceFilters);
            setButtonGroupState(formAttackTypeButtonGroupDiv, attackFilters);

            // Ensure section is expanded if not already
            if (addCommandSection && !addCommandSection.classList.contains('expanded')) {
                 addCommandSection.classList.add('expanded');
                 addSectionToggle?.setAttribute('aria-expanded', 'true');
            }
            // Scroll the title into view
            formTitleElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } else { // 'add' mode or reset
            if (formTitleElement) formTitleElement.textContent = 'Add New Command';
            formSubmitBtn.textContent = 'Add Command';
            formEditIdInput.value = '';
            cancelEditContainer.style.display = 'none';
            isEditMode = false;
            addCommandForm.reset(); // Resets text fields
            // Reset button groups
            setButtonGroupState(formOSButtonGroupDiv, []);
            setButtonGroupState(formItemsButtonGroupDiv, []);
            setButtonGroupState(formServicesButtonGroupDiv, []);
            setButtonGroupState(formAttackTypeButtonGroupDiv, []);
        }
    }

    // --- Event Handlers ---
    async function handleAddCommandSubmit(event) {
         event.preventDefault();
         const commandId = formEditIdInput.value;
         console.log(`Form submit. Mode: ${isEditMode ? 'Edit (ID: ' + commandId + ')' : 'Add'}`);
         formMessage.textContent = ''; formMessage.className = 'message';

         const formData = new FormData(addCommandForm);
         const commandText = formData.get('command').trim();
         const descriptionText = formData.get('description').trim();

         // Get active buttons from the *form's* button groups
         const getActiveButtonValues = (containerDiv) => Array.from(containerDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value);
         const selectedOS = getActiveButtonValues(formOSButtonGroupDiv);
         const selectedItems = getActiveButtonValues(formItemsButtonGroupDiv);
         const selectedServiceFilters = getActiveButtonValues(formServicesButtonGroupDiv);
         const selectedAttackFilters = getActiveButtonValues(formAttackTypeButtonGroupDiv);

         // Combine all selected filters
         const selectedFilters = [...new Set([...selectedServiceFilters, ...selectedAttackFilters])];

         const data = {
             os: selectedOS,
             items: selectedItems,
             command: commandText,
             description: descriptionText,
             filters: selectedFilters
         };

         if (!data.command) { formMessage.textContent = 'Cmd text missing.'; formMessage.className = 'message error visible'; return; }

         const url = isEditMode ? `/api/commands/${commandId}` : '/api/commands';
         const method = isEditMode ? 'PUT' : 'POST';
         formSubmitBtn.disabled = true; formSubmitBtn.textContent = isEditMode ? 'Updating...' : 'Adding...';

         try {
             const response = await fetch(url, { method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
             const result = await response.json(); // Attempt to parse JSON regardless of status

             if (response.ok) {
                 console.log(`Cmd ${isEditMode ? 'updated' : 'added'}:`, result);
                 formMessage.textContent = result.message || `Cmd ${isEditMode ? 'updated' : 'added'} OK!`;
                 formMessage.className = 'message success visible';
                 setFormMode('add'); // Reset form to Add mode
                 await fetchCommands(); // Refresh command list
                 // Optionally collapse the add section after successful add/edit
                 // if (addCommandSection.classList.contains('expanded')) {
                 //     handleToggleSection(addSectionToggle, addCommandSection);
                 // }
             } else {
                 console.error(`Fail ${isEditMode ? 'update' : 'add'}:`, result);
                 let errorMsg = `Error: ${result.error || response.statusText || 'Op failed.'}`;
                 if (result.details) { try { errorMsg += ` Details: ${JSON.stringify(result.details)}`; } catch (e) {} }
                 formMessage.textContent = errorMsg;
                 formMessage.className = 'message error visible';
             }
         } catch (error) {
             console.error("Net err submit:", error);
             formMessage.textContent = `Net err: ${error.message}`;
             formMessage.className = 'message error visible';
         } finally {
             formSubmitBtn.disabled = false;
             // Reset button text only if staying in the same mode (i.e., on error)
             if (formMessage.classList.contains('error')) {
                 formSubmitBtn.textContent = isEditMode ? 'Update Command' : 'Add Command';
             }
             // Auto-hide message after delay
             setTimeout(() => { if (formMessage.classList.contains('visible')) { formMessage.className = 'message'; formMessage.textContent = ''; } }, 7000);
         }
     }
    function handleFilterButtonClick(event) {
         const button = event.target;
         // Ensure the click is on a filter button within the filter section
         if (!button.classList.contains('filter-button') || !button.closest('#filter-controls-section')) return;

         button.classList.toggle('active');
         const container = button.closest('.filter-button-container');
         if (!container) return;

         const activeValues = Array.from(container.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value);

         // Update the correct filter array based on the container ID
         switch (container.id) {
             case 'filter-os-button-group':
                 currentFilterOS = activeValues;
                 break;
             case 'filter-items-button-group':
                 currentFilterItems = activeValues;
                 break;
             case 'filter-services-button-group':
             case 'filter-attacktype-button-group':
                 // Rebuild the combined filter list from both Service and Attack Type groups
                 const serviceTags = Array.from(filterServicesButtonGroupDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value);
                 const attackTags = Array.from(filterAttackTypeButtonGroupDiv.querySelectorAll('.filter-button.active')).map(btn => btn.dataset.value);
                 currentFilterTags = [...new Set([...serviceTags, ...attackTags])];
                 break;
         }
         applyFilters(); // Re-apply filters after selection changes
     }
    function handleFormButtonClick(event) {
         const button = event.target;
         // Only toggle active state for filter buttons within the add command section
         if (button.classList.contains('filter-button') && button.closest('#add-command-section')) {
             button.classList.toggle('active');
         }
         // Clicks on "Add Option" buttons are handled by separate listeners
     }
    function handleSearchInputChange(event) { currentSearchTerm = event.target.value.toLowerCase().trim(); applyFilters(); }

    /** Generic function to toggle a collapsible section based on its controller (title) */
    function handleToggleSection(controllerElement, sectionElement) {
        if (!controllerElement || !sectionElement) {
             console.warn("Missing controller or section for toggle");
             return;
        }
        const isExpanded = sectionElement.classList.toggle('expanded');
        controllerElement.setAttribute('aria-expanded', isExpanded);

        // Specific logic for Add form reset when collapsing while in Edit mode
        if (sectionElement.id === 'add-command-section' && !isExpanded && isEditMode) {
             setFormMode('add'); // Reset form if collapsed during edit
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

    // --- NEW: Add Option Handler ---
    async function handleAddOption(optionType, inputElement, buttonElement, category = null) {
        if (!inputElement || !buttonElement) {
             console.error("Missing input or button element for adding option.");
             return;
        }
        const name = inputElement.value.trim();
        if (!name) {
            showIoMessage("Option name cannot be empty.", "warning");
            inputElement.focus();
            return;
        }

        let apiUrl = '';
        const requestBody = { name: name };

        switch(optionType) {
            case 'os':
                apiUrl = '/api/options/os';
                break;
            case 'item':
                apiUrl = '/api/options/item';
                break;
            case 'filter':
                if (!category) {
                    showIoMessage("Category (Service or Attack Type) is required for filters.", "error");
                    return;
                }
                apiUrl = '/api/options/filter';
                requestBody.category = category;
                break;
            default:
                showIoMessage("Invalid option type specified.", "error");
                return;
        }

        console.log(`Adding option: Type=${optionType}, Name=${name}, Category=${category || 'N/A'}`);
        buttonElement.disabled = true;
        buttonElement.textContent = 'Adding...';

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const result = await response.json().catch(() => ({ message: response.statusText, error: null })); // Handle cases where response might not be JSON

            if (response.status === 201) { // Created successfully
                showIoMessage(result.message || `${optionType} option "${name}" added.`, 'success');
                inputElement.value = ''; // Clear input
                // Refresh the corresponding options list and buttons
                switch(optionType) {
                    case 'os': await fetchOsOptions(); break;
                    case 'item': await fetchItemOptions(); break;
                    case 'filter': await fetchFilterTags(); break; // Refresh both filter categories
                }
            } else if (response.status === 409) { // Conflict - already exists
                showIoMessage(result.error || `Option "${name}" already exists.`, 'warning');
                 inputElement.select(); // Select existing text
            } else { // Other errors
                 console.error("Add option failed:", result);
                showIoMessage(`Error adding option: ${result.error || result.message || `HTTP ${response.status}`}`, 'error');
            }
        } catch (error) {
            console.error(`Network error adding ${optionType} option:`, error);
            showIoMessage(`Network error: ${error.message}`, 'error');
        } finally {
            buttonElement.disabled = false;
            buttonElement.textContent = 'Add';
        }
    }


    // --- Backup/Import Event Handlers ---
    function handleExport(format) { showIoMessage(`Exporting ${format}...`, 'info', 3000); window.location.href = `/api/commands/export?format=${format}`; }
    async function handleImport() { const file = modalImportFileInp.files[0]; if (!file) { showIoMessage('Select .json/.csv file.', 'warning'); return; } showIoMessage(`Importing ${file.name}...`, 'info'); modalImportBtn.disabled = true; modalImportBtn.textContent = 'Importing...'; const formData = new FormData(); formData.append('importFile', file); try { const response = await fetch('/api/commands/import', { method: 'POST', body: formData }); const result = await response.json(); if (response.ok) { let message = result.message || `Import OK. Added: ${result.success_count || 0}, Skip: ${result.fail_count || 0}.`; showIoMessage(message, 'success', result.errors?.length > 0 ? 10000 : 5000); if (result.errors?.length > 0) console.warn("Import errs:", result.errors.slice(0, 20)); await fetchCommands(); closeBackupImportModal(); } else { console.error("Import fail:", result); showIoMessage(`Import Err: ${result.error || 'Unknown.'}`, 'error'); } } catch (error) { console.error("Net err import:", error); showIoMessage(`Net err: ${error.message}`, 'error'); } finally { modalImportBtn.disabled = false; modalImportBtn.textContent = 'Upload & Import'; modalImportFileInp.value = ''; } }

    // --- Terminal Tab Handling --- (Unchanged from previous versions)
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
        if (!clickedTab || event.target.closest('.close-tab-btn') || clickedTab === addTerminalTabBtn || !clickedTab.dataset.terminalId) return;
        renameTerminalTab(clickedTab);
    }
    function switchActiveTerminalTab(tabElement, terminalId) {
        if (!document.body.contains(tabElement) || !terminalId || activeTerminalId === terminalId) {
            console.log("Switch aborted: Target tab doesn't exist or already active.", terminalId);
             if (activeTerminalId === terminalId && !document.body.contains(tabElement)) {
                  const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
                  if (mainTabEl) { console.log("Falling back to main tab."); switchActiveTerminalTab(mainTabEl, 'term-main'); return; }
             }
            return;
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
            const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]');
             if (mainTabEl && terminalId !== 'term-main') { switchActiveTerminalTab(mainTabEl, 'term-main'); }
        }
        activeTerminalId = terminalId;
        updateVariableInputsUI(activeTerminalId);
        applyFilters();
    }
    function renameTerminalTab(tabElement) {
         const textSpan = tabElement.querySelector('.tab-text');
         if (!textSpan) return;
         const currentName = textSpan.textContent;
         const terminalId = tabElement.dataset.terminalId;
         const iframe = terminalIframesContainer?.querySelector(`#${terminalId}`);
         const newName = prompt(`New name for "${currentName}":`, currentName);
         if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
             const sanitizedName = escapeHtml(newName.trim());
             textSpan.textContent = sanitizedName;
             let portInfo = tabElement.title.match(/\(Port \d+\)/)?.[0] || '';
             tabElement.title = `Terminal: ${sanitizedName} ${portInfo}. Double-click rename.`;
             if (iframe) iframe.title = `${sanitizedName} ttyd terminal`;
             showIoMessage(`Renamed tab to "${sanitizedName}"`, 'info', 3000);
         } else if (newName !== null && newName.trim() === '') {
             showIoMessage("Tab name empty.", 'warning');
         }
    }
     async function handleAddTerminalTab() {
        if (!addTerminalTabBtn) return;
        addTerminalTabBtn.disabled = true; addTerminalTabBtn.textContent = '...';
        try {
            const response = await fetch('/api/terminals/new', { method: 'POST' });
            const result = await response.json();
            if (response.ok && result.success) {
                const newPort = result.port; const newUrl = result.url; const newTerminalId = `term-${newPort}`; const defaultTabName = `Terminal ${newPort}`;
                const newTabButton = document.createElement('button');
                newTabButton.className = 'terminal-tab'; newTabButton.dataset.terminalId = newTerminalId; newTabButton.title = `Term port ${newPort}. Double-click rename.`;
                const textSpan = document.createElement('span'); textSpan.className = 'tab-text'; textSpan.textContent = defaultTabName;
                const closeSpan = document.createElement('span'); closeSpan.className = 'close-tab-btn'; closeSpan.innerHTML = '&times;'; closeSpan.setAttribute('aria-label', 'Close Tab'); closeSpan.title = 'Close Tab';
                newTabButton.appendChild(textSpan); newTabButton.appendChild(closeSpan);
                terminalTabsContainer?.insertBefore(newTabButton, addTerminalTabBtn);
                const newIframe = document.createElement('iframe');
                newIframe.id = newTerminalId; newIframe.className = 'terminal-iframe'; newIframe.src = newUrl; newIframe.title = `${defaultTabName} ttyd terminal`;
                newIframe.onload = () => console.log(`Iframe ${newTerminalId} loaded OK from ${newUrl}.`);
                newIframe.onerror = () => { console.error(`Iframe ${newTerminalId} failed load: ${newUrl}`); showIoMessage(`Err load term Port ${newPort}`, 'error'); try { newIframe.contentDocument.body.innerHTML = `<p style='color:red; padding: 10px;'>Error loading terminal.</p>`; } catch(e) {} };
                terminalIframesContainer?.appendChild(newIframe);
                terminalVariablesState[newTerminalId] = { ...DEFAULT_VARIABLES };
                console.log(`Init vars for new term: ${newTerminalId}`);
                switchActiveTerminalTab(newTabButton, newTerminalId);
            } else {
                const errorMsg = result.error || `Server error ${response.status}`; console.error("Fail create term:", result); showIoMessage(`Create term err: ${errorMsg}`, 'error');
            }
        } catch (error) { console.error("Net err create term:", error); showIoMessage(`Net err: ${error.message}`, 'error');
        } finally { addTerminalTabBtn.disabled = false; addTerminalTabBtn.textContent = '+'; }
     }
    async function handleDeleteTerminalTab(closeButton) {
        const tabToDelete = closeButton.closest('.terminal-tab'); if (!tabToDelete) return;
        const terminalId = tabToDelete.dataset.terminalId; const portMatch = terminalId.match(/^term-(\d+)$/);
        if (!portMatch || !portMatch[1] || terminalId === 'term-main') { if (terminalId === 'term-main') { showIoMessage("Main cannot be closed.", "warning"); } else { console.error(`Invalid ID format: ${terminalId}`); } return; }
        const port = parseInt(portMatch[1], 10); const tabName = tabToDelete.querySelector('.tab-text')?.textContent || `port ${port}`;
        if (!confirm(`Close terminal "${tabName}"?`)) { return; }
        console.log(`Deleting tab: ${terminalId} (Port: ${port})`); tabToDelete.style.opacity = '0.5'; tabToDelete.style.pointerEvents = 'none';
        try {
            const response = await fetch(`/api/terminals/${port}`, { method: 'DELETE' });
            const result = response.status === 200 ? (await response.json().catch(() => ({ success: true, message: `Closed port ${port}.` }))) : await response.json();
            if (response.ok && result.success) {
                showIoMessage(result.message || `Term "${tabName}" closed.`, 'success', 3000);
                const iframeToRemove = terminalIframesContainer?.querySelector(`#${terminalId}`); iframeToRemove?.remove();
                let nextActiveTabElement = null; const allTabs = Array.from(terminalTabsContainer?.querySelectorAll('.terminal-tab:not(#add-terminal-tab-btn)') || []); const currentIndex = allTabs.indexOf(tabToDelete);
                if (currentIndex > 0) { nextActiveTabElement = allTabs[currentIndex - 1]; }
                else if (allTabs.length > 1) { nextActiveTabElement = allTabs[1]; }
                else { nextActiveTabElement = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]'); }
                if (!nextActiveTabElement) { nextActiveTabElement = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]'); }
                tabToDelete.remove(); delete terminalVariablesState[terminalId];
                if (nextActiveTabElement && nextActiveTabElement.dataset.terminalId) { if (activeTerminalId === terminalId) { switchActiveTerminalTab(nextActiveTabElement, nextActiveTabElement.dataset.terminalId); } }
                else { console.error("No valid next tab."); const mainTabEl = terminalTabsContainer?.querySelector('.terminal-tab[data-terminal-id="term-main"]'); if(mainTabEl) switchActiveTerminalTab(mainTabEl, 'term-main'); }
            } else { showIoMessage(`Err closing "${tabName}": ${result.error || 'Unknown'}`, 'error'); tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; }
        } catch (error) { console.error("Net err delete term:", error); showIoMessage(`Net err closing "${tabName}": ${error.message}`, 'error'); tabToDelete.style.opacity = ''; tabToDelete.style.pointerEvents = ''; }
    }

    // --- Setup Event Listeners ---
    function setupEventListeners() {
        console.log("Setting up listeners...");

        // Core UI & Forms
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

        // Filter Buttons (Delegation in Filter Section)
        filterControlsSection?.addEventListener('click', handleFilterButtonClick);
        // Form Buttons (Delegation in Add/Edit Section - Only for toggling active state)
        addCommandSection?.addEventListener('click', handleFormButtonClick);

        // NEW: Add Option Buttons (Specific Listeners)
        addOsBtn?.addEventListener('click', () => handleAddOption('os', addOsInput, addOsBtn));
        addItemBtn?.addEventListener('click', () => handleAddOption('item', addItemInput, addItemBtn));
        addServiceBtn?.addEventListener('click', () => handleAddOption('filter', addServiceInput, addServiceBtn, 'Service')); // Pass category
        addAttackTypeBtn?.addEventListener('click', () => handleAddOption('filter', addAttackTypeInput, addAttackTypeBtn, 'Attack Type')); // Pass category

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

        // Terminal Tabs
        terminalTabsContainer?.addEventListener('click', handleTerminalTabClick);
        terminalTabsContainer?.addEventListener('dblclick', handleTerminalTabDoubleClick);
        addTerminalTabBtn?.addEventListener('click', handleAddTerminalTab);

        console.log("Listeners setup OK.");
    }

    // --- Start ---
    initializeApp(); // Call the main initialization function

}); // End DOMContentLoaded
