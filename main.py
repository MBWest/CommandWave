# projects/app.py
"""
Backend Flask application for Command Wave.

Handles:
- Serving the main HTML interface.
- API endpoints for CRUD operations on commands (stored in SQLite).
- API endpoints for importing/exporting commands (JSON/CSV).
- API endpoints for fetching/adding dynamic filter/option tags (OS, Items, Filters).
- Managing integrated terminal sessions using ttyd and tmux.
- Starting/stopping/deleting terminal processes and sending commands to them.
"""

# Standard library imports
import sqlite3
import logging
import json
import csv
import io
import os
import subprocess # Used for running ttyd and tmux
import socket     # Used for basic port checking
import atexit     # Used for cleanup on exit
import sys        # Used for signal handling exit codes
import signal     # Used for graceful shutdown signal handling
import shlex      # Used for safe command splitting/quoting for tmux send-keys

# Third-party imports
# Ensure these are listed in your requirements.txt for deployment
from flask import (
    Flask, render_template, request, jsonify, send_file,
    flash, redirect, url_for
)
from werkzeug.utils import secure_filename

# --- Configuration ---
# Consider moving these to environment variables or a separate config file
DATABASE = 'database.db'
UPLOAD_FOLDER = 'uploads'
# Initial port for the main terminal (consider making configurable)
_initial_ttyd_port = 7681
# Range for dynamically added terminals (consider making configurable)
_next_ttyd_port = 7682
_max_ttyd_port = 7781
# External dependencies - ensure ttyd and tmux are installed and in PATH
TTYD_COMMAND = 'ttyd' # or provide full path if needed
TMUX_COMMAND = 'tmux' # or provide full path if needed

# Define Filter Categories (Used for DB storage and API)
FILTER_CATEGORY_SERVICE = "Service"
FILTER_CATEGORY_ATTACK = "Attack Type"

# --- Flask App Setup ---
app = Flask(__name__)

# !!! SECURITY WARNING !!!
# The secret key should be a strong, random value and kept secret.
# Do NOT commit a hardcoded key like this to Git.
# Load it from an environment variable or a configuration file instead.
# Example using environment variable: app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'default-fallback-key-for-dev')
app.secret_key = 'your_strong_random_secret_key_here' # <<< MUST CHANGE FOR PRODUCTION!

# Configure file uploads
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True) # Ensure upload folder exists

# Basic logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# --- Terminal Process Management State ---
_running_ttyd_processes = {} # {port: Popen object}
_running_tmux_sessions = {} # {port: session_name}

