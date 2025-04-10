# Command Wave - Terminal & Playbook Interface

Command Wave is a web-based interface for managing multiple terminal sessions and executing commands from Markdown-based playbooks, featuring integrated, persistent notes and a pre-configured terminal theme.

![MultiplePlaybooks](https://github.com/user-attachments/assets/87d5d725-1c72-4494-98ca-fae96e7ae2ab)

## Core Features

* **Multi-Tab Terminals:**
    * Embeds terminals directly into the web UI using `ttyd` and `tmux`.
    * Supports multiple terminal tabs, including a default "Main" tab.
    * Add new terminal tabs with a custom name prompt.
    * Rename dynamically added tabs by double-clicking.
    * Close dynamically added tabs.
* **Playbook Integration:**
    * Upload Markdown (`.md`) files as "Playbooks" directly through the UI.
    * Playbooks are displayed in collapsible sections within the active tab's context.
    * Rendered playbooks show text blocks and code blocks with syntax highlighting (requires Prism.js).
    * Remove loaded playbooks from the current tab's view.
* **Variable Substitution:**
    * Define variables (like Target IP, Port, File Paths) in the UI.
    * Variables are substituted into playbook code blocks in real-time using placeholders (e.g., `$TargetIP`).
    * Variable values are maintained per terminal tab.
* **Code Execution & Copying:**
    * Execute code blocks directly from a loaded playbook into the *active* terminal tab.
    * Copy code blocks (with variables substituted) to the clipboard.
* **Floating Notes:**
    * Persistent "Global Notes" panel accessible across all tabs.
    * Persistent "Tab Notes" panel specific to each terminal tab.
    * Notes are saved automatically via backend API calls.
* **Included Tmux Theme:**
    * Includes a `commandwave_theme.tmux.conf` file that provides a default theme matching the web UI for the `tmux` sessions.
    * This theme is applied automatically unless disabled via a command-line option.
* **Responsive UI:** Adapts layout for different screen sizes with a cyberpunk/neon aesthetic.

## Technology Stack

* **Backend:** Python 3, Flask, argparse
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla), marked.js (for Markdown parsing), Prism.js (for syntax highlighting)
* **Terminal Emulation:** [ttyd](https://github.com/tsl0922/ttyd), [tmux](https://github.com/tmux/tmux) (External Dependencies)
* **Notes Persistence:** Text files stored locally (`notes_data` directory).
* **Tmux Theming:** Includes `commandwave_theme.tmux.conf` file.

## Setup & Installation

1.  **Prerequisites:**
    * Python 3
    * `pip` (Python package installer)
    * `ttyd` (Must be installed and available in your system's PATH)
    * `tmux` (Must be installed and available in your system's PATH)

2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Journey-West/CommandWave.git
    cd CommandWave
    ```

3.  **Install Python Dependencies:**
    * (Optional but Recommended) Create and activate a virtual environment:
        ```bash
        python -m venv venv
        source venv/bin/activate
        ```
    * Install required libraries from `requirements.txt`:
        ```bash
        pip install -r requirements.txt
        ```
        *(Note: The requirements file primarily includes Flask and its dependencies)*

4.  **Directory Setup:**
    * The application will automatically create a `notes_data` directory to store notes files when first run.
    * You can customize the included `commandwave_theme.tmux.conf` file if you wish to modify the default terminal theme.

5.  **Run the Application:**
    * **Default (Use Included Custom Theme):**
        ```bash
        python main.py
        ```
        The application should now be running (by default) at `http://127.0.0.1:5000/`. It will automatically use the included `commandwave_theme.tmux.conf` file to theme the `tmux` terminals.
    * **Use Default Tmux Theme (Ignore Included File):**
        ```bash
        python main.py --use-default-tmux-config
        ```
        This option forces `tmux` to ignore the included `commandwave_theme.tmux.conf` file and use its standard configuration (e.g., `~/.tmux.conf` or built-in defaults).

## Usage

1.  Open your web browser and navigate to the application URL (e.g., `http://localhost:5000`).
2.  **Use Terminals:**
    * The "Main" terminal tab is loaded by default, themed according to the loaded configuration (included custom theme or default, based on how you ran `main.py`).
    * Click the "+" button to add a new terminal tab. It will also use the same theme configuration.
    * Click a tab to switch focus. The content area (Variables, Playbooks, Tab Notes) updates to reflect the active tab.
    * Double-click a tab name (except "Main") to rename it.
    * Click the 'x' on a dynamic tab to close it and its associated processes.
3.  **Manage Variables:** Fill in the variable fields (Target IP, Port, etc.) at the top left. These values are specific to the *active* terminal tab and will be used for substitution in playbooks loaded in that tab.
4.  **Load Playbooks:**
    * Click the "Upload Playbook" button.
    * Select a `.md` (Markdown) file from your computer.
    * The playbook content will be parsed and displayed below the upload button within the active tab's context.
    * Multiple playbooks can be loaded per tab; they will appear as collapsible sections.
    * Click the header of a loaded playbook to expand/collapse its content.
    * Click the 'x' button on a playbook header to remove it from the current tab's view.
5.  **Interact with Playbook Code:**
    * Code blocks within playbooks will show substituted variable values highlighted.
    * Click the "Copy" button on a code block to copy the substituted command to your clipboard.
    * Click the "Execute" button on a code block to send the substituted command directly to the *active* terminal tab.
6.  **Use Notes:**
    * Click the "GN" (Global Notes) or "TN" (Tab Notes) floating buttons on the left to toggle the respective notes panels.
    * Notes typed into the panels are automatically saved after a short delay. Global notes persist across all tabs; Tab notes are specific to the currently active terminal tab.

## Todo 
- [X] The ability to edit a codeblock after you have imported the playbook.
- [ ] Create/Modify/Save playbooks without leaving the application.
- [ ] More rubust search options.
- [ ] Command line argument to tell the application where you want it to search for your playbooks.
- [ ] Restyle the look and behaviour of the search bar.
- [ ] Add the ability to add new or remove unused variables. 
- [ ] Docker.io expandable section to enable visual network map creation.
- [ ] Code cleanup.
- [ ] Update README/Webiste with current feature set. 

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs, feature requests, or improvements.
