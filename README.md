# Command Wave

Command Wave is a web-based interface designed to manage, filter, and execute commands, featuring integrated terminal sessions. It provides a centralized location to store frequently used commands, substitute variables, and send them directly to interactive terminal windows within the browser.

![CommandWave](https://github.com/user-attachments/assets/493be333-0e69-4f0c-818d-78da95d5252a)

* **Command Management:** Add, edit, delete, and view commands through the web UI.
* **Filtering & Searching:**
    * Filter commands by target Operating System (Linux, Windows).
    * Filter by required 'Items' (Username, Password, Hash, IP addresses, etc.).
    * Filter by categorized tags (Services like SMB, WMI, Kerberos; Attack Types like Enumeration, Exploitation).
    * Live search across command text, descriptions, and tags.
* **Variable Substitution:** Define variables (like Target IP, Port, DC IP, file paths) in the UI, and have them automatically substituted into commands using placeholders (e.g., `$TargetIP`). Variables are maintained per terminal tab.
* **Integrated Terminals:**
    * Embeds terminals directly into the web UI using `ttyd` and `tmux`.
    * Supports multiple terminal tabs.
    * Rename or close dynamically added tabs.
    * Execute commands directly from the command list into the active terminal tab ("Execute Mode").
* **Import/Export:** Backup and restore your command database in JSON or CSV format.
* **Modes:**
    * **Edit Mode:** Toggle visibility of edit/delete buttons for commands.
    * **Execute Mode:** Toggle visibility of the 'Execute' button to send commands to terminals.
* **Responsive UI:** Adapts layout for different screen sizes with a cyberpunk/neon aesthetic.

## Technology Stack

* **Backend:** Python 3, Flask
* **Database:** SQLite
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Terminal Emulation:** [ttyd](https://github.com/tsl0922/ttyd), [tmux](https://github.com/tmux/tmux)

## Setup & Installation

1.  **Prerequisites:**
    * Python 3
    * `pip` (Python package installer)
    * `ttyd` (Must be installed and available in your system's PATH)
    * `tmux` (Must be installed and available in your system's PATH)

2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/MBWest/CommandWave.git
    cd CommandWave
    ```

3.  **Install Python Dependencies:**
    * (Optional) Create a virtual environment:
        ```bash
        python -m venv venv
        source venv/bin/activate
        ```
    * Install required libraries:
        ```bash
        pip install -r requirements.txt
        ```

4.  **Database Initialization:** The `database.db` file and the `commands` table will be created automatically when you first run the application.

5.  **Run the Application:**
    ```bash
    python main.py
    ```
    The application should now be running (by default) at `http://0.0.0.0:5000/`.

## Usage

1.  Open your web browser and navigate to the application URL (e.g., `http://localhost:5000`).
2.  **Add Commands:** Click the "Add New Command" title to expand the form. Fill in the details, select relevant OS/Items/Tags, and click "Add Command". Use placeholders like `$TargetIP`, `$Port` in the command text where you want variables substituted.
3.  **Filter/Search:** Click the "Filter Commands" title to expand the filter options. Select tags or type in the search bar to narrow down the command list.
4.  **Use Variables:** Fill in the variable fields at the top. These values will be substituted into the command previews and used when copying or executing. Variable values are specific to the currently active terminal tab.
5.  **Terminals:**
    * The "Main" terminal tab is loaded by default.
    * Click the "+" button in the terminal tabs area to open additional terminals.
    * Double-click a tab name to rename it.
    * Click the 'x' on a dynamic tab to close it.
    * Click a tab to switch focus.
6.  **Copy Commands:** Click the "Copy" button on a command entry to copy the command text (with variables substituted) to your clipboard.
7.  **Execute Commands:**
    * Enable "Execute Mode" using the toggle button above the command list.
    * Click the "Execute" button (now visible) on a command entry to send the command (with variables substituted) directly to the *active* terminal tab.
8.  **Edit/Delete:** Enable "Edit Mode" to show the "Edit" and "Delete" buttons for each command.
9.  **Backup/Import:** Use the "Backup/Import" button to open a modal window for exporting your command database to JSON/CSV or importing from a previous backup.


## Import Formats

The application allows importing commands from either `.json` or `.csv` files using the "Backup/Import" feature.

### JSON Format

The JSON file must contain a single JSON array (`[]`) where each element in the array is an object representing a command.

Each command object should have the following structure:

* **`command`** (String, Required): The command text itself. You can include variable placeholders like `$TargetIP`, `$Port`, etc.
* **`description`** (String, Optional): A description of what the command does. Defaults to an empty string if omitted.
* **`os`** (Array of Strings, Optional): A list of operating systems the command applies to (e.g., `["linux", "windows"]`). Must match predefined OS types. Defaults to an empty list if omitted.
* **`items`** (Array of Strings, Optional): A list of item tags associated with the command (e.g., `["Username", "Password", "Target IP"]`). Must match predefined item types. Defaults to an empty list if omitted.
* **`filters`** (Array of Strings, Optional): A list of filter tags (like Services or Attack Types) associated with the command (e.g., `["SMB", "Enumeration"]`). Must match predefined filter tags. Defaults to an empty list if omitted.

**Example `import_commands.json`:**

```json
[
  {
    "os": ["linux", "windows"],
    "command": "nmap -sV -p $Port $TargetIP",
    "description": "Service version detection on a specific port.",
    "items": ["Target IP", "Port"],
    "filters": ["Network Scan", "Enumeration"]
  },
  {
    "os": ["windows"],
    "command": "crackmapexec smb $TargetIP -u $UserFile -p $PassFile --shares",
    "description": "Enumerate SMB shares using user/pass lists.",
    "items": ["Target IP", "User File", "Pass File"],
    "filters": ["SMB", "Enumeration", "Credential Access"]
  },
  {
    "command": "ping -c 4 $TargetIP",
    "description": "Simple ping command.",
    "items": ["Target IP"],
    "filters": ["Network Scan"]
  }
]
```

### CSV Format

The CSV file must contain a header row with the following column names:

* **`command`** (Required): The command text. Variable placeholders can be included.
* **`description`** (Optional): A description of the command.
* **`os`** (Optional): A comma-separated string of OS tags (e.g., `"linux,windows"`).
* **`items`** (Optional): A comma-separated string of item tags (e.g., `"Target IP,Port"`).
* **`filters`** (Optional): A comma-separated string of filter tags (e.g., `"SMB,Enumeration"`).

**Important Notes for CSV:**

* The header row is mandatory and must include at least the `command` column.
* The order of columns doesn't matter as long as the headers are correct.
* Values containing commas (especially descriptions or commands) should ideally be enclosed in double quotes (`"`) according to standard CSV practices, although the backend attempts dialect sniffing.
* Multiple tags for `os`, `items`, or `filters` within a single command should be placed in the corresponding cell, separated by commas.

**Example `import_commands.csv`:**

```csv
os,command,description,items,filters
"linux,windows","nmap -sV -p $Port $TargetIP","Service version detection on a specific port.","Target IP,Port","Network Scan,Enumeration"
windows,"crackmapexec smb $TargetIP -u $UserFile -p $PassFile --shares","Enumerate SMB shares using user/pass lists.","Target IP,User File,Pass File","SMB,Enumeration,Credential Access"
,"ping -c 4 $TargetIP","Simple ping command.","Target IP",Network Scan
linux,"ssh -L 8080:localhost:80 user@$TargetIP","SSH Tunnel","Target IP,Username",SSH,Tunneling
```

## Inspiration

The initial concept and inspiration for some of the features in Command Wave came from [wadcoms.github.io](https://wadcoms.github.io/). Their work provided a valuable starting point and motivation for this project.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs, feature requests, or improvements.