# --- Terminal Helper Functions ---
def is_port_in_use(port):
    """Checks if a TCP port is likely in use on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except OSError:
            return True

def find_available_port(start_port, max_port):
    """Finds the next available port in a given range."""
    port = start_port
    while port <= max_port:
        if not is_port_in_use(port):
             app.logger.info(f"Port {port} appears free.")
             return port
        app.logger.warning(f"Port {port} seems occupied, trying next.")
        port += 1
    app.logger.error(f"No available port found in range {start_port}-{max_port}")
    return None

def start_ttyd_process(port, initial_terminal=False):
    """Starts a ttyd process attached to a new tmux session."""
    if port in _running_ttyd_processes:
        app.logger.warning(f"ttyd already tracked for port {port}. Aborting start.")
        return None
    if is_port_in_use(port):
        app.logger.error(f"Port {port} is already in use. Cannot start ttyd.")
        return None

    session_name = f'cmd_wave_term_{port}'
    ttyd_cmd = [TTYD_COMMAND, '-p', str(port), '-W', TMUX_COMMAND, 'new', '-s', session_name]
    try:
        app.logger.info(f"Attempting: {' '.join(ttyd_cmd)}")
        process = subprocess.Popen(ttyd_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _running_ttyd_processes[port] = process
        _running_tmux_sessions[port] = session_name
        app.logger.info(f"Started ttyd (PID: {process.pid}) <-> tmux '{session_name}' on port {port}")
        return process
    except FileNotFoundError:
        app.logger.error(f"'{TTYD_COMMAND}' or '{TMUX_COMMAND}' not found. Ensure they are installed and in PATH.")
    except Exception as e:
        app.logger.error(f"Failed to start ttyd process on port {port}: {e}", exc_info=True)

    # Cleanup if start failed after partial dict entry
    if port in _running_ttyd_processes: del _running_ttyd_processes[port]
    if port in _running_tmux_sessions: del _running_tmux_sessions[port]
    return None

def cleanup_single_terminal(port):
    """Cleans up ttyd and tmux processes for a specific port."""
    cleaned = False
    session_name = _running_tmux_sessions.pop(port, None)
    if session_name:
        try:
            app.logger.info(f"Attempting to kill tmux session: {session_name} for port {port}")
            kill_cmd = [TMUX_COMMAND, 'kill-session', '-t', session_name]
            subprocess.run(kill_cmd, timeout=2, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            app.logger.info(f"Sent kill command to tmux session: {session_name}")
            cleaned = True
        except subprocess.TimeoutExpired: app.logger.warning(f"Timeout killing tmux session: {session_name}.")
        except FileNotFoundError: app.logger.error(f"'{TMUX_COMMAND}' not found during single cleanup.")
        except Exception as e: app.logger.error(f"Error killing tmux session {session_name}: {e}")

    process = _running_ttyd_processes.pop(port, None)
    if process and process.poll() is None:
        try:
            app.logger.info(f"Terminating ttyd process on port {port} (PID: {process.pid})")
            process.terminate()
            process.wait(timeout=1)
            cleaned = True
        except subprocess.TimeoutExpired:
            app.logger.warning(f"ttyd process {process.pid} did not terminate gracefully, killing.")
            process.kill()
            try: process.wait(timeout=1); cleaned = True
            except Exception as e_kill: app.logger.error(f"Error waiting for ttyd kill {process.pid}: {e_kill}")
        except Exception as e: app.logger.error(f"Error terminating/killing ttyd process {process.pid}: {e}")
    elif process:
        app.logger.info(f"ttyd process {process.pid} on port {port} already terminated.")
        cleaned = True

    if cleaned: app.logger.info(f"Successfully cleaned up resources for port {port}")
    else: app.logger.warning(f"Could not find active processes to clean up for port {port}")
    return cleaned

def cleanup_processes(signal_num=None, frame=None):
    """Cleans up ALL running ttyd and tmux processes on exit or signal."""
    trigger = f"signal {signal_num}" if signal_num is not None else "atexit"
    ports_to_clean = set(_running_ttyd_processes.keys()) | set(_running_tmux_sessions.keys())
    app.logger.info(f"Cleanup triggered by {trigger}. Cleaning up ports: {list(ports_to_clean)}")
    for port in ports_to_clean: cleanup_single_terminal(port)
    if signal_num is not None and not os.environ.get('WERKZEUG_RUN_MAIN'):
        exit_code = 128 + signal_num
        app.logger.info(f"Exiting script with code {exit_code} due to signal {signal_num}.")
        sys.stdout.flush(); sys.stderr.flush(); os._exit(exit_code)

atexit.register(cleanup_processes)
try:
    signal.signal(signal.SIGINT, cleanup_processes); signal.signal(signal.SIGTERM, cleanup_processes)
    app.logger.info("Registered signal handlers for SIGINT and SIGTERM.")
except (ValueError, AttributeError, OSError) as e:
    app.logger.warning(f"Could not set signal handlers: {e}. Cleanup might not run on Ctrl+C/kill.")

# --- Database Helper Functions ---
def get_db():
    """Establishes a connection to the SQLite database."""
    try:
        conn = sqlite3.connect(DATABASE, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # Enable Foreign Key support if using relationships (optional here but good practice)
        # conn.execute("PRAGMA foreign_keys = ON")
        return conn
    except sqlite3.Error as e:
        app.logger.error(f"Database connection error: {e}")
        return None

def init_db():
    """Initializes the database schema if tables don't exist."""
    conn = None
    try:
        conn = get_db()
        if conn:
            cursor = conn.cursor()
            # Commands Table (Existing)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS commands (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    os TEXT,
                    command TEXT NOT NULL,
                    description TEXT,
                    items TEXT,
                    filters TEXT
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_commands_command ON commands (command)')

            # New Table for OS Options
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS os_options (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                )
            ''')
             # Add default OS options if table is newly created or empty
            cursor.execute("INSERT OR IGNORE INTO os_options (name) VALUES ('Linux'), ('Windows')")

            # New Table for Item Options ("What you have")
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS item_options (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE
                )
            ''')
            # Add default Item options if table is newly created or empty
            default_items = ['Username', 'Password', 'No Creds', 'Hash', 'TGS', 'TGT', 'PFX', 'Shell', 'Target IP', 'DC IP', 'DNS IP']
            for item in default_items:
                 cursor.execute("INSERT OR IGNORE INTO item_options (name) VALUES (?)", (item,))


            # New Table for Filter Options (Services, Attack Types)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS filter_options (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL, -- e.g., 'Service', 'Attack Type'
                    UNIQUE(name, category)
                )
            ''')
            # Add default Filter options if table is newly created or empty
            default_filters = {
                FILTER_CATEGORY_SERVICE: ['SMB', 'WMI', 'DCOM', 'Kerberos', 'RPC', 'LDAP', 'NTLM', 'DNS', 'SSH', 'FTP', 'HTTP/HTTPS', 'SNMP'],
                FILTER_CATEGORY_ATTACK: ['Enumeration', 'Exploitation', 'Persistence', 'Privilege Escalation', 'Credential Access', 'Exfiltration', 'Lateral Movement', 'Masquerade']
            }
            for category, filters in default_filters.items():
                for f in filters:
                     cursor.execute("INSERT OR IGNORE INTO filter_options (name, category) VALUES (?, ?)", (f, category))

            conn.commit()
            app.logger.info("Database initialized successfully (including option tables).")
        else:
             app.logger.error("Failed to get DB connection for initialization.")
    except sqlite3.Error as e:
        app.logger.error(f"Error initializing database: {e}")
        if conn: conn.rollback() # Rollback on error
    finally:
        if conn: conn.close()


# --- NEW: DB Functions for Managing Options ---

def add_option(table_name, name, category=None):
    """Adds a new option to the specified options table."""
    if not name or not name.strip():
        return False, "Option name cannot be empty."
    name = name.strip()

    conn = None
    try:
        conn = get_db()
        if not conn: return False, "Database connection failed."
        cursor = conn.cursor()

        if table_name == 'filter_options':
            if not category: return False, "Category is required for filter options."
            sql = f"INSERT INTO {table_name} (name, category) VALUES (?, ?)"
            params = (name, category)
        elif table_name in ['os_options', 'item_options']:
            sql = f"INSERT INTO {table_name} (name) VALUES (?)"
            params = (name,)
        else:
            return False, "Invalid table name specified."

        cursor.execute(sql, params)
        conn.commit()
        app.logger.info(f"Added option '{name}' to {table_name}" + (f" (Category: {category})" if category else ""))
        return True, "Option added successfully."
    except sqlite3.IntegrityError:
        conn.rollback()
        app.logger.warning(f"Option '{name}' already exists in {table_name}" + (f" (Category: {category})" if category else ""))
        return False, "Option already exists."
    except sqlite3.Error as e:
        if conn: conn.rollback()
        app.logger.error(f"DB error adding option to {table_name}: {e}")
        return False, f"Database error: {e}"
    except Exception as e:
        if conn: conn.rollback()
        app.logger.error(f"Unexpected error adding option: {e}", exc_info=True)
        return False, "Unexpected server error."
    finally:
        if conn: conn.close()


def get_options(table_name, category=None):
    """Retrieves options from the specified table, optionally filtered by category."""
    conn = None
    options = []
    try:
        conn = get_db()
        if not conn: raise ConnectionError("Database connection failed.")
        cursor = conn.cursor()

        if table_name in ['os_options', 'item_options']:
            sql = f"SELECT name FROM {table_name} ORDER BY name COLLATE NOCASE"
            cursor.execute(sql)
        elif table_name == 'filter_options':
            if category:
                sql = f"SELECT name FROM {table_name} WHERE category = ? ORDER BY name COLLATE NOCASE"
                cursor.execute(sql, (category,))
            else:
                 # Fetch all if no category specified, maybe useful? Grouped might be better.
                 # For now, let's require category for filters. If needed later, adjust.
                 app.logger.warning("Fetching all filter_options without category - may not be intended.")
                 sql = f"SELECT name FROM {table_name} ORDER BY category, name COLLATE NOCASE"
                 cursor.execute(sql)
        else:
            raise ValueError("Invalid table name specified.")

        rows = cursor.fetchall()
        options = sorted([row['name'] for row in rows]) # Ensure sorting if DB doesn't guarantee it

    except (sqlite3.Error, ConnectionError, ValueError) as e:
        app.logger.error(f"Error getting options from {table_name}" + (f" (Category: {category})" if category else "") + f": {e}")
        # Return empty list on error, allowing app to proceed gracefully (maybe)
        options = []
    finally:
        if conn: conn.close()
    return options

# --- Data Validation and Preparation (UPDATED) ---
def validate_and_prepare_command_data(data):
    """
    Validates incoming command data against DYNAMICALLY FETCHED options
    and prepares it for database insertion.
    Returns prepared data dict, validated data dict (with lists), and errors dict.
    """
    errors = {}
    os_input = data.get('os', [])
    command_text = str(data.get('command', '')).strip()
    description = str(data.get('description', '')).strip()
    items_input = data.get('items', [])
    filters_input = data.get('filters', [])

    # Basic type checks and cleanup
    if isinstance(os_input, str): os_input = [o.strip() for o in os_input.split(',') if o.strip()]
    elif not isinstance(os_input, list): errors['os'] = 'OS must be an array/list.'

    if not command_text: errors['command'] = 'Command field cannot be empty.'

    if isinstance(items_input, str): items_input = [i.strip() for i in items_input.split(',') if i.strip()]
    elif not isinstance(items_input, list): errors['items'] = 'Items must be an array/list.'

    if isinstance(filters_input, str): filters_input = [f.strip() for f in filters_input.split(',') if f.strip()]
    elif not isinstance(filters_input, list): errors['filters'] = 'Filters must be an array/list.'

    if errors:
        return None, None, errors

    # --- FETCH VALID OPTIONS FROM DB ---
    try:
        valid_os_options = get_options('os_options')
        valid_item_options = get_options('item_options')
        # For filters, fetch both categories together for simpler validation check
        valid_filter_options = get_options('filter_options', FILTER_CATEGORY_SERVICE) + \
                               get_options('filter_options', FILTER_CATEGORY_ATTACK)
        if not valid_os_options and not valid_item_options and not valid_filter_options:
             app.logger.warning("Validation options might be empty - check DB init/content.")

    except Exception as e:
         app.logger.error(f"Failed to fetch validation options from DB: {e}")
         # Critical error - cannot validate. Reject the command data.
         errors['database'] = "Could not retrieve validation options from database."
         return None, None, errors
    # --- END FETCH ---


    # Validate input against DB options
    validated_os = sorted([os_val for os_val in os_input if os_val in valid_os_options])
    validated_items = sorted([item for item in items_input if item in valid_item_options])
    validated_filters = sorted([f for f in filters_input if f in valid_filter_options])

    # Check for invalid tags provided by user
    invalid_os = [o for o in os_input if o not in valid_os_options]
    invalid_items = [i for i in items_input if i not in valid_item_options]
    invalid_filters = [f for f in filters_input if f not in valid_filter_options]

    if invalid_os: errors['os'] = f"Invalid OS tags: {', '.join(invalid_os)}"
    if invalid_items: errors['items'] = f"Invalid Item tags: {', '.join(invalid_items)}"
    if invalid_filters: errors['filters'] = f"Invalid Filter tags: {', '.join(invalid_filters)}"

    if errors:
        return None, None, errors

    # Prepare data for DB (comma-separated strings)
    prepared_data_for_db = {
        'os': ",".join(validated_os),
        'command': command_text,
        'description': description,
        'items': ",".join(validated_items),
        'filters': ",".join(validated_filters)
    }
    # Return validated data with lists (for response)
    validated_data_as_lists = {
        'id': data.get('id'),
        'os': validated_os,
        'command': command_text,
        'description': description,
        'items': validated_items,
        'filters': validated_filters
    }
    return prepared_data_for_db, validated_data_as_lists, None


# --- API Routes ---

@app.route('/api/commands', methods=['GET'])
def get_commands():
    """API endpoint to retrieve all commands."""
    conn = None
    try:
        conn = get_db()
        if not conn: return jsonify({"error": "Database connection failed"}), 500
        cursor = conn.cursor()
        cursor.execute("SELECT id, os, command, description, items, filters FROM commands ORDER BY command COLLATE NOCASE")
        rows = cursor.fetchall()
        commands = []
        for row in rows:
            command_dict = dict(row)
            # Convert comma-separated strings back to sorted lists for JSON response
            for key in ['os', 'items', 'filters']:
                 value_str = command_dict.get(key, '')
                 command_dict[key] = sorted([item.strip() for item in value_str.split(',') if item.strip()]) if value_str else []
            commands.append(command_dict)
        return jsonify(commands)
    except sqlite3.Error as e:
        app.logger.error(f"DB error getting commands: {e}")
        return jsonify({"error": "Failed to retrieve commands"}), 500
    finally:
        if conn: conn.close()

@app.route('/api/commands', methods=['POST'])
def add_command():
    """API endpoint to add a new command."""
    conn = None
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON data'}), 400

        prepared_data, validated_data, errors = validate_and_prepare_command_data(data)
        if errors: return jsonify({'error': 'Validation failed', 'details': errors}), 400

        conn = get_db()
        if not conn: return jsonify({"error": "Database connection failed"}), 500
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO commands (os, command, description, items, filters) VALUES (?, ?, ?, ?, ?)",
            (prepared_data['os'], prepared_data['command'], prepared_data['description'],
             prepared_data['items'], prepared_data['filters'])
        )
        conn.commit()
        new_id = cursor.lastrowid
        validated_data['id'] = new_id
        app.logger.info(f"Command added: ID={new_id}")
        return jsonify({'message': 'Command added successfully', 'command': validated_data}), 201
    except sqlite3.Error as e:
        app.logger.error(f"DB error adding command: {e}")
        if conn: conn.rollback()
        return jsonify({'error': f'Database error: {e}'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error adding command: {e}", exc_info=True)
        if conn: conn.rollback()
        return jsonify({'error': 'Unexpected server error'}), 500
    finally:
        if conn: conn.close()

@app.route('/api/commands/<int:command_id>', methods=['PUT'])
def update_command(command_id):
    """API endpoint to update an existing command."""
    conn = None
    try:
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON data'}), 400

        prepared_data, validated_data, errors = validate_and_prepare_command_data(data)
        if errors: return jsonify({'error': 'Validation failed', 'details': errors}), 400

        conn = get_db()
        if not conn: return jsonify({"error": "Database connection failed"}), 500
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM commands WHERE id = ?", (command_id,))
        if not cursor.fetchone(): return jsonify({'error': 'Command not found'}), 404

        cursor.execute("""
            UPDATE commands SET os = ?, command = ?, description = ?, items = ?, filters = ?
            WHERE id = ?
        """, (prepared_data['os'], prepared_data['command'], prepared_data['description'],
              prepared_data['items'], prepared_data['filters'], command_id))
        conn.commit()

        if cursor.rowcount == 0:
            app.logger.warning(f"Update for command ID {command_id} affected 0 rows.")
            return jsonify({'message': 'Command found, but no changes applied.'}), 200

        app.logger.info(f"Command updated: ID={command_id}")
        validated_data['id'] = command_id
        return jsonify({'message': 'Command updated successfully', 'command': validated_data}), 200
    except sqlite3.Error as e:
        app.logger.error(f"DB error updating command ID {command_id}: {e}")
        if conn: conn.rollback()
        return jsonify({'error': f'Database error: {e}'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error updating command ID {command_id}: {e}", exc_info=True)
        if conn: conn.rollback()
        return jsonify({'error': 'Unexpected server error'}), 500
    finally:
        if conn: conn.close()

@app.route('/api/commands/<int:command_id>', methods=['DELETE'])
def delete_command(command_id):
    """API endpoint to delete a command."""
    conn = None
    try:
        conn = get_db()
        if not conn: return jsonify({"error": "Database connection failed"}), 500
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM commands WHERE id = ?", (command_id,))
        if not cursor.fetchone(): return jsonify({'error': 'Command not found'}), 404

        cursor.execute("DELETE FROM commands WHERE id = ?", (command_id,))
        conn.commit()

        if cursor.rowcount == 0:
            app.logger.warning(f"Delete failed after check for command ID {command_id}.")
            return jsonify({'error': 'Command not found during delete op'}), 404

        app.logger.info(f"Command deleted: ID={command_id}")
        return jsonify({'message': 'Command deleted successfully', 'id': command_id}), 200
    except sqlite3.Error as e:
        app.logger.error(f"DB error deleting command ID {command_id}: {e}")
        if conn: conn.rollback()
        return jsonify({'error': f'Database error: {e}'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error deleting command ID {command_id}: {e}", exc_info=True)
        if conn: conn.rollback()
        return jsonify({'error': 'Unexpected server error'}), 500
    finally:
        if conn: conn.close()

# --- Import / Export (Mostly unchanged, but validation uses dynamic options) ---
@app.route('/api/commands/export')
def export_commands():
    """API endpoint to export commands as JSON or CSV."""
    export_format = request.args.get('format', 'json').lower()
    conn = None
    redirect_target = url_for('index')
    try:
        conn = get_db()
        if not conn:
            flash("Database connection failed for export.", "error")
            return redirect(redirect_target)

        cursor = conn.cursor()
        cursor.execute("SELECT os, command, description, items, filters FROM commands ORDER BY command COLLATE NOCASE")
        rows = cursor.fetchall()
        commands_data = [dict(row) for row in rows]
        mem_file = io.BytesIO()

        if export_format == 'json':
            # Convert comma-separated strings to lists for JSON output
            for cmd in commands_data:
                for key in ['os', 'items', 'filters']:
                    value_str = cmd.get(key, '')
                    cmd[key] = sorted([item.strip() for item in value_str.split(',') if item.strip()]) if value_str else []
            json_data = json.dumps(commands_data, indent=4).encode('utf-8')
            mem_file.write(json_data)
            download_name = 'command_wave_export.json'; mimetype = 'application/json'
        elif export_format == 'csv':
            if commands_data:
                string_io = io.StringIO()
                # Use the raw DB strings (comma-separated) for CSV
                fieldnames = ['os', 'command', 'description', 'items', 'filters']
                writer = csv.DictWriter(string_io, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
                writer.writeheader()
                writer.writerows(commands_data)
                mem_file.write(string_io.getvalue().encode('utf-8'))
            download_name = 'command_wave_export.csv'; mimetype = 'text/csv'
        else:
            flash(f"Unsupported export format: '{export_format}'. Use 'json' or 'csv'.", "error")
            return redirect(redirect_target)

        mem_file.seek(0)
        return send_file(mem_file, mimetype=mimetype, as_attachment=True, download_name=download_name)

    except sqlite3.Error as e:
        app.logger.error(f"DB error during export: {e}")
        flash("Database error during export.", "error")
        return redirect(redirect_target)
    except Exception as e:
        app.logger.error(f"Unexpected error during export: {e}", exc_info=True)
        flash("Unexpected error during export.", "error")
        return redirect(redirect_target)
    finally:
        if conn: conn.close()


ALLOWED_EXTENSIONS = {'json', 'csv'}
def allowed_file(filename):
    """Checks if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/commands/import', methods=['POST'])
def import_commands():
    """API endpoint to import commands from JSON or CSV file."""
    if 'importFile' not in request.files: return jsonify({'error': 'No file part'}), 400
    file = request.files['importFile']
    if file.filename == '': return jsonify({'error': 'No selected file'}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        app.logger.info(f"Processing import file: {filename}")
        try:
            content = file.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return jsonify({'error': 'File encoding not valid UTF-8.'}), 400

        file_ext = filename.rsplit('.', 1)[1].lower()
        commands_to_import = []
        import_errors = []
        success_count = 0
        fail_count = 0
        conn = None

        try:
            # Parse JSON or CSV into a list of dictionaries
            if file_ext == 'json':
                try:
                    commands_to_import = json.loads(content)
                    if not isinstance(commands_to_import, list): raise ValueError("JSON root must be a list.")
                except (json.JSONDecodeError, ValueError) as e: return jsonify({'error': f'Invalid JSON: {e}'}), 400
            elif file_ext == 'csv':
                try:
                    string_io = io.StringIO(content)
                    first_chunk = string_io.read(1024)
                    if not first_chunk.strip(): commands_to_import = []
                    else:
                        dialect = csv.Sniffer().sniff(first_chunk)
                        string_io.seek(0)
                        reader = csv.DictReader(string_io, dialect=dialect)
                        if not reader.fieldnames or 'command' not in reader.fieldnames: raise ValueError("CSV needs headers including 'command'.")
                        expected_headers = ['os', 'command', 'description', 'items', 'filters']
                        commands_to_import = [{key: row.get(key, '') for key in expected_headers} for row in reader]
                except (csv.Error, ValueError) as e: return jsonify({'error': f'Invalid CSV: {e}'}), 400

            # Process parsed commands
            if commands_to_import:
                conn = get_db()
                if not conn: return jsonify({"error": "DB connection failed for import."}), 500
                cursor = conn.cursor()

                for idx, cmd_data in enumerate(commands_to_import):
                    line_num = idx + (2 if file_ext == 'csv' else 1) # Line number for error reporting
                    if not isinstance(cmd_data, dict):
                        fail_count += 1; import_errors.append(f"Row {line_num}: Invalid format."); continue

                    # Convert list format (from JSON) to string format (like CSV) for validation consistency
                    for key in ['os', 'items', 'filters']:
                        if key in cmd_data and isinstance(cmd_data[key], list):
                             cmd_data[key] = ','.join(map(str, cmd_data[key]))

                    # Use the updated validation function which checks against DB
                    prepared_data, _, errors = validate_and_prepare_command_data(cmd_data)
                    if errors:
                        fail_count += 1; import_errors.append(f"Row {line_num}: Validation Error - {json.dumps(errors)}"); continue

                    try:
                        # Insert using the validated and prepared data
                        cursor.execute("INSERT INTO commands (os, command, description, items, filters) VALUES (?, ?, ?, ?, ?)",
                                       (prepared_data['os'], prepared_data['command'], prepared_data['description'], prepared_data['items'], prepared_data['filters']))
                        success_count += 1
                        # Commit after each successful insert (or could batch commits)
                        conn.commit()
                    except sqlite3.Error as db_err:
                        conn.rollback()
                        fail_count += 1; import_errors.append(f"Row {line_num}: DB Error - {db_err}")

            app.logger.info(f"Import done. Success: {success_count}, Failed: {fail_count}")
            return jsonify({
                'message': f"Import finished. Added: {success_count}, Failed/Skipped: {fail_count}.",
                'success_count': success_count, 'fail_count': fail_count,
                'errors': import_errors[:20] # Limit reported errors
            }), 200

        except Exception as e:
            app.logger.error(f"Unexpected error during import: {e}", exc_info=True)
            if conn: conn.rollback()
            return jsonify({'error': 'Unexpected server error during import.'}), 500
        finally:
             if conn: conn.close()
    else:
        return jsonify({'error': 'File type not allowed (.json or .csv only)'}), 400


# --- Options & Terminals API ---

# GET Endpoint for categorized filter tags (Services, Attack Type) - Reads from DB
@app.route('/api/filter_tags', methods=['GET'])
def get_filter_tags():
    """API endpoint to provide categorized filter tags from the database."""
    try:
        service_filters = get_options('filter_options', category=FILTER_CATEGORY_SERVICE)
        attack_filters = get_options('filter_options', category=FILTER_CATEGORY_ATTACK)
        return jsonify({
            FILTER_CATEGORY_SERVICE: service_filters,
            FILTER_CATEGORY_ATTACK: attack_filters
        })
    except Exception as e:
        app.logger.error(f"Error fetching categorized filter tags: {e}", exc_info=True)
        # Return empty structure on error so frontend might degrade gracefully
        return jsonify({"Service": [], "Attack Type": []}), 500


# GET Endpoint for OS options - Reads from DB
@app.route('/api/options/os', methods=['GET'])
def get_os_options_api():
    """API endpoint to get all OS options."""
    try:
        options = get_options('os_options')
        return jsonify({'options': options})
    except Exception as e:
        app.logger.error(f"Error fetching OS options: {e}", exc_info=True)
        return jsonify({'error': 'Failed to fetch OS options'}), 500

# GET Endpoint for Item options - Reads from DB
@app.route('/api/options/item', methods=['GET'])
def get_item_options_api():
    """API endpoint to get all Item options."""
    try:
        options = get_options('item_options')
        return jsonify({'options': options})
    except Exception as e:
        app.logger.error(f"Error fetching Item options: {e}", exc_info=True)
        return jsonify({'error': 'Failed to fetch Item options'}), 500


# POST Endpoint to add a new OS option
@app.route('/api/options/os', methods=['POST'])
def add_os_option_api():
    """API endpoint to add a new OS option."""
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'Missing "name" in request data'}), 400
    name = data['name']
    success, message = add_option('os_options', name)
    if success:
        return jsonify({'message': message}), 201
    else:
        # Distinguish between "already exists" (409 Conflict) and other errors (500)
        status_code = 409 if "already exists" in message else 500
        return jsonify({'error': message}), status_code

# POST Endpoint to add a new Item option
@app.route('/api/options/item', methods=['POST'])
def add_item_option_api():
    """API endpoint to add a new Item option."""
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'Missing "name" in request data'}), 400
    name = data['name']
    success, message = add_option('item_options', name)
    if success:
        return jsonify({'message': message}), 201
    else:
        status_code = 409 if "already exists" in message else 500
        return jsonify({'error': message}), status_code

# POST Endpoint to add a new Filter option (requires category)
@app.route('/api/options/filter', methods=['POST'])
def add_filter_option_api():
    """API endpoint to add a new Filter option (Service or Attack Type)."""
    data = request.get_json()
    if not data or 'name' not in data or 'category' not in data:
        return jsonify({'error': 'Missing "name" or "category" in request data'}), 400
    name = data['name']
    category = data['category']
    if category not in [FILTER_CATEGORY_SERVICE, FILTER_CATEGORY_ATTACK]:
         return jsonify({'error': f'Invalid category. Must be "{FILTER_CATEGORY_SERVICE}" or "{FILTER_CATEGORY_ATTACK}".'}), 400

    success, message = add_option('filter_options', name, category=category)
    if success:
        return jsonify({'message': message}), 201
    else:
        status_code = 409 if "already exists" in message else 500
        return jsonify({'error': message}), status_code


# --- Terminal Management Endpoints (Unchanged) ---

@app.route('/api/terminals/new', methods=['POST'])
def new_terminal():
    """API endpoint to start a new ttyd/tmux terminal instance."""
    global _next_ttyd_port
    found_port = find_available_port(_next_ttyd_port, _max_ttyd_port)
    if found_port is None:
        return jsonify({'success': False, 'error': 'No available ports found.'}), 503

    current_start_port = _next_ttyd_port
    _next_ttyd_port = found_port + 1
    if _next_ttyd_port > _max_ttyd_port: _next_ttyd_port = 7682 # Wrap around if max reached

    process = start_ttyd_process(found_port)
    if process:
        try:
            # Short wait to see if the process exits immediately
            process.wait(timeout=0.5)
            app.logger.error(f"ttyd process on port {found_port} exited immediately.")
            # Clean up state if it died right away
            if found_port in _running_ttyd_processes: del _running_ttyd_processes[found_port]
            if found_port in _running_tmux_sessions: del _running_tmux_sessions[found_port]
            _next_ttyd_port = current_start_port # Reset port for next attempt
            return jsonify({'success': False, 'error': 'Terminal process failed to start properly.'}), 500
        except subprocess.TimeoutExpired:
             # Process is still running after timeout, which is good
            app.logger.info(f"New terminal OK: PID {process.pid} on port {found_port}.")
            # Assume localhost for the URL, consider making configurable if needed
            return jsonify({'success': True, 'port': found_port, 'url': f'http://localhost:{found_port}'}), 200
    else:
        # start_ttyd_process failed (logged error inside function)
        _next_ttyd_port = current_start_port # Reset port
        return jsonify({'success': False, 'error': 'Failed to start terminal process.'}), 500

@app.route('/api/terminals/sendkeys', methods=['POST'])
def send_keys_to_terminal():
    """API endpoint to send command/keys to a specific tmux session."""
    data = request.get_json()
    if not data: return jsonify({'success': False, 'error': 'Invalid JSON body.'}), 400

    port = data.get('port')
    command = data.get('command')

    if port is None or command is None: return jsonify({'success': False, 'error': 'Missing "port" or "command".'}), 400
    try: port = int(port)
    except ValueError: return jsonify({'success': False, 'error': 'Invalid port number.'}), 400

    session_name = _running_tmux_sessions.get(port)
    if not session_name:
        app.logger.error(f"Send keys failed: No active tmux session found for port {port}.")
        # Attempt cleanup if ttyd process exists but tmux session is gone
        if port in _running_ttyd_processes:
             proc = _running_ttyd_processes.pop(port, None)
             if proc and proc.poll() is None: proc.kill()
        return jsonify({'success': False, 'error': f'No active terminal session for port {port}.'}), 404

    app.logger.info(f"Sending keys to tmux '{session_name}' (Port: {port})")
    try:
        # Ensure command ends with newline to execute
        cmd_to_send = command if command.endswith('\n') else command + "\n"
        # Use shlex.quote for safety if needed, but tmux send-keys handles most things okay.
        # For complex commands, quoting might be necessary. Let's keep it simple for now.
        send_keys_cmd = [TMUX_COMMAND, 'send-keys', '-t', session_name, cmd_to_send]

        result = subprocess.run(send_keys_cmd, check=False, capture_output=True, text=True, timeout=5)

        if result.returncode == 0:
            app.logger.info(f"Keys sent successfully to tmux '{session_name}'.")
            return jsonify({'success': True, 'message': 'Command sent successfully.'}), 200
        else:
            # Handle specific tmux errors more gracefully
            stderr_lower = result.stderr.lower()
            if "session not found" in stderr_lower or "no server running" in stderr_lower:
                 app.logger.error(f"Tmux error: Session '{session_name}' not found or server dead.")
                 # Clean up state if session is gone
                 if port in _running_tmux_sessions: del _running_tmux_sessions[port]
                 if port in _running_ttyd_processes:
                     proc = _running_ttyd_processes.pop(port, None)
                     if proc and proc.poll() is None: proc.kill()
                 return jsonify({'success': False, 'error': f'Tmux session "{session_name}" not found.'}), 404
            else:
                app.logger.error(f"Tmux error sending keys. RC: {result.returncode}, Stderr: {result.stderr.strip()}")
                return jsonify({'success': False, 'error': f'Tmux error: {result.stderr.strip()}'}), 500

    except FileNotFoundError:
        app.logger.error(f"'{TMUX_COMMAND}' not found. Cannot send keys.")
        return jsonify({'success': False, 'error': f"'{TMUX_COMMAND}' command not found."}), 500
    except subprocess.TimeoutExpired:
        app.logger.error(f"Timeout sending keys to tmux '{session_name}'.")
        return jsonify({'success': False, 'error': 'Timeout sending command.'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error sending keys: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'Unexpected server error sending keys.'}), 500

@app.route('/api/terminals/<int:port>', methods=['DELETE'])
def delete_terminal(port):
    """API endpoint to stop and clean up a specific terminal instance."""
    app.logger.info(f"Received request to delete terminal on port: {port}")
    if port == _initial_ttyd_port:
        return jsonify({'success': False, 'error': 'Cannot delete the main terminal.'}), 403 # Forbidden

    if port not in _running_ttyd_processes and port not in _running_tmux_sessions:
        app.logger.warning(f"Request to delete untracked terminal port: {port}")
        # Considered success if it's already gone/untracked
        return jsonify({'success': True, 'message': f'Terminal on port {port} was not actively tracked.'}), 200

    cleaned_up = cleanup_single_terminal(port)

    if cleaned_up:
        return jsonify({'success': True, 'message': f'Terminal on port {port} stopped and cleaned up.'}), 200
    else:
        # This case implies cleanup_single_terminal found something but failed to stop it
        return jsonify({'success': False, 'error': f'Failed to fully clean up terminal on port {port}. Manual check might be needed.'}), 500


# --- Main Route (Unchanged) ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    # Pass the initial port number to the template
    return render_template('index.html', _initial_ttyd_port=_initial_ttyd_port)

# --- Initial Terminal Startup (Unchanged) ---
def start_initial_ttyd():
    """Starts the initial ttyd instance on the predefined port."""
    # Avoid starting twice if Werkzeug reloader is active (check environment)
    if not os.environ.get('WERKZEUG_RUN_MAIN'):
        app.logger.info(f"Attempting to start initial ttyd on port {_initial_ttyd_port}...")
        process = start_ttyd_process(_initial_ttyd_port, initial_terminal=True)
        if not process:
            app.logger.critical(f"CRITICAL: Failed start initial ttyd on port {_initial_ttyd_port}.")
        else:
             # Check if process died immediately after start
             try:
                process.wait(timeout=0.5)
                app.logger.critical(f"CRITICAL: Initial ttyd process PID {process.pid} exited immediately.")
                # Ensure cleanup if it died
                if _initial_ttyd_port in _running_ttyd_processes: del _running_ttyd_processes[_initial_ttyd_port]
                if _initial_ttyd_port in _running_tmux_sessions: del _running_tmux_sessions[_initial_ttyd_port]
             except subprocess.TimeoutExpired:
                # Process is still running, which is expected
                app.logger.info(f"Initial ttyd process {process.pid} running OK.")
    else:
        app.logger.info("Skipping initial ttyd start in Werkzeug reloader process.")


# --- Run Application ---
if __name__ == '__main__':
    # Initialize DB (creates tables if they don't exist, adds defaults if needed)
    init_db()
    # Start the main terminal process
    start_initial_ttyd()
    app.logger.info("Starting Flask application server...")
    try:
        # WARNING: Running on 0.0.0.0 makes the app accessible from your network.
        # Ensure this is intended and consider firewall rules if needed.
        # use_reloader=False is strongly recommended due to the complexity of
        # managing subprocesses (ttyd/tmux) and signal handling correctly with the reloader.
        # debug=False should be used for anything beyond local development.
        app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)
    except Exception as e:
         app.logger.error(f"Flask app run failed: {e}", exc_info=True)
         # Attempt cleanup even on Flask startup failure
         cleanup_processes()
